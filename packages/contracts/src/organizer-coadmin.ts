import { z } from "zod";
import { accountEmailSchema, storedAccountEmailSchema } from "./account";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const canonicalUuidSchema = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instantSchema = z.iso.datetime({ offset: true });

export const organizerAdminGrantIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-admin-grant:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara organizer-admin-grant:<kanoniskt request-uuid>"
);

export const organizerAdminRevokeIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-admin-revoke:${canonicalUuidPattern}$`),
  "Idempotency-Key måste vara organizer-admin-revoke:<kanoniskt request-uuid>"
);

export const organizerAdminGrantRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  email: accountEmailSchema,
  role: z.literal("ADMIN")
}).strict();

export const organizerAdminGrantResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  grantId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: z.literal("ADMIN"),
  grantedAt: instantSchema
}).strict();

export const organizerAdminListRequestSchema = z.object({
  formatVersion: z.literal(1),
  eventId: canonicalUuidSchema
}).strict();

export const organizerAdminGrantMetadataSchema = z.object({
  grantId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
  email: storedAccountEmailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: z.literal("ADMIN"),
  grantedAt: instantSchema,
  revokedAt: instantSchema.nullable()
}).strict();

export const organizerAdminListResponseSchema = z.object({
  formatVersion: z.literal(1),
  eventId: canonicalUuidSchema,
  grants: z.array(organizerAdminGrantMetadataSchema).max(10_000)
}).strict();

export const organizerAdminRevokeRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  grantId: canonicalUuidSchema,
  reason: z.string().trim().min(1).max(240).optional()
}).strict();

export const organizerAdminRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  grantId: canonicalUuidSchema,
  revokedAt: instantSchema
}).strict();

export type OrganizerAdminGrantIdempotencyKey = z.infer<typeof organizerAdminGrantIdempotencyKeySchema>;
export type OrganizerAdminGrantRequest = z.infer<typeof organizerAdminGrantRequestSchema>;
export type OrganizerAdminGrantResponse = z.infer<typeof organizerAdminGrantResponseSchema>;
export type OrganizerAdminListRequest = z.infer<typeof organizerAdminListRequestSchema>;
export type OrganizerAdminGrantMetadata = z.infer<typeof organizerAdminGrantMetadataSchema>;
export type OrganizerAdminListResponse = z.infer<typeof organizerAdminListResponseSchema>;
export type OrganizerAdminRevokeIdempotencyKey = z.infer<typeof organizerAdminRevokeIdempotencyKeySchema>;
export type OrganizerAdminRevokeRequest = z.infer<typeof organizerAdminRevokeRequestSchema>;
export type OrganizerAdminRevokeResponse = z.infer<typeof organizerAdminRevokeResponseSchema>;
