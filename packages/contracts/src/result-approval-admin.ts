import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const approvableReasonSchema = z.enum(["MISSING_CONTROL", "WRONG_ORDER"]);
const technicalRevisionCauseSchema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION"
]);

export const RESULT_APPROVAL_POLICY_VERSION = "manual-result-approval-v1";
export const resultApprovalPolicyVersionSchema = z.literal(RESULT_APPROVAL_POLICY_VERSION);

export const resultApprovalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_approval_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultApprovalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("APPROVE_RESULT"),
  expiresAt: instantSchema
}).strict();

export const resultApprovalReadinessSchema = z.enum([
  "READY",
  "NO_ACTIVE_RESULT",
  "UNSUPPORTED_RESULT",
  "UNPUBLISHED_RESULT",
  "STALE_RESULT",
  "ACTIVE_APPROVAL",
  "ACTIVE_DISQUALIFICATION",
  "ACTIVE_DID_NOT_FINISH",
  "ACTIVE_OUT_OF_COMPETITION",
  "ACTIVE_WITHOUT_TIMING"
]);

export const resultApprovalTargetResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.literal("MP"),
  reason: approvableReasonSchema,
  cause: technicalRevisionCauseSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict();

const resultApprovalCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: resultApprovalReadinessSchema,
  targetResultRevision: resultApprovalTargetResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.targetResultRevision !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetResultRevision"],
      message: "Exakt targetrevision får endast lämnas för READY"
    });
  }
});

export const resultApprovalCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: resultApprovalPolicyVersionSchema,
  entries: z.array(resultApprovalCandidateEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  if (new Set(response.entries.map((entry) => entry.id)).size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
});

const expectedResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.literal("MP"),
  reason: approvableReasonSchema
}).strict();

export const resultApprovalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: resultApprovalPolicyVersionSchema
}).strict();

export const resultApprovalIdempotencyKeySchema = z.string().regex(
  /^manual-result-approval:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara manual-result-approval:<kanoniskt request-uuid>"
);

export const resultApprovalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  resultApprovalDecisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema,
  targetResultRevision: positiveVersionSchema,
  targetReason: approvableReasonSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_RESULT_APPROVAL"),
  status: z.literal("OK"),
  reason: z.literal("MANUAL_APPROVAL"),
  policyVersion: resultApprovalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict();

export const resultApprovalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const resultApprovalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultApprovalAdminErrorCodeSchema
}).strict();

export type ResultApprovalPolicyVersion = z.infer<typeof resultApprovalPolicyVersionSchema>;
export type ResultApprovalAdminLoginRequest = z.infer<typeof resultApprovalAdminLoginRequestSchema>;
export type ResultApprovalAdminLoginResponse = z.infer<typeof resultApprovalAdminLoginResponseSchema>;
export type ResultApprovalReadiness = z.infer<typeof resultApprovalReadinessSchema>;
export type ResultApprovalTargetResultRevision = z.infer<typeof resultApprovalTargetResultRevisionSchema>;
export type ResultApprovalCandidateResponse = z.infer<typeof resultApprovalCandidateResponseSchema>;
export type ResultApprovalRequest = z.infer<typeof resultApprovalRequestSchema>;
export type ResultApprovalResponse = z.infer<typeof resultApprovalResponseSchema>;
export type ResultApprovalAdminErrorCode = z.infer<typeof resultApprovalAdminErrorCodeSchema>;
export type ResultApprovalAdminErrorResponse = z.infer<typeof resultApprovalAdminErrorResponseSchema>;
