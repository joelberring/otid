import { publicResultEventStreamPayloadSchema } from "@o-tid/contracts";

type PublicResultEventSource = {
  addEventListener: (type: "refresh" | "reset" | "open" | "error", callback: (event: MessageEvent<string>) => void) => void;
  close: () => void;
};

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
  const source = new EventSourceConstructor(`/api/public/races/${raceId}/result-events`);
  const random = pacing.random ?? Math.random, now = pacing.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRun = Number.NEGATIVE_INFINITY;
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
  source.addEventListener("refresh", onUpdate);
  source.addEventListener("reset", onUpdate);
  source.addEventListener("open", () => onHealth?.(true));
  source.addEventListener("error", () => onHealth?.(false));
  return () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; source.close(); };
}
