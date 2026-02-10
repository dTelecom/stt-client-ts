# @dtelecom/stt

TypeScript SDK for dTelecom real-time speech-to-text with [x402](https://www.x402.org/) micropayments.

Pay-per-minute STT powered by Whisper and Parakeet, with automatic blockchain payments on Base.

## Install

```bash
npm install @dtelecom/stt
```

## Quick Start

```typescript
import { STTClient } from "@dtelecom/stt";

const client = new STTClient({ privateKey: "0x..." });

const stream = await client.session({ minutes: 5, language: "en" }).open();
try {
  for await (const t of stream.transcribeFile("meeting.wav")) {
    console.log(`[${t.start?.toFixed(1)}s] ${t.text}`);
  }
} finally {
  await stream.close();
}
```

## Real-Time Streaming

```typescript
import { STTClient } from "@dtelecom/stt";

const client = new STTClient({ privateKey: "0x..." });

const stream = await client.session({ minutes: 5, language: "en" }).open();

// Callback-based
stream.onTranscription((t) => console.log(t.text));

// Send audio chunks (PCM16, 16kHz, mono)
await stream.sendAudio(pcmBuffer);

// Or iterate asynchronously
for await (const t of stream.transcriptions()) {
  console.log(t.text);
}

await stream.close();
```

## Auto-Extend Sessions

Sessions automatically buy more time when running low (enabled by default):

```typescript
// 30-minute session that auto-extends
const stream = await client.session({ minutes: 30, language: "en" }).open();
// When <60s remaining, SDK buys 5 more minutes automatically

// Disable auto-extend
const stream = await client.session({ minutes: 5, autoExtend: false }).open();
```

## Audio Format

The server expects **PCM16, 16kHz, mono** audio. Convert with ffmpeg:

```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -acodec pcm_s16le output.wav
```

## Pricing

```typescript
const info = await client.pricing();
console.log(`$${info.pricePerMinuteUsd}/min (${info.currency} on ${info.network})`);
```

Current pricing: **$0.005/min** (USDC on Base).

## API Reference

### `new STTClient({ privateKey, url? })`

Main client. Default URL: `https://x402stt.dtelecom.org`.

- `session({ minutes?, language?, autoExtend? })` — Create a session context
- `pricing()` — Get pricing info
- `health()` — Check server health

### `SessionContext`

Returned by `client.session()`.

- `open()` — Create the paid session and connect, returns a `Stream`

### `Stream`

Returned by `sessionContext.open()`.

- `sendAudio(data: Buffer)` — Send raw PCM16 audio
- `transcriptions()` — Async generator of `Transcription` objects
- `transcribeFile(path)` — Stream a WAV file and yield transcriptions
- `onTranscription(callback)` — Register callback for transcriptions
- `close()` — Close the stream

### `Transcription`

- `text: string` — Transcribed text
- `start?: number` — Start time in seconds
- `end?: number` — End time in seconds
- `confidence?: number` — Confidence score
- `isFinal: boolean` — Whether this is a final transcription

## Supported Languages

25 languages via Parakeet-TDT (fast) with Whisper fallback:

English, Russian, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech, Romanian, Hungarian, Greek, Turkish, Ukrainian, Swedish, Norwegian, Danish, Finnish, Catalan, Croatian, Lithuanian, Slovenian, Latvian, Estonian.

## Error Handling

```typescript
import { PaymentError, SessionExpiredError, ConnectionError } from "@dtelecom/stt";

try {
  const stream = await client.session({ minutes: 5 }).open();
  for await (const t of stream.transcriptions()) {
    console.log(t.text);
  }
} catch (e) {
  if (e instanceof PaymentError) {
    console.log("Payment failed — check wallet balance");
  } else if (e instanceof SessionExpiredError) {
    console.log("Session time ran out");
  } else if (e instanceof ConnectionError) {
    console.log("Cannot connect to server");
  }
}
```

## License

MIT
