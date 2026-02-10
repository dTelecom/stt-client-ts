import { readFileSync } from "node:fs";
import { AudioFormatError } from "./errors.js";

/** PCM16 mono 16kHz constants. */
export const SAMPLE_RATE = 16000;
export const SAMPLE_WIDTH = 2; // 16-bit = 2 bytes
export const CHANNELS = 1;
export const BYTES_PER_SECOND = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS; // 32000

export interface WavData {
  pcmData: Buffer;
  sampleRate: number;
  channels: number;
  sampleWidth: number;
}

/**
 * Load a WAV file and validate that it is PCM16, 16kHz, mono.
 * Returns the raw PCM data and format info.
 */
export function loadWav(path: string): WavData {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AudioFormatError(`File not found: ${path}`);
    }
    throw new AudioFormatError(`Cannot read file: ${path}`);
  }

  // Parse WAV header
  if (buf.length < 44) {
    throw new AudioFormatError("Cannot read WAV file: file too small");
  }

  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new AudioFormatError("Cannot read WAV file: not a valid WAV");
  }

  // Find "fmt " chunk
  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      fmtOffset = offset + 8;
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break; // data is always the last chunk we care about
    }
    offset += 8 + chunkSize;
  }

  if (fmtOffset === -1) {
    throw new AudioFormatError("Cannot read WAV file: no fmt chunk");
  }
  if (dataOffset === -1) {
    throw new AudioFormatError("Cannot read WAV file: no data chunk");
  }

  const audioFormat = buf.readUInt16LE(fmtOffset); // 1 = PCM
  const channels = buf.readUInt16LE(fmtOffset + 2);
  const sampleRate = buf.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = buf.readUInt16LE(fmtOffset + 14);
  const sampleWidth = bitsPerSample / 8;

  if (audioFormat !== 1) {
    throw new AudioFormatError(
      `Expected PCM format (1), got ${audioFormat}. Convert with: ffmpeg -i input.wav -acodec pcm_s16le output.wav`
    );
  }
  if (sampleRate !== SAMPLE_RATE) {
    throw new AudioFormatError(
      `Expected ${SAMPLE_RATE}Hz, got ${sampleRate}Hz. Resample with: ffmpeg -i input.wav -ar 16000 -ac 1 output.wav`
    );
  }
  if (channels !== CHANNELS) {
    throw new AudioFormatError(
      `Expected mono, got ${channels} channels. Convert with: ffmpeg -i input.wav -ac 1 output.wav`
    );
  }
  if (sampleWidth !== SAMPLE_WIDTH) {
    throw new AudioFormatError(
      `Expected 16-bit, got ${bitsPerSample}-bit. Convert with: ffmpeg -i input.wav -acodec pcm_s16le output.wav`
    );
  }

  const pcmData = buf.subarray(dataOffset, dataOffset + dataSize);
  return { pcmData, sampleRate, channels, sampleWidth };
}

/** Generate PCM16 silence bytes (16kHz mono). */
export function silence(durationSeconds: number): Buffer {
  const numBytes = Math.floor(BYTES_PER_SECOND * durationSeconds);
  return Buffer.alloc(numBytes);
}

/** Helper: sleep for ms. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
