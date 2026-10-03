import { z } from "zod";
import { accountInvitationCodeSchema } from "./account-invitation";

const canonicalUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${canonicalUuidPattern}$`));
const instant = z.iso.datetime({ offset: true });
const loginName = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/);
const operatorLabel = z.string().trim().min(1).max(120);
const reason = z.string().trim().min(1).max(240);

// Keep the recovery secret on the same canonical 32-byte encoding as A3a.
export const accountPasswordRecoveryCodeSchema = accountInvitationCodeSchema;

export const accountPasswordRecoveryIssueInputSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  accountId: uuid,
  loginName,
  operatorLabel,
  reason,
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: instant
}).strict();

export const accountPasswordRecoveryIssueResponseSchema = z.object({
  formatVersion: z.literal(1),
  recoveryId: uuid,
  accountId: uuid,
  loginName,
  expiresAt: instant
}).strict();

export const accountPasswordRecoveryRevokeInputSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  recoveryId: uuid,
  operatorLabel,
  reason
}).strict();

export const accountPasswordRecoveryRevokeResponseSchema = z.object({
  formatVersion: z.literal(1),
  recoveryId: uuid,
  status: z.literal("REVOKED")
}).strict();

export const accountPasswordRecoveryStatusResponseSchema = z.object({
  formatVersion: z.literal(1),
  recoveryId: uuid,
  accountId: uuid,
  loginName,
  issuedAt: instant,
  expiresAt: instant,
  status: z.enum(["PENDING", "REDEEMED", "REVOKED", "EXPIRED"])
}).strict();

export const accountPasswordRecoveryRedeemRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  loginName,
  code: accountPasswordRecoveryCodeSchema,
  password: accountPasswordRecoveryCodeSchema
}).strict();

export const accountPasswordRecoveryRedeemResponseSchema = z.object({
  formatVersion: z.literal(1),
  accountId: uuid,
  loginName,
  passwordVersion: z.number().int().positive()
}).strict();

export const accountPasswordRecoveryRedeemFailureSchema = z.object({
  formatVersion: z.literal(1),
  error: z.literal("RECOVERY_UNAVAILABLE")
}).strict();

export type AccountPasswordRecoveryCode = z.infer<typeof accountPasswordRecoveryCodeSchema>;
export type AccountPasswordRecoveryIssueInput = z.infer<typeof accountPasswordRecoveryIssueInputSchema>;
export type AccountPasswordRecoveryIssueResponse = z.infer<typeof accountPasswordRecoveryIssueResponseSchema>;
export type AccountPasswordRecoveryRevokeInput = z.infer<typeof accountPasswordRecoveryRevokeInputSchema>;
export type AccountPasswordRecoveryRevokeResponse = z.infer<typeof accountPasswordRecoveryRevokeResponseSchema>;
export type AccountPasswordRecoveryStatusResponse = z.infer<typeof accountPasswordRecoveryStatusResponseSchema>;
export type AccountPasswordRecoveryRedeemRequest = z.infer<typeof accountPasswordRecoveryRedeemRequestSchema>;
export type AccountPasswordRecoveryRedeemResponse = z.infer<typeof accountPasswordRecoveryRedeemResponseSchema>;
export type AccountPasswordRecoveryRedeemFailure = z.infer<typeof accountPasswordRecoveryRedeemFailureSchema>;
