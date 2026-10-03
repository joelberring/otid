import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const approvableReasonSchema = z.enum(["MISSING_CONTROL", "WRONG_ORDER"]);
const restorableStatusSchema = z.enum(["OK", "MP"]);
const restorableReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);

export const RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION =
  "manual-result-approval-withdrawal-v1";
export const resultApprovalWithdrawalPolicyVersionSchema = z.literal(
  RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION
);

export const resultApprovalWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_approval_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultApprovalWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_RESULT_APPROVAL"),
  expiresAt: instantSchema
}).strict();

export const resultApprovalWithdrawalStateSchema = z.enum(["WITHDRAWABLE", "WITHDRAWN"]);

const revisionIdentitySchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
}).strict();

const approvalTargetRevisionSchema = revisionIdentitySchema.extend({
  status: z.literal("MP"),
  reason: approvableReasonSchema
}).strict();

const restorationSourceRevisionSchema = revisionIdentitySchema.extend({
  status: restorableStatusSchema,
  reason: restorableReasonSchema
}).strict().superRefine((source, context) => {
  const valid = source.status === "OK" ? source.reason === "COMPLETE" : source.reason !== "COMPLETE";
  if (!valid) context.addIssue({ code: "custom", path: ["reason"], message: "Källstatus och orsak matchar inte" });
});

const withdrawalMetadataSchema = z.object({
  id: canonicalUuidSchema,
  restorationResultRevision: revisionIdentitySchema,
  policyVersion: resultApprovalWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

const resultApprovalWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  state: resultApprovalWithdrawalStateSchema,
  resultApprovalDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  targetResultRevision: approvalTargetRevisionSchema,
  approvedResultRevision: revisionIdentitySchema,
  absoluteResultRevision: revisionIdentitySchema,
  restorationSourceResultRevision: restorationSourceRevisionSchema,
  withdrawal: withdrawalMetadataSchema.nullable()
}).strict().superRefine((entry, context) => {
  if (entry.approvedResultRevision.revision <= entry.targetResultRevision.revision) {
    context.addIssue({ code: "custom", path: ["approvedResultRevision"], message: "Godkännanderevisionen måste följa target" });
  }
  if (entry.absoluteResultRevision.revision < entry.approvedResultRevision.revision ||
      entry.restorationSourceResultRevision.revision > entry.absoluteResultRevision.revision) {
    context.addIssue({ code: "custom", path: ["absoluteResultRevision"], message: "Revisionsordningen är motsägelsefull" });
  }
  if ((entry.state === "WITHDRAWN") !== (entry.withdrawal !== null)) {
    context.addIssue({ code: "custom", path: ["withdrawal"], message: "Withdrawalmetadata matchar inte state" });
  }
});

export const resultApprovalWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: resultApprovalWithdrawalPolicyVersionSchema,
  entries: z.array(resultApprovalWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.resultApprovalDecisionId));
  if (entryIds.size !== response.entries.length || decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries och beslut måste vara unika" });
  }
});

export const resultApprovalWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultApprovalDecisionId: canonicalUuidSchema,
  expectedTargetResultRevision: approvalTargetRevisionSchema,
  expectedApprovedResultRevision: revisionIdentitySchema,
  expectedAbsoluteResultRevision: revisionIdentitySchema,
  expectedRestorationSourceResultRevision: restorationSourceRevisionSchema,
  policyVersion: resultApprovalWithdrawalPolicyVersionSchema
}).strict();

export const resultApprovalWithdrawalIdempotencyKeySchema = z.string().regex(
  /^manual-result-approval-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara manual-result-approval-withdrawal:<kanoniskt request-uuid>"
);

export const resultApprovalWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  resultApprovalWithdrawalId: canonicalUuidSchema,
  resultApprovalDecisionId: canonicalUuidSchema,
  approvedResultRevisionId: canonicalUuidSchema,
  restorationSourceResultRevisionId: canonicalUuidSchema,
  restorationResultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  policyVersion: resultApprovalWithdrawalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  withdrawnAt: instantSchema
}).strict().superRefine((response, context) => {
  const valid = response.status === "OK"
    ? response.reason === "COMPLETE"
    : response.reason !== "COMPLETE";
  if (!valid) context.addIssue({ code: "custom", path: ["reason"], message: "Restaurerad status och orsak matchar inte" });
});

export const resultApprovalWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const resultApprovalWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultApprovalWithdrawalAdminErrorCodeSchema
}).strict();

export type ResultApprovalWithdrawalPolicyVersion = z.infer<typeof resultApprovalWithdrawalPolicyVersionSchema>;
export type ResultApprovalWithdrawalAdminLoginRequest = z.infer<typeof resultApprovalWithdrawalAdminLoginRequestSchema>;
export type ResultApprovalWithdrawalAdminLoginResponse = z.infer<typeof resultApprovalWithdrawalAdminLoginResponseSchema>;
export type ResultApprovalWithdrawalState = z.infer<typeof resultApprovalWithdrawalStateSchema>;
export type ResultApprovalWithdrawalListResponse = z.infer<typeof resultApprovalWithdrawalListResponseSchema>;
export type ResultApprovalWithdrawalRequest = z.infer<typeof resultApprovalWithdrawalRequestSchema>;
export type ResultApprovalWithdrawalResponse = z.infer<typeof resultApprovalWithdrawalResponseSchema>;
export type ResultApprovalWithdrawalAdminErrorCode = z.infer<typeof resultApprovalWithdrawalAdminErrorCodeSchema>;
export type ResultApprovalWithdrawalAdminErrorResponse = z.infer<typeof resultApprovalWithdrawalAdminErrorResponseSchema>;
