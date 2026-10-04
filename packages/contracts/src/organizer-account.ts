import { z } from "zod";
import {
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  type EventCreationResponse
} from "./event-creation";
import { raceTypeSchema } from "./race-settings";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const loginName = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/);

export const organizerAccountLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  loginName,
  password: z.string().min(1).max(1024)
}).strict();

/** Självregistrering (ADR-0168): vem som helst kan skapa ett arrangörskonto. */
export const organizerAccountRegistrationRequestSchema = z.object({
  formatVersion: z.literal(1),
  loginName,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(1024)
}).strict();

export type OrganizerAccountRegistrationRequest = z.infer<typeof organizerAccountRegistrationRequestSchema>;

export const organizerAccountLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  accountId: uuid,
  displayName: z.string().trim().min(1).max(120),
  expiresAt: instant
}).strict();

export const organizerAccountSessionStatusSchema = organizerAccountLoginResponseSchema;

export const organizerEventCreateIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-event-create:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara organizer-event-create:<kanoniskt request-uuid>"
);

// Keep the account-bound endpoint's intent and replay response identical to the
// established event-creation contract; authorization and idempotency scope differ.
// ADR-0170: arrangören väljer tävlingstyp när tävlingen skapas. Saknas typen blir det Tävling.
export const organizerEventCreateRequestSchema = eventCreationRequestSchema.extend({
  raceType: raceTypeSchema.default("STANDARD")
});
export const organizerEventCreateResponseSchema = eventCreationResponseSchema;

const organizerEventRaceSchema = z.object({
  raceId: uuid,
  raceName: z.string().trim().min(1).max(160),
  raceDate: z.iso.date(),
  raceType: raceTypeSchema
}).strict();

const organizerEventSchema = z.object({
  eventId: uuid,
  eventName: z.string().trim().min(1).max(160),
  role: z.enum(["OWNER", "ADMIN"]),
  startsOn: z.iso.date(),
  timeZone: z.string().trim().min(1).max(100),
  races: z.array(organizerEventRaceSchema).max(10_000)
}).strict();

export const organizerMyEventsResponseSchema = z.object({
  formatVersion: z.literal(1),
  events: z.array(organizerEventSchema).max(10_000)
}).strict();

export const organizerRaceEnterResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  expiresAt: instant
}).strict();

export type OrganizerAccountLoginRequest = z.infer<typeof organizerAccountLoginRequestSchema>;
export type OrganizerAccountLoginResponse = z.infer<typeof organizerAccountLoginResponseSchema>;
export type OrganizerAccountSessionStatus = z.infer<typeof organizerAccountSessionStatusSchema>;
export type OrganizerEventCreateIdempotencyKey = z.infer<typeof organizerEventCreateIdempotencyKeySchema>;
export type OrganizerEventCreateRequest = z.input<typeof organizerEventCreateRequestSchema>;
export type OrganizerEventCreateResponse = EventCreationResponse;
export type OrganizerMyEventsResponse = z.infer<typeof organizerMyEventsResponseSchema>;
export type OrganizerRaceEnterResponse = z.infer<typeof organizerRaceEnterResponseSchema>;
