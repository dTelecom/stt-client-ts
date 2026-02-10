/** A transcription result from the STT server. */
export interface Transcription {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
  isFinal: boolean;
}

/** Info returned when a session is created. */
export interface SessionInfo {
  sessionId: string;
  sessionKey: string;
  wsUrl: string;
  remainingSeconds: number;
  minutes: number;
  priceUsd: string;
}

/** Pricing information from the server. */
export interface PricingInfo {
  pricePerMinuteUsd: number;
  minMinutes: number;
  maxMinutes: number;
  minPriceUsd: number;
  currency: string;
  network: string;
}

/** Parse a server JSON message into a Transcription. */
export function transcriptionFromMessage(msg: Record<string, unknown>): Transcription {
  return {
    text: (msg.text as string) ?? "",
    start: msg.start as number | undefined,
    end: msg.end as number | undefined,
    confidence: msg.confidence as number | undefined,
    isFinal: (msg.is_final as boolean) ?? true,
  };
}
