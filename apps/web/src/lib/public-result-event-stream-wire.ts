import { publicResultEventStreamPayloadSchema, UUID_PATTERN as uuidPattern } from "@o-tid/contracts";

const eventSequencePattern = /^[1-9][0-9]{0,18}$/;

function payload(): string {
  return JSON.stringify(publicResultEventStreamPayloadSchema.parse({ formatVersion: 1 }));
}

export function formatPublicResultEvent(event: "refresh" | "reset", eventSequence?: string): Uint8Array {
  if (eventSequence !== undefined && !eventSequencePattern.test(eventSequence)) {
    throw new Error("Ogiltigt publikresultat-händelseid");
  }
  const id = eventSequence === undefined ? "" : `id: ${eventSequence}\n`;
  return new TextEncoder().encode(`${id}event: ${event}\ndata: ${payload()}\n\n`);
}

export function parsePublicResultUpdateNotification(value: string | undefined): { raceId: string; eventSequence: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf(":");
  if (separator === -1) return null;
  const raceId = value.slice(0, separator);
  const eventSequence = value.slice(separator + 1);
  return uuidPattern.test(raceId) && eventSequencePattern.test(eventSequence)
    ? { raceId, eventSequence }
    : null;
}

/**
 * Steg 51: markörer som kommer tätt (en omräkning av 300 löpare ger 300 i samma ögonblick, en målrusning flera i
 * sekunden) samlas per tävling i ett fönster och lämnas som en väckning med den senaste markören. Varje väckning betyder
 * bara "hämta igen", och en återansluten webbläsare får ändå alla markörer efter sin senaste (Last-Event-ID).
 */
export const NOTIFICATION_WINDOW_MS = 250;

export function coalesceNotifications(windowMs: number, deliver: (raceId: string, eventSequence: string) => Promise<void>,
  onError: (error: unknown) => void = (error) => console.error("Resultatströmmens väckning misslyckades", error)) {
  const pending = new Map<string, string>();
  return (raceId: string, eventSequence: string): void => {
    const previous = pending.get(raceId);
    if (previous !== undefined) {
      if (BigInt(eventSequence) > BigInt(previous)) pending.set(raceId, eventSequence);
      return;
    }
    pending.set(raceId, eventSequence);
    setTimeout(() => {
      const latest = pending.get(raceId)!;
      pending.delete(raceId);
      deliver(raceId, latest).catch(onError);
    }, windowMs);
  };
}
