import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "UUID måste vara kanonisk och gemen"
);
const instantSchema = z.iso.datetime({ offset: true });

export const pairingAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_pair_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const pairingAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("PAIR_STATION"),
  expiresAt: instantSchema
}).strict();

export const pairingAdminGrantIssueRequestSchema = z.object({
  formatVersion: z.literal(1),
  grantId: canonicalUuidSchema,
  grantSecretHash: z.string().regex(/^[a-f0-9]{64}$/),
  credentialLifetimeHours: z.union([z.literal(8), z.literal(24), z.literal(72)])
}).strict();

export const pairingAdminGrantMetadataSchema = z.object({
  formatVersion: z.literal(1),
  grantId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  scope: z.literal("READOUT"),
  status: z.enum(["ACTIVE", "REDEEMED", "REVOKED", "EXPIRED"]),
  issuedAt: instantSchema,
  expiresAt: instantSchema,
  credentialExpiresAt: instantSchema,
  redeemedAt: instantSchema.nullable(),
  revokedAt: instantSchema.nullable()
}).strict();

export const pairingAdminGrantIssueResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.enum(["stored", "duplicate"]),
  grant: pairingAdminGrantMetadataSchema
}).strict();

export const pairingAdminGrantListResponseSchema = z.object({
  formatVersion: z.literal(1),
  grants: z.array(pairingAdminGrantMetadataSchema).max(1000)
}).strict();

export const pairingAdminGrantRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.enum(["revoked", "already-revoked"]),
  grant: pairingAdminGrantMetadataSchema
}).strict();

export type PairingAdminLoginRequest = z.infer<typeof pairingAdminLoginRequestSchema>;
export type PairingAdminLoginResponse = z.infer<typeof pairingAdminLoginResponseSchema>;
export type PairingAdminGrantIssueRequest = z.infer<typeof pairingAdminGrantIssueRequestSchema>;
export type PairingAdminGrantMetadata = z.infer<typeof pairingAdminGrantMetadataSchema>;
export type PairingAdminGrantIssueResponse = z.infer<typeof pairingAdminGrantIssueResponseSchema>;
export type PairingAdminGrantListResponse = z.infer<typeof pairingAdminGrantListResponseSchema>;
export type PairingAdminGrantRevokeResponse = z.infer<typeof pairingAdminGrantRevokeResponseSchema>;
