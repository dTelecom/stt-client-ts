import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

import { ConnectionError, PaymentError, STTError } from "./errors.js";
import { Stream } from "./stream.js";
import type { PricingInfo, SessionInfo } from "./types.js";

const DEFAULT_URL = "https://x402stt.dtelecom.org";

export interface STTClientOptions {
  privateKey: string;
  url?: string;
}

export interface SessionOptions {
  minutes?: number;
  language?: string;
  autoExtend?: boolean;
}

/**
 * Client for dTelecom real-time speech-to-text with x402 micropayments.
 */
export class STTClient {
  /** @internal */ readonly _url: string;
  /** @internal */ readonly _wsUrl: string;
  /** @internal */ readonly _fetchWithPayment: typeof fetch;

  constructor(options: STTClientOptions) {
    this._url = (options.url ?? DEFAULT_URL).replace(/\/+$/, "");
    this._wsUrl = this._url
      .replace("https://", "wss://")
      .replace("http://", "ws://");

    const signer = privateKeyToAccount(
      (options.privateKey.startsWith("0x")
        ? options.privateKey
        : `0x${options.privateKey}`) as `0x${string}`
    );

    const client = new x402Client();
    registerExactEvmScheme(client, { signer });

    this._fetchWithPayment = wrapFetchWithPayment(fetch, client);
  }

  /**
   * Create a session context. Call `.open()` to connect.
   */
  session(options?: SessionOptions): SessionContext {
    return new SessionContext(this, options);
  }

  /** @internal Buy a session via x402 payment. */
  async _createSession(minutes: number, language: string): Promise<SessionInfo> {
    let resp: Response;
    try {
      resp = await this._fetchWithPayment(`${this._url}/v1/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes, language }),
      });
    } catch (e: unknown) {
      throw new ConnectionError(`Cannot reach server: ${e}`);
    }

    if (resp.status === 402) {
      const body = await resp.json().catch(() => ({}));
      throw new PaymentError(
        `Payment failed: ${(body as Record<string, string>).message ?? resp.statusText}`
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new STTError(
        `Session creation failed (${resp.status}): ${text}`
      );
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return {
      sessionId: data.session_id as string,
      sessionKey: data.session_key as string,
      wsUrl: (data.ws_url as string) ?? `${this._wsUrl}/v1/stream`,
      remainingSeconds: data.remaining_seconds as number,
      minutes: data.minutes as number,
      priceUsd: data.price_usd as string,
    };
  }

  /** @internal Extend session with additional paid minutes. */
  async _extendSession(
    sessionId: string,
    minutes: number = 5
  ): Promise<Record<string, unknown>> {
    let resp: Response;
    try {
      resp = await this._fetchWithPayment(`${this._url}/v1/session/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, minutes }),
      });
    } catch (e: unknown) {
      throw new ConnectionError(`Cannot reach server: ${e}`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new PaymentError(`Extend failed (${resp.status}): ${text}`);
    }
    return (await resp.json()) as Record<string, unknown>;
  }

  /** Get pricing information (no payment required). */
  async pricing(): Promise<PricingInfo> {
    let resp: Response;
    try {
      resp = await fetch(`${this._url}/pricing`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e: unknown) {
      throw new ConnectionError(`Cannot reach server: ${e}`);
    }

    if (!resp.ok) {
      throw new STTError(`Pricing request failed (${resp.status})`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return {
      pricePerMinuteUsd: data.price_per_minute_usd as number,
      minMinutes: data.min_minutes as number,
      maxMinutes: data.max_minutes as number,
      minPriceUsd:
        (data.min_price_usd as number) ??
        (data.price_per_minute_usd as number) * (data.min_minutes as number),
      currency: data.currency as string,
      network: data.network as string,
    };
  }

  /** Check server health (no payment required). */
  async health(): Promise<Record<string, unknown>> {
    let resp: Response;
    try {
      resp = await fetch(`${this._url}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e: unknown) {
      throw new ConnectionError(`Cannot reach server: ${e}`);
    }
    return (await resp.json()) as Record<string, unknown>;
  }
}

/**
 * Context returned by `client.session()`.
 * Call `.open()` to create the session and connect.
 */
export class SessionContext {
  private _client: STTClient;
  private _minutes: number;
  private _language: string;
  private _autoExtend: boolean;

  constructor(client: STTClient, options?: SessionOptions) {
    this._client = client;
    this._minutes = options?.minutes ?? 5;
    this._language = options?.language ?? "en";
    this._autoExtend = options?.autoExtend ?? true;
  }

  /** Create the paid session and open a WebSocket stream. */
  async open(): Promise<Stream> {
    const info = await this._client._createSession(
      this._minutes,
      this._language
    );
    console.log(
      `Session created: id=${info.sessionId.slice(0, 8)}, ${info.remainingSeconds}s remaining, $${info.priceUsd}`
    );

    const wsUrl = `${this._client._wsUrl}/v1/stream`;
    const stream = new Stream({
      wsUrl,
      sessionInfo: info,
      client: this._client,
      language: this._language,
      autoExtend: this._autoExtend,
    });
    await stream._connect();
    return stream;
  }
}
