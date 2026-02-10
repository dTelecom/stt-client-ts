/**
 * Transcribe a WAV file using dTelecom STT.
 *
 * Usage:
 *   export DTELECOM_PRIVATE_KEY="0x..."
 *   npx tsx examples/transcribe-file.ts path/to/audio.wav
 */

import { STTClient } from "../src/index.js";

async function main() {
  const wavPath = process.argv[2];
  if (!wavPath) {
    console.log("Usage: npx tsx examples/transcribe-file.ts <audio.wav>");
    console.log("  Audio must be PCM16, 16kHz, mono.");
    console.log("  Set DTELECOM_PRIVATE_KEY env var with your wallet key.");
    process.exit(1);
  }

  const privateKey = process.env.DTELECOM_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: Set DTELECOM_PRIVATE_KEY environment variable");
    process.exit(1);
  }

  const client = new STTClient({ privateKey });

  // Check pricing first
  const info = await client.pricing();
  console.log(`Pricing: $${info.pricePerMinuteUsd}/min (${info.currency})`);

  // Transcribe
  const stream = await client.session({ minutes: 5, language: "en" }).open();
  try {
    for await (const t of stream.transcribeFile(wavPath)) {
      const start = t.start != null ? `${t.start.toFixed(1)}s` : "?";
      console.log(`  [${start}] ${t.text}`);
    }
  } finally {
    await stream.close();
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
