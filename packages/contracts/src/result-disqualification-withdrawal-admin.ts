import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const restorableStatusSchema = z.enum(["OK", "MP"]);
const restorableReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);

export const RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION =
  "manual-disqualification-withdrawal-v1";
export const resultDisqualificationWithdrawalPolicyVersionSchema = z.literal(
  RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION
);

export const resultDisqualificationWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_disqualification_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultDisqualificationWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_DISQUALIFICATION"),
  expiresAt: instantSchema
}).strict();

export const resultDisqualificationWithdrawalStateSchema = z.enum(["WITHDRAWABLE", "WITHDRAWN"]);

const revisionIdentitySchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
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
  policyVersion: resultDisqualificationWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

const resultDisqualificationWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  state: resultDisqualificationWithdrawalStateSchema,
  resultDisqualificationDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  targetResultRevision: revisionIdentitySchema,
  disqualifiedResultRevision: revisionIdentitySchema,
  absoluteResultRevision: revisionIdentitySchema,
  restorationSourceResultRevision: restorationSourceRevisionSchema,
  withdrawal: withdrawalMetadataSchema.nullable()
}).strict().superRefine((entry, context) => {
  if (entry.disqualifiedResultRevision.revision <= entry.targetResultRevision.revision) {
    context.addIssue({ code: "custom", path: ["disqualifiedResultRevision"], message: "DSQ-revisionen måste följa target" });
  }
  if (entry.absoluteResultRevision.revision < entry.disqualifiedResultRevision.revision ||
      entry.restorationSourceResultRevision.revision > entry.absoluteResultRevision.revision) {
    context.addIssue({ code: "custom", path: ["absoluteResultRevision"], message: "Revisionsordningen är motsägelsefull" });
  }
  if ((entry.state === "WITHDRAWN") !== (entry.withdrawal !== null)) {
    context.addIssue({ code: "custom", path: ["withdrawal"], message: "Withdrawalmetadata matchar inte state" });
  }
});

export const resultDisqualificationWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: resultDisqualificationWithdrawalPolicyVersionSchema,
  entries: z.array(resultDisqualificationWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.resultDisqualificationDecisionId));
  if (entryIds.size !== response.entries.length || decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries och beslut måste vara unika" });
  }
});

export const resultDisqualificationWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultDisqualificationDecisionId: canonicalUuidSchema,
  expectedTargetResultRevision: revisionIdentitySchema,
  expectedDisqualifiedResultRevision: revisionIdentitySchema,
  expectedAbsoluteResultRevision: revisionIdentitySchema,
  expectedRestorationSourceResultRevision: restorationSourceRevisionSchema,
  policyVersion: resultDisqualificationWithdrawalPolicyVersionSchema
}).strict();

export const resultDisqualificationWithdrawalIdempotencyKeySchema = z.string().regex(
  /^manual-disqualification-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara manual-disqualification-withdrawal:<kanoniskt request-uuid>"
);

export const resultDisqualificationWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  resultDisqualificationWithdrawalId: canonicalUuidSchema,
  resultDisqualificationDecisionId: canonicalUuidSchema,
  disqualifiedResultRevisionId: canonicalUuidSchema,
  restorationSourceResultRevisionId: canonicalUuidSchema,
  restorationResultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  policyVersion: resultDisqualificationWithdrawalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  withdrawnAt: instantSchema
}).strict().superRefine((response, context) => {
  const valid = response.status === "OK"
    ? response.reason === "COMPLETE"
    : response.reason !== "COMPLETE";
  if (!valid) context.addIssue({ code: "custom", path: ["reason"], message: "Restaurerad status och orsak matchar inte" });
});

export const resultDisqualificationWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const resultDisqualificationWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultDisqualificationWithdrawalAdminErrorCodeSchema
}).strict();

export type ResultDisqualificationWithdrawalPolicyVersion = z.infer<typeof resultDisqualificationWithdrawalPolicyVersionSchema>;
export type ResultDisqualificationWithdrawalAdminLoginRequest = z.infer<typeof resultDisqualificationWithdrawalAdminLoginRequestSchema>;
export type ResultDisqualificationWithdrawalAdminLoginResponse = z.infer<typeof resultDisqualificationWithdrawalAdminLoginResponseSchema>;
export type ResultDisqualificationWithdrawalState = z.infer<typeof resultDisqualificationWithdrawalStateSchema>;
export type ResultDisqualificationWithdrawalListResponse = z.infer<typeof resultDisqualificationWithdrawalListResponseSchema>;
export type ResultDisqualificationWithdrawalRequest = z.infer<typeof resultDisqualificationWithdrawalRequestSchema>;
export type ResultDisqualificationWithdrawalResponse = z.infer<typeof resultDisqualificationWithdrawalResponseSchema>;
export type ResultDisqualificationWithdrawalAdminErrorCode = z.infer<typeof resultDisqualificationWithdrawalAdminErrorCodeSchema>;
export type ResultDisqualificationWithdrawalAdminErrorResponse = z.infer<typeof resultDisqualificationWithdrawalAdminErrorResponseSchema>;
