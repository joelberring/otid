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
