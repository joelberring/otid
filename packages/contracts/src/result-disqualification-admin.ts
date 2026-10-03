import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const disqualifiableReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);
const technicalRevisionCauseSchema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION"
]);

export const RESULT_DISQUALIFICATION_POLICY_VERSION = "manual-disqualification-v1";
export const resultDisqualificationPolicyVersionSchema = z.literal(
  RESULT_DISQUALIFICATION_POLICY_VERSION
);

export const resultDisqualificationAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_disqualification_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultDisqualificationAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("DISQUALIFY_RESULT"),
  expiresAt: instantSchema
}).strict();

export const resultDisqualificationReadinessSchema = z.enum([
  "READY",
  "NO_ACTIVE_RESULT",
  "UNSUPPORTED_RESULT",
  "UNPUBLISHED_RESULT",
  "STALE_RESULT",
  "ACTIVE_DISQUALIFICATION",
  "ACTIVE_APPROVAL",
  "ACTIVE_DID_NOT_FINISH",
  "ACTIVE_OUT_OF_COMPETITION",
  "ACTIVE_WITHOUT_TIMING"
]);

export const resultDisqualificationTargetResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.enum(["OK", "MP"]),
  reason: disqualifiableReasonSchema,
  cause: technicalRevisionCauseSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict().superRefine((target, context) => {
  const valid = target.status === "OK"
    ? target.reason === "COMPLETE"
    : target.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Targetstatus och orsak matchar inte" });
  }
});

const resultDisqualificationCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: resultDisqualificationReadinessSchema,
  targetResultRevision: resultDisqualificationTargetResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.targetResultRevision !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetResultRevision"],
      message: "Exakt targetrevision får endast lämnas för READY"
    });
  }
});

export const resultDisqualificationCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: resultDisqualificationPolicyVersionSchema,
  entries: z.array(resultDisqualificationCandidateEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  if (new Set(response.entries.map((entry) => entry.id)).size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
});

const expectedResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.enum(["OK", "MP"])
}).strict();

export const resultDisqualificationRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: resultDisqualificationPolicyVersionSchema
}).strict();

export const resultDisqualificationIdempotencyKeySchema = z.string().regex(
  /^manual-disqualification:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara manual-disqualification:<kanoniskt request-uuid>"
);

export const resultDisqualificationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  resultDisqualificationDecisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema,
  targetResultRevision: positiveVersionSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_DISQUALIFICATION"),
  status: z.literal("DSQ"),
  reason: z.literal("MANUAL_DISQUALIFICATION"),
  policyVersion: resultDisqualificationPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict();

export const resultDisqualificationAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const resultDisqualificationAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultDisqualificationAdminErrorCodeSchema
}).strict();

export type ResultDisqualificationPolicyVersion = z.infer<typeof resultDisqualificationPolicyVersionSchema>;
export type ResultDisqualificationAdminLoginRequest = z.infer<typeof resultDisqualificationAdminLoginRequestSchema>;
export type ResultDisqualificationAdminLoginResponse = z.infer<typeof resultDisqualificationAdminLoginResponseSchema>;
export type ResultDisqualificationReadiness = z.infer<typeof resultDisqualificationReadinessSchema>;
export type ResultDisqualificationTargetResultRevision = z.infer<typeof resultDisqualificationTargetResultRevisionSchema>;
export type ResultDisqualificationCandidateResponse = z.infer<typeof resultDisqualificationCandidateResponseSchema>;
export type ResultDisqualificationRequest = z.infer<typeof resultDisqualificationRequestSchema>;
export type ResultDisqualificationResponse = z.infer<typeof resultDisqualificationResponseSchema>;
export type ResultDisqualificationAdminErrorCode = z.infer<typeof resultDisqualificationAdminErrorCodeSchema>;
export type ResultDisqualificationAdminErrorResponse = z.infer<typeof resultDisqualificationAdminErrorResponseSchema>;
