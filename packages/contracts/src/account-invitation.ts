import { z } from "zod";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const loginName = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/);
// 32 bytes have 43 unpadded base64url characters. The final sextet has four
// data bits, so its two unused low bits must be zero.
const secret32Bytes = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

export const accountInvitationCodeSchema = secret32Bytes;

export const accountInvitationActivationRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  loginName,
  password: secret32Bytes,
  code: accountInvitationCodeSchema
}).strict();

export const accountInvitationActivationResponseSchema = z.object({
  formatVersion: z.literal(1),
  accountId: uuid,
  loginName
}).strict();

export const accountInvitationActivationFailureSchema = z.object({
  formatVersion: z.literal(1),
  error: z.literal("INVITATION_UNAVAILABLE")
}).strict();

export const accountInvitationIssueInputSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  loginName,
  displayName: z.string().trim().min(1).max(120),
  operatorLabel: z.string().trim().min(1).max(120),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: instant
}).strict();

export const accountInvitationIssueResponseSchema = z.object({
  formatVersion: z.literal(1),
  invitationId: uuid,
  loginName,
  expiresAt: instant
}).strict();

export const accountInvitationRevokeInputSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  invitationId: uuid,
  operatorLabel: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(240)
}).strict();

export const accountInvitationRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  invitationId: uuid,
  status: z.literal("REVOKED")
}).strict();

export const accountInvitationStatusResponseSchema = z.object({
  formatVersion: z.literal(1),
  invitationId: uuid,
  loginName,
  displayName: z.string().trim().min(1).max(120),
  issuedAt: instant,
  expiresAt: instant,
  status: z.enum(["PENDING", "REDEEMED", "REVOKED", "EXPIRED"])
}).strict();

export type AccountInvitationCode = z.infer<typeof accountInvitationCodeSchema>;
export type AccountInvitationActivationRequest = z.infer<typeof accountInvitationActivationRequestSchema>;
export type AccountInvitationActivationResponse = z.infer<typeof accountInvitationActivationResponseSchema>;
export type AccountInvitationActivationFailure = z.infer<typeof accountInvitationActivationFailureSchema>;
export type AccountInvitationIssueInput = z.infer<typeof accountInvitationIssueInputSchema>;
export type AccountInvitationIssueResponse = z.infer<typeof accountInvitationIssueResponseSchema>;
export type AccountInvitationRevokeInput = z.infer<typeof accountInvitationRevokeInputSchema>;
export type AccountInvitationRevokeResponse = z.infer<typeof accountInvitationRevokeResponseSchema>;
export type AccountInvitationStatusResponse = z.infer<typeof accountInvitationStatusResponseSchema>;
