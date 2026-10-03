import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const technicalRevisionCauseSchema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION"
]);
const technicalReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);

export const DID_NOT_FINISH_DECISION_POLICY_VERSION = "did-not-finish-v1";
export const didNotFinishDecisionPolicyVersionSchema = z.literal(DID_NOT_FINISH_DECISION_POLICY_VERSION);

export const didNotFinishAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_did_not_finish_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const didNotFinishAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("DECIDE_DID_NOT_FINISH"),
  expiresAt: instantSchema
}).strict();

export const didNotFinishReadinessSchema = z.enum([
  "READY",
  "NO_ACTIVE_RESULT",
  "UNSUPPORTED_RESULT",
  "UNPUBLISHED_RESULT",
  "STALE_RESULT",
  "ACTIVE_DID_NOT_START",
  "ACTIVE_DISQUALIFICATION",
  "ACTIVE_APPROVAL",
  "ACTIVE_DID_NOT_FINISH",
  "ACTIVE_OUT_OF_COMPETITION",
  "ACTIVE_WITHOUT_TIMING"
]);

/** Minimal target metadata. It intentionally excludes readout, time and punch facts. */
export const didNotFinishTargetResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.enum(["OK", "MP"]),
  reason: technicalReasonSchema,
  cause: technicalRevisionCauseSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict().superRefine((target, context) => {
  const valid = target.status === "OK" ? target.reason === "COMPLETE" : target.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Targetstatus och orsak matchar inte" });
  }
});

const didNotFinishCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: didNotFinishReadinessSchema,
  targetResultRevision: didNotFinishTargetResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.targetResultRevision !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetResultRevision"],
      message: "Exakt targetrevision får endast lämnas för READY"
    });
  }
});

export const didNotFinishCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: didNotFinishDecisionPolicyVersionSchema,
  entries: z.array(didNotFinishCandidateEntrySchema).max(10_000)
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

export const didNotFinishRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: didNotFinishDecisionPolicyVersionSchema
}).strict();

export const didNotFinishIdempotencyKeySchema = z.string().regex(
  /^did-not-finish:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara did-not-finish:<kanoniskt request-uuid>"
);

export const didNotFinishResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  didNotFinishDecisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema,
  targetResultRevision: positiveVersionSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_DID_NOT_FINISH"),
  status: z.literal("DNF"),
  reason: z.literal("DID_NOT_FINISH"),
  policyVersion: didNotFinishDecisionPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict();

export const didNotFinishAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const didNotFinishAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: didNotFinishAdminErrorCodeSchema
}).strict();

export type DidNotFinishDecisionPolicyVersion = z.infer<typeof didNotFinishDecisionPolicyVersionSchema>;
export type DidNotFinishAdminLoginRequest = z.infer<typeof didNotFinishAdminLoginRequestSchema>;
export type DidNotFinishAdminLoginResponse = z.infer<typeof didNotFinishAdminLoginResponseSchema>;
export type DidNotFinishReadiness = z.infer<typeof didNotFinishReadinessSchema>;
export type DidNotFinishTargetResultRevision = z.infer<typeof didNotFinishTargetResultRevisionSchema>;
export type DidNotFinishCandidateResponse = z.infer<typeof didNotFinishCandidateResponseSchema>;
export type DidNotFinishRequest = z.infer<typeof didNotFinishRequestSchema>;
export type DidNotFinishResponse = z.infer<typeof didNotFinishResponseSchema>;
export type DidNotFinishAdminErrorCode = z.infer<typeof didNotFinishAdminErrorCodeSchema>;
export type DidNotFinishAdminErrorResponse = z.infer<typeof didNotFinishAdminErrorResponseSchema>;
