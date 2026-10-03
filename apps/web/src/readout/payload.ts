import type { SportidentReadoutPayload } from "@o-tid/contracts";
import { normalizeCard, type SiCardData } from "@o-tid/sportident";

/** Bytes som gemen hex utan mellanrum, så som råramarna sparas. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface PayloadOptions {
  readonly reference: Date;
  readonly timeZone: string;
  readonly stationSerial?: number;
  readonly simulated: boolean;
}

/**
 * Bygger avläsningens nyttolast. Nycklarna kommer i exakt samma ordning som i
 * kontraktet, eftersom servern räknar innehållshashen på den tolkade JSON:en.
 */
export function buildReadoutPayload(card: SiCardData, frames: readonly Uint8Array[], options: PayloadOptions): SportidentReadoutPayload {
  const normalized = normalizeCard(card, { reference: options.reference, timeZone: options.timeZone });
  return {
    cardNumber: normalized.cardNumber,
    cardType: normalized.cardType,
    ...(normalized.startPunchedAt ? { startPunchedAt: normalized.startPunchedAt } : {}),
    ...(normalized.finishPunchedAt ? { finishPunchedAt: normalized.finishPunchedAt } : {}),
    ...(normalized.checkPunchedAt ? { checkPunchedAt: normalized.checkPunchedAt } : {}),
    ...(normalized.clearPunchedAt ? { clearPunchedAt: normalized.clearPunchedAt } : {}),
    punches: normalized.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...normalized.untimedPunchCodes],
    frames: frames.map(toHex),
    ...(options.stationSerial !== undefined ? { stationSerial: options.stationSerial } : {}),
    simulated: options.simulated
  };
}

/** Samma innehållshash som servern: SHA-256 över JSON-texten. */
export async function payloadHash(payload: SportidentReadoutPayload): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  return toHex(new Uint8Array(digest));
}
