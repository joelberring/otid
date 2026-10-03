import { z } from "zod";
import { eventCreationRequestSchema, eventCreationResponseSchema } from "./event-creation";

const canonicalUuid = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const noControls = (text: string) => [...text].every((char) => {
  const code = char.codePointAt(0)!;
  return code >= 32 && !(code >= 127 && code <= 159) && !(code >= 0xd800 && code <= 0xdfff);
});
export const eventorExternalIdSchema = z.string().min(1).max(256)
  .refine((value) => value.trim() === value && value !== "." && value !== ".." && noControls(value));
const name = z.string().min(2).max(160).refine((value) => value.trim() === value && noControls(value));
const date = z.iso.date().refine((value) => !value.startsWith("0000"));
const clock = z.string().length(8).regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/);
const hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);

/** Closed server-side Eventor origin selection; never a browser-provided URL. */
export const eventorProfileSchema = z.enum(["testeventor-se", "production-se"]);

export const eventorEventProjectionSchema = z.object({
  eventId: eventorExternalIdSchema,
  eventName: name,
  startDate: date,
  startClock: clock.optional(),
  races: z.array(z.object({
    eventRaceId: eventorExternalIdSchema,
    raceName: name,
    raceDate: date,
    raceClock: clock.optional(),
  }).strict()).max(1000),
}).strict().refine((value) => new Set(value.races.map((race) => race.eventRaceId)).size === value.races.length);

export const eventorConnectionsResponseSchema = z.object({
  formatVersion: z.literal(1),
  connections: z.array(z.object({
    connectionId: canonicalUuid,
    label: z.string().min(1).max(120),
    environment: eventorProfileSchema,
  }).strict()).max(100),
}).strict();

export const eventorPreviewRequestSchema = z.object({
  formatVersion: z.literal(1),
  connectionId: canonicalUuid,
  eventId: eventorExternalIdSchema,
}).strict();

export const eventorPreviewResponseSchema = z.object({
  formatVersion: z.literal(1),
  environment: eventorProfileSchema,
  connectionId: canonicalUuid,
  fetchedAt: z.iso.datetime({ offset: true }),
  sourceHash: hash,
  projection: eventorEventProjectionSchema,
}).strict();

export const eventorImportRequestSchema = eventorPreviewRequestSchema.extend({
  eventRaceId: eventorExternalIdSchema,
  timeZone: eventCreationRequestSchema.shape.timeZone,
  sourceHash: hash,
});
export const eventorImportIdempotencyKeySchema = z.string().length(15 + 36)
  .regex(/^eventor-import:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const eventorImportResponseSchema = eventCreationResponseSchema.extend({
  environment: eventorProfileSchema,
  externalEventId: eventorExternalIdSchema,
  externalEventRaceId: eventorExternalIdSchema,
  sourceHash: hash,
});

export const eventorImportErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT", "SOURCE_UNAVAILABLE", "INTERNAL_ERROR"]),
}).strict();

export type EventorEventProjection = z.infer<typeof eventorEventProjectionSchema>;
export type EventorProfile = z.infer<typeof eventorProfileSchema>;
export type EventorConnectionsResponse = z.infer<typeof eventorConnectionsResponseSchema>;
export type EventorPreviewRequest = z.infer<typeof eventorPreviewRequestSchema>;
export type EventorPreviewResponse = z.infer<typeof eventorPreviewResponseSchema>;
export type EventorImportRequest = z.infer<typeof eventorImportRequestSchema>;
export type EventorImportResponse = z.infer<typeof eventorImportResponseSchema>;
