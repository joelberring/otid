export type EventorAdapterErrorCode =
  /** Anropet saknar giltig nyckel eller giltigt id. */
  | "INVALID_INPUT"
  /** Svaret är inte XML som vi kan läsa. */
  | "INVALID_XML"
  /** Eventor svarade inte eller svarade med serverfel. */
  | "UPSTREAM_UNAVAILABLE"
  /** Eventor godkände inte nyckeln (401/403). */
  | "REJECTED"
  /** Tävlingen eller resursen finns inte (404). */
  | "NOT_FOUND"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT";

/** Fel från Eventor-adaptern. Meddelandet är bara koden: inga nycklar, namn eller råa svar. */
export class EventorAdapterError extends Error {
  constructor(readonly code: EventorAdapterErrorCode) {
    super(code);
    this.name = "EventorAdapterError";
  }
}
