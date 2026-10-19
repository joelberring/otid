import { z } from "zod";
import { UUID_SOURCE as canonicalUuidPattern } from "./ids";

/** Skapa tävling med kontot (ADR-0168): begäran, kvitto och felsvar. */
const canonicalUuidSchema = z.string().regex(
  new RegExp(`^${canonicalUuidPattern}$`),
  "Id måste vara ett kanoniskt gemener-UUID"
);

const ianaTimeZoneSchema = z.string().trim().min(1).max(100).refine((timeZone) => {
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}, "Tidszonen måste vara en giltig IANA-tidszon");

export const eventCreationRequestSchema = z.object({
  formatVersion: z.literal(1),
  eventName: z.string().trim().min(2).max(160),
  raceName: z.string().trim().min(2).max(160),
  raceDate: z.iso.date(),
  timeZone: ianaTimeZoneSchema
}).strict();

export const eventCreationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  createdAt: z.iso.datetime({ offset: true })
}).strict();

export const eventCreationErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const eventCreationErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: eventCreationErrorCodeSchema
}).strict();

export type EventCreationRequest = z.infer<typeof eventCreationRequestSchema>;
export type EventCreationResponse = z.infer<typeof eventCreationResponseSchema>;
export type EventCreationErrorCode = z.infer<typeof eventCreationErrorCodeSchema>;
export type EventCreationErrorResponse = z.infer<typeof eventCreationErrorResponseSchema>;
