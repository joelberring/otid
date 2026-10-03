import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "UUID måste vara kanonisk och gemen"
);
const instantSchema = z.iso.datetime({ offset: true });

const startCheckinCapabilitySchema = z.enum(["START_CHECKIN", "FINISH_FOREST_WATCH"]);

export const startCheckinAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_start_checkin_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const finishForestWatchAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_finish_forest_watch_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const startCheckinAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("START_CHECKIN"),
  expiresAt: instantSchema
}).strict();

export const finishForestWatchAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("FINISH_FOREST_WATCH"),
  expiresAt: instantSchema
}).strict();

export const startCheckinDeviceRegistrationRequestSchema = z.object({
  formatVersion: z.literal(1),
  deviceId: canonicalUuidSchema,
  label: z.string().trim().min(1).max(120)
}).strict();

export const startCheckinDeviceRegistrationResponseSchema = z.object({
  formatVersion: z.literal(1),
  deviceId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  actorCredentialId: canonicalUuidSchema,
  capability: startCheckinCapabilitySchema,
  label: z.string().trim().min(1).max(120),
  registeredAt: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  ).refine((value) => {
    const year = Number(value.slice(0, 4));
    const milliseconds = Date.parse(value);
    return year >= 1 && year <= 9_999 && Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
  }, "Tidpunkten måste vara en giltig kanonisk UTC-tid med millisekunder")
}).strict();

export type StartCheckinAdminLoginRequest = z.infer<typeof startCheckinAdminLoginRequestSchema>;
export type FinishForestWatchAdminLoginRequest = z.infer<typeof finishForestWatchAdminLoginRequestSchema>;
export type StartCheckinAdminLoginResponse = z.infer<typeof startCheckinAdminLoginResponseSchema>;
export type FinishForestWatchAdminLoginResponse = z.infer<typeof finishForestWatchAdminLoginResponseSchema>;
export type StartCheckinDeviceRegistrationRequest = z.infer<typeof startCheckinDeviceRegistrationRequestSchema>;
export type StartCheckinDeviceRegistrationResponse = z.infer<typeof startCheckinDeviceRegistrationResponseSchema>;

export const StartCheckinAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "TOO_LARGE", "INTERNAL_ERROR"])
}).strict();
export type StartCheckinAdminErrorResponse = z.infer<typeof StartCheckinAdminErrorResponseSchema>;
