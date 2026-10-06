export type RocAdapterErrorCode =
  /** Anropet saknar giltig enhet, giltigt lastId eller giltig tidszon. */
  | "INVALID_INPUT"
  /** Svaret är inte stämplingsrader (t.ex. en HTML-sida eller bara oläsbara rader). */
  | "INVALID_RESPONSE"
  /** Tjänsten svarade inte eller svarade med serverfel. */
  | "UPSTREAM_UNAVAILABLE"
  /** Tjänsten nekade anropet (401/403). */
  | "REJECTED"
  /** Adressen eller enheten finns inte (404). */
  | "NOT_FOUND"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT";

/** Fel från ROC-adaptern. Meddelandet är bara koden: inga bricknummer, namn eller råa svar. */
export class RocAdapterError extends Error {
  constructor(readonly code: RocAdapterErrorCode) {
    super(code);
    this.name = "RocAdapterError";
  }
}

export function fail(code: RocAdapterErrorCode): never {
  throw new RocAdapterError(code);
}
