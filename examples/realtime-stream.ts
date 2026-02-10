/**
 * Real-time microphone streaming with dTelecom STT.
 *
 * Requires: npm install node-record-lpcm16
 * Usage:
 *   export DTELECOM_PRIVATE_KEY="0x..."
 *   npx tsx examples/realtime-stream.ts [language]
 */

import { STTClient } from "../src/index.js";

async function main() {
  const privateKey = process.env.DTELECOM_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: Set DTELECOM_PRIVATE_KEY environment variable");
    process.exit(1);
  }

  const language = process.argv[2] ?? "en";
  const client = new STTClient({ privateKey });

  console.log(`Starting real-time STT (language=${language})...`);
  console.log("Speak into your microphone. Press Ctrl+C to stop.\n");

  const stream = await client.session({ minutes: 5, language }).open();

  stream.onTranscription((t) => {
    console.log(`  > ${t.text}`);
  });

  // Use node-record-lpcm16 for microphone capture
  let record: typeof import("node-record-lpcm16");
  try {
    record = await import("node-record-lpcm16");
  } catch {
    console.error("Install node-record-lpcm16: npm install node-record-lpcm16");
    await stream.close();
    process.exit(1);
  }

  const recording = record.record({
    sampleRate: 16000,
    channels: 1,
    audioType: "raw",
    recorder: "sox",
  });

  recording.stream().on("data", (chunk: Buffer) => {
    stream.sendAudio(chunk).catch(() => {});
  });

  process.on("SIGINT", async () => {
    console.log("\nStopping...");
    recording.stop();
    await stream.close();
    console.log("Done.");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
