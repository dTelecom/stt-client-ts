import WebSocket from "ws";

import { BYTES_PER_SECOND, loadWav, silence, sleep } from "./audio.js";
import {
  ConnectionError,
  SessionExpiredError,
  STTError,
} from "./errors.js";
import type { SessionInfo, Transcription } from "./types.js";
import { transcriptionFromMessage } from "./types.js";

/** How long to wait for new transcriptions after audio ends. */
const FILE_DRAIN_TIMEOUT_MS = 5_000;
/** Trailing silence to flush VAD pipeline. */
const TRAILING_SILENCE_SECONDS = 2.0;
/** Chunk size for real-time audio streaming. */
const CHUNK_MS = 20;

export interface StreamOptions {
  wsUrl: string;
  sessionInfo: SessionInfo;
  client: { _extendSession(sessionId: string, minutes?: number): Promise<Record<string, unknown>> };
  language: string;
  autoExtend: boolean;
}

/**
 * WebSocket stream for sending audio and receiving transcriptions.
 * Do not instantiate directly — use `STTClient.session().open()`.
 */
export class Stream {
  private _wsUrl: string;
  private _info: SessionInfo;
  private _client: StreamOptions["client"];
  private _language: string;
  private _autoExtend: boolean;

  private _ws: WebSocket | null = null;
  private _closed = false;
  private _extending = false;

  /** Queued transcriptions for the async iterator. null = end sentinel. */
  private _queue: (Transcription | null)[] = [];
  private _waiters: Array<(value: void) => void> = [];
  private _callbacks: Array<(t: Transcription) => void> = [];

