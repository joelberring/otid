/**
 * Steg 51: svarshuvudet som säger att en publik lista gäller en äldre version än tävlingens aktuella (cachen räknar
 * just om den). Webbläsaren hämtar då igen strax i stället för att vänta på nästa väckning (`usePublicRaceData`).
 */
export const PUBLIC_STALE_HEADER = "x-otid-stale";

/** Gäller något av svaren en äldre version? */
export function anyStale(...responses: readonly (Response | undefined)[]): boolean {
  return responses.some((response) => response?.headers.get(PUBLIC_STALE_HEADER) === "1");
}

/**
 * Steg 54: under tryck (lastavlastningen, ADR-0177) säger servern hur många sekunder sidan ska vänta innan den hämtar en
 * nyare lista. Saknas huvudet gäller 1,5–2,5 s (`STALE_RETRY_MS`).
 */
export const PUBLIC_STALE_RETRY_HEADER = "x-otid-stale-retry";

/** Den längsta väntan som något av svaren ber om (ms), eller undefined. */
export function staleRetryMs(...responses: readonly (Response | undefined)[]): number | undefined {
  const waits = responses.flatMap((response) => {
    const value = Number(response?.headers.get(PUBLIC_STALE_RETRY_HEADER));
    return Number.isFinite(value) && value > 0 ? [Math.min(value, 60) * 1_000] : [];
  });
  return waits.length === 0 ? undefined : Math.max(...waits);
}

/** Steg 54: servern hann inte (503). Sidan behåller det den visar och försöker igen efter `retryAfterMs`, utan felbesked. */
export class PublicBusyError extends Error {
  constructor(readonly retryAfterMs: number) { super("Servern har många besökare just nu"); }
}

/** Kastar `PublicBusyError` för ett 503-svar (med Retry-After, annars 3 s). */
export function throwIfBusy(...responses: readonly (Response | undefined)[]): void {
  const busy = responses.find((response) => response?.status === 503);
  if (!busy) return;
  const seconds = Number(busy.headers.get("retry-after"));
  throw new PublicBusyError((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 3) * 1_000);
}
