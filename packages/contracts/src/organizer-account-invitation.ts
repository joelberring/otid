import { z } from "zod";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const loginName = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/);
const instant = z.iso.datetime({ offset: true });

export const organizerAccountInvitationIssueIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-account-invitation-issue:${canonicalUuidPattern}$`)
);

export const organizerAccountInvitationRevokeIdempotencyKeySchema = z.string().regex(
  new RegExp(`^organizer-account-invitation-revoke:${canonicalUuidPattern}$`)
);

export const organizerAccountInvitationIssueRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  eventId: uuid,
  loginName,
  displayName: z.string().trim().min(1).max(120),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const organizerAccountInvitationIssueResponseSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  eventId: uuid,
  invitationId: uuid,
  loginName,
  displayName: z.string().trim().min(1).max(120),
  expiresAt: instant,
  replayed: z.boolean()
}).strict();

export const organizerAccountInvitationMetadataSchema = z.object({
  invitationId: uuid,
  loginName,
  displayName: z.string().trim().min(1).max(120),
  issuedAt: instant,
  expiresAt: instant,
  status: z.enum(["PENDING", "REDEEMED", "REVOKED", "EXPIRED"])
}).strict();

export const organizerAccountInvitationListResponseSchema = z.object({
  formatVersion: z.literal(1),
  eventId: uuid,
  invitations: z.array(organizerAccountInvitationMetadataSchema).max(10_000)
}).strict();

export const organizerAccountInvitationRevokeRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  eventId: uuid,
  invitationId: uuid,
  reason: z.string().trim().min(1).max(240).optional()
}).strict();

export const organizerAccountInvitationRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  eventId: uuid,
  invitationId: uuid,
  revokedAt: instant,
  replayed: z.boolean()
}).strict();

export type OrganizerAccountInvitationIssueRequest = z.infer<typeof organizerAccountInvitationIssueRequestSchema>;
export type OrganizerAccountInvitationIssueResponse = z.infer<typeof organizerAccountInvitationIssueResponseSchema>;
export type OrganizerAccountInvitationMetadata = z.infer<typeof organizerAccountInvitationMetadataSchema>;
export type OrganizerAccountInvitationListResponse = z.infer<typeof organizerAccountInvitationListResponseSchema>;
export type OrganizerAccountInvitationRevokeRequest = z.infer<typeof organizerAccountInvitationRevokeRequestSchema>;
export type OrganizerAccountInvitationRevokeResponse = z.infer<typeof organizerAccountInvitationRevokeResponseSchema>;
export type OrganizerAccountInvitationIssueIdempotencyKey = z.infer<typeof organizerAccountInvitationIssueIdempotencyKeySchema>;
export type OrganizerAccountInvitationRevokeIdempotencyKey = z.infer<typeof organizerAccountInvitationRevokeIdempotencyKeySchema>;