  constructor(options: StreamOptions) {
    this._wsUrl = options.wsUrl;
    this._info = options.sessionInfo;
    this._client = options.client;
    this._language = options.language;
    this._autoExtend = options.autoExtend;
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  /** @internal Connect WebSocket, send config, wait for ready. */
  async _connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._wsUrl);
      } catch (e: unknown) {
        reject(new ConnectionError(`WebSocket connection failed: ${e}`));
        return;
      }

      const timeout = setTimeout(() => {
        this._ws?.close();
        reject(new ConnectionError("Timeout waiting for ready message"));
      }, 30_000);

      this._ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(new ConnectionError(`WebSocket connection failed: ${err.message}`));
      });

      this._ws.on("open", () => {
        const config = {
          type: "config",
          language: this._language,
          session_key: this._info.sessionKey,
        };
        this._ws!.send(JSON.stringify(config));
      });

      // Wait for the "ready" message before resolving
      this._ws.once("message", (raw) => {
        clearTimeout(timeout);

        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === "error") {
          this._ws!.close();
          reject(new STTError(`Server error: ${msg.message ?? JSON.stringify(msg)}`));
          return;
        }
        if (msg.type !== "ready") {
          this._ws!.close();
          reject(new STTError(`Expected ready message, got: ${JSON.stringify(msg)}`));
          return;
        }

        const remaining = (msg.remaining_seconds as number) ?? this._info.remainingSeconds;
        console.log(`Stream ready, remaining=${Math.round(remaining)}s`);

        // Switch to the persistent recv loop
        this._ws!.on("message", (data, isBinary) => this._onMessage(data, isBinary));
        this._ws!.on("close", () => this._onClose());
        resolve();
      });
    });
  }

  /** Close the WebSocket connection gracefully. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Signal end to async iterators
    this._push(null);

    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        // ignore
      }
    }
  }

  // ── Sending audio ─────────────────────────────────────────────────

  /** Send raw PCM16 audio bytes (16kHz mono). */
  async sendAudio(data: Buffer): Promise<void> {
    if (this._closed) throw new STTError("Stream is closed");
    this._ws!.send(data);
  }

  // ── Receiving transcriptions ──────────────────────────────────────

  /** Register a callback for incoming transcriptions. */
  onTranscription(callback: (t: Transcription) => void): void {
    this._callbacks.push(callback);
  }

  /** Async iterator yielding transcriptions as they arrive. */
  async *transcriptions(): AsyncGenerator<Transcription> {
    while (true) {
      const item = await this._pull();
      if (item === null) return;
      yield item;
    }
  }

  /**
   * Stream a WAV file and yield transcriptions.
   * Loads the file, streams at real-time speed, sends trailing silence,
   * and yields results.
   */
  async *transcribeFile(path: string): AsyncGenerator<Transcription> {
    const { pcmData } = loadWav(path);
    const audioDuration = pcmData.length / BYTES_PER_SECOND;
    console.log(`Streaming file ${path} (${audioDuration.toFixed(1)}s)`);

    // Stream audio at real-time speed
    const chunkBytes = Math.floor(BYTES_PER_SECOND * CHUNK_MS / 1000);
    let offset = 0;
    while (offset < pcmData.length) {
      const chunk = pcmData.subarray(offset, offset + chunkBytes);
      this._ws!.send(chunk);
      offset += chunkBytes;
      await sleep(CHUNK_MS);
    }

    // Send trailing silence to flush VAD
    this._ws!.send(silence(TRAILING_SILENCE_SECONDS));
    await sleep(TRAILING_SILENCE_SECONDS * 1000);

    // Drain transcriptions with timeout
    while (true) {
      const item = await this._pullWithTimeout(FILE_DRAIN_TIMEOUT_MS);
      if (item === null) return;
      yield item;
    }
  }

  // ── Internal queue helpers ────────────────────────────────────────

  private _push(item: Transcription | null): void {
    this._queue.push(item);
    // Wake up any waiters
    const waiter = this._waiters.shift();
    if (waiter) waiter();
  }

  private async _pull(): Promise<Transcription | null> {
    if (this._queue.length > 0) {
      return this._queue.shift()!;
    }
    await new Promise<void>((resolve) => this._waiters.push(resolve));
    return this._queue.shift() ?? null;
  }

  private async _pullWithTimeout(
    timeoutMs: number
  ): Promise<Transcription | null> {
    if (this._queue.length > 0) {
      return this._queue.shift()!;
    }
    return new Promise<Transcription | null>((resolve) => {
      const timer = setTimeout(() => {
        // Remove the waiter if it hasn't been called
        const idx = this._waiters.indexOf(wakerFn);
        if (idx >= 0) this._waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const wakerFn = () => {
        clearTimeout(timer);
        resolve(this._queue.shift() ?? null);
      };
      this._waiters.push(wakerFn);
    });
  }

  // ── WebSocket message handling ────────────────────────────────────

  private _onMessage(raw: WebSocket.RawData, isBinary: boolean): void {
    // Ignore binary messages from server
    if (isBinary) return;

    const text = raw.toString();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    const msgType = msg.type as string;

    if (msgType === "transcription") {
      const t = transcriptionFromMessage(msg);
      this._push(t);
      for (const cb of this._callbacks) {
        try {
          cb(t);
        } catch (e) {
          console.error("Transcription callback error:", e);
        }
      }
    } else if (msgType === "session_expiring") {
      const remaining = msg.remaining_seconds as number;
      console.warn(`Session expiring, ${Math.round(remaining)}s remaining`);
      if (this._autoExtend && !this._extending) {
        this._autoExtendSession();
      }
    } else if (msgType === "session_extended") {
      const remaining = msg.remaining_seconds as number;
      console.log(`Session extended, ${Math.round(remaining)}s remaining`);
    } else if (msgType === "session_expired") {
      console.error("Session expired");
      this._push(null);
    } else if (msgType === "error") {
      console.error(`Server error: ${msg.message ?? JSON.stringify(msg)}`);
    }
  }

  private _onClose(): void {
    if (!this._closed) {
      this._push(null);
    }
  }

  private async _autoExtendSession(): Promise<void> {
    this._extending = true;
    try {
      const result = await this._client._extendSession(
        this._info.sessionId,
        5
      );
      console.log(
        `Auto-extended session: +${result.minutes_added ?? 5}min, ` +
          `remaining=${Math.round(result.remaining_seconds as number)}s, ` +
          `$${result.price_usd ?? "?"}`
      );
    } catch (e) {
      console.error("Auto-extend failed:", e);
    } finally {
      this._extending = false;
    }
  }
}
