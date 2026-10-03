import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const instant = z.iso.datetime({ offset: true });

export const raceOperatorAccessCapabilitySchema = z.enum([
  "MANAGE_RACE", "START_CHECKIN", "FINISH_FOREST_WATCH"
]);

export const raceOperatorAccessMetadataSchema = z.object({
  formatVersion: z.literal(1), credentialId: uuid, raceId: uuid,
  capability: raceOperatorAccessCapabilitySchema, label: z.string().trim().min(1).max(120),
  issuedAt: instant, expiresAt: instant, revokedAt: instant.nullable()
}).strict();

export const raceOperatorAccessIssueRequestSchema = z.object({
  formatVersion: z.literal(1), capability: raceOperatorAccessCapabilitySchema,
  label: z.string().trim().min(1).max(120), expiresAt: instant
}).strict();

const accessCredential = /^otid_org_(?:race_admin|start_checkin|finish_forest_watch)_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
export const raceOperatorAccessIssueResponseSchema = z.object({
  formatVersion: z.literal(1), accessCredential: z.string().regex(accessCredential),
  access: raceOperatorAccessMetadataSchema
}).strict();

export const raceOperatorAccessListResponseSchema = z.object({
  formatVersion: z.literal(1), accesses: z.array(raceOperatorAccessMetadataSchema).max(1000)
}).strict();

export const raceOperatorAccessRevokeRequestSchema = z.object({ formatVersion: z.literal(1), credentialId: uuid }).strict();
export const raceOperatorAccessRevokeResponseSchema = z.object({
  formatVersion: z.literal(1), status: z.enum(["revoked", "already-revoked"]), access: raceOperatorAccessMetadataSchema
}).strict();

export type RaceOperatorAccessIssueRequest = z.infer<typeof raceOperatorAccessIssueRequestSchema>;
export type RaceOperatorAccessMetadata = z.infer<typeof raceOperatorAccessMetadataSchema>;
export type RaceOperatorAccessIssueResponse = z.infer<typeof raceOperatorAccessIssueResponseSchema>;
export type RaceOperatorAccessListResponse = z.infer<typeof raceOperatorAccessListResponseSchema>;
export type RaceOperatorAccessRevokeRequest = z.infer<typeof raceOperatorAccessRevokeRequestSchema>;
export type RaceOperatorAccessRevokeResponse = z.infer<typeof raceOperatorAccessRevokeResponseSchema>;
