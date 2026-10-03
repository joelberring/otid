import { publicResultEventStreamPayloadSchema } from "@o-tid/contracts";

type PublicResultEventSource = {
  addEventListener: (type: "refresh" | "reset", callback: (event: MessageEvent<string>) => void) => void;
  close: () => void;
};

type PublicResultEventSourceConstructor = new (url: string) => PublicResultEventSource;

/** Opens a no-PII wake-up stream; the caller owns the validated result fetch. */
export function startPublicResultEventStream(
  raceId: string,
  EventSourceConstructor: PublicResultEventSourceConstructor,
  refresh: () => void
): () => void {
  const source = new EventSourceConstructor(`/api/public/races/${raceId}/result-events`);
  const onUpdate = (event: MessageEvent<string>) => {
    try {
      if (publicResultEventStreamPayloadSchema.safeParse(JSON.parse(event.data)).success) refresh();
    } catch { /* Ignore malformed wake-ups; polling remains the fallback. */ }
  };
  source.addEventListener("refresh", onUpdate);
  source.addEventListener("reset", onUpdate);
  return () => source.close();
}
