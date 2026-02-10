/** Base exception for all STT errors. */
export class STTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "STTError";
  }
}

/** Payment failed or insufficient funds. */
export class PaymentError extends STTError {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

/** Session time exhausted. */
export class SessionExpiredError extends STTError {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** WebSocket or HTTP connection error. */
export class ConnectionError extends STTError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

/** Invalid audio format (not PCM16, wrong sample rate, etc.). */
export class AudioFormatError extends STTError {
  constructor(message: string) {
    super(message);
    this.name = "AudioFormatError";
  }
}
