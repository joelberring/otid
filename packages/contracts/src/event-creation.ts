import { z } from "zod";

export const EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX = "otid_org_event_create_v1" as const;
export const EVENT_CREATION_SESSION_TOKEN_PREFIX = "otid_org_event_create_session_v1" as const;

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const base64UrlSecretPattern = "[A-Za-z0-9_-]{43}";
const canonicalUuidSchema = z.string().regex(
  new RegExp(`^${canonicalUuidPattern}$`),
  "Id måste vara ett kanoniskt gemener-UUID"
);

export const eventCreationAccessCredentialSchema = z.string().regex(
  new RegExp(`^${EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX}\\.${canonicalUuidPattern}\\.${base64UrlSecretPattern}$`)
);

export const eventCreationSessionTokenSchema = z.string().regex(
  new RegExp(`^${EVENT_CREATION_SESSION_TOKEN_PREFIX}\\.${canonicalUuidPattern}\\.${base64UrlSecretPattern}$`)
);

export const eventCreationCsrfTokenSchema = z.string().regex(new RegExp(`^${base64UrlSecretPattern}$`));

export const eventCreationLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: eventCreationAccessCredentialSchema
}).strict();

export const eventCreationLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  capability: z.literal("CREATE_EVENT"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

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

export const eventCreationIdempotencyKeySchema = z.string().regex(
  new RegExp(`^event-create:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara event-create:<kanoniskt request-uuid>"
);

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

export type EventCreationLoginRequest = z.infer<typeof eventCreationLoginRequestSchema>;
export type EventCreationLoginResponse = z.infer<typeof eventCreationLoginResponseSchema>;
export type EventCreationRequest = z.infer<typeof eventCreationRequestSchema>;
export type EventCreationResponse = z.infer<typeof eventCreationResponseSchema>;
export type EventCreationErrorCode = z.infer<typeof eventCreationErrorCodeSchema>;
export type EventCreationErrorResponse = z.infer<typeof eventCreationErrorResponseSchema>;
