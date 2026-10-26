import { publicResultEventStreamPayloadSchema } from "@o-tid/contracts";

type PublicResultEventSource = {
  addEventListener: (type: "refresh" | "reset" | "open" | "error", callback: (event: MessageEvent<string>) => void) => void;
  close: () => void;
  readonly readyState?: number;
};

/** EventSource.CLOSED: webbläsaren ansluter inte själv igen (t.ex. efter 503 när taket för strömmar är nått). */
const CLOSED = 2;
/** Steg 54: en stängd ström öppnas igen efter 10–30 s; under tiden hämtar sidan själv (`onHealth(false)`). */
export const STREAM_RECONNECT_MS = { minMs: 10_000, spreadMs: 20_000 };

type PublicResultEventSourceConstructor = new (url: string) => PublicResultEventSource;

/**
 * Steg 51: hur väckningarna sprids. Under en målrusning kommer flera händelser i sekunden; utan spridning hämtar varje
 * besökare om listan direkt och samtidigt. Nu samlas händelserna och hämtningen sker efter en slumpad fördröjning
 * (högst `spreadMs`) och tidigast `minGapMs` efter förra väckta hämtningen. En ny avläsning syns ändå inom några sekunder.
 */
export type WakeUpPacing = { spreadMs: number; minGapMs: number; random?: () => number; now?: () => number };
export const PUBLIC_WAKE_UP_PACING: WakeUpPacing = { spreadMs: 1_000, minGapMs: 3_000 };

/** Opens a no-PII wake-up stream; the caller owns the validated result fetch. */
export function startPublicResultEventStream(
  raceId: string,
  EventSourceConstructor: PublicResultEventSourceConstructor,
  refresh: () => void,
  pacing: WakeUpPacing = PUBLIC_WAKE_UP_PACING,
  /** Steg 51: strömmen är öppen (true) eller bruten (false); sidan hämtar då av sig själv oftare. */
  onHealth?: (open: boolean) => void
): () => void {
  const random = pacing.random ?? Math.random, now = pacing.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
  let lastRun = Number.NEGATIVE_INFINITY, stopped = false;
  const wake = () => {
    if (timer !== undefined) return;
    const delay = Math.max(0, lastRun + pacing.minGapMs - now()) + random() * pacing.spreadMs;
    timer = setTimeout(() => { timer = undefined; lastRun = now(); refresh(); }, delay);
  };
  const onUpdate = (event: MessageEvent<string>) => {
    try {
      if (publicResultEventStreamPayloadSchema.safeParse(JSON.parse(event.data)).success) wake();
    } catch { /* Ignore malformed wake-ups; polling remains the fallback. */ }
  };
  let source: PublicResultEventSource;
  const connect = () => {
    source = new EventSourceConstructor(`/api/public/races/${raceId}/result-events`);
    const current = source;
    current.addEventListener("refresh", onUpdate);
    current.addEventListener("reset", onUpdate);
    current.addEventListener("open", () => onHealth?.(true));
    current.addEventListener("error", () => {
      onHealth?.(false);
      if (current.readyState !== CLOSED || stopped || reconnect !== undefined) return;
      reconnect = setTimeout(() => { reconnect = undefined; if (!stopped) connect(); },
        STREAM_RECONNECT_MS.minMs + random() * STREAM_RECONNECT_MS.spreadMs);
    });
  };
  connect();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (reconnect !== undefined) clearTimeout(reconnect);
    timer = undefined; source.close();
  };
}
