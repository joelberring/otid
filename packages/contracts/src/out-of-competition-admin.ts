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

export const OUT_OF_COMPETITION_DECISION_POLICY_VERSION = "out-of-competition-v1";
export const outOfCompetitionDecisionPolicyVersionSchema = z.literal(
  OUT_OF_COMPETITION_DECISION_POLICY_VERSION
);

export const outOfCompetitionAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_out_of_competition_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const outOfCompetitionAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("DECIDE_OUT_OF_COMPETITION"),
  expiresAt: instantSchema
}).strict();

export const outOfCompetitionReadinessSchema = z.enum([
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

/** Minimal direct-technical target metadata; no readout, time or punch facts. */
export const outOfCompetitionTargetResultRevisionSchema = z.object({
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

const outOfCompetitionCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: outOfCompetitionReadinessSchema,
  targetResultRevision: outOfCompetitionTargetResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.targetResultRevision !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetResultRevision"],
      message: "Exakt targetrevision får endast lämnas för READY"
    });
  }
});

export const outOfCompetitionCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: outOfCompetitionDecisionPolicyVersionSchema,
  entries: z.array(outOfCompetitionCandidateEntrySchema).max(10_000)
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

export const outOfCompetitionRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: outOfCompetitionDecisionPolicyVersionSchema
}).strict();

export const outOfCompetitionIdempotencyKeySchema = z.string().regex(
  /^out-of-competition:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara out-of-competition:<kanoniskt request-uuid>"
);

export const outOfCompetitionResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  notCompetingDecisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema,
  targetResultRevision: positiveVersionSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_OUT_OF_COMPETITION"),
  status: z.literal("OOC"),
  reason: z.literal("OUT_OF_COMPETITION"),
  policyVersion: outOfCompetitionDecisionPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict().superRefine((response, context) => {
  if (response.resultRevisionId === response.targetResultRevisionId ||
      response.revision !== response.targetResultRevision + 1) {
    context.addIssue({
      code: "custom",
      path: ["revision"],
      message: "OOC-revisionen måste följa target direkt och ha en egen identitet"
    });
  }
});

export const outOfCompetitionAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const outOfCompetitionAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: outOfCompetitionAdminErrorCodeSchema
}).strict();

export type OutOfCompetitionDecisionPolicyVersion = z.infer<typeof outOfCompetitionDecisionPolicyVersionSchema>;
export type OutOfCompetitionAdminLoginRequest = z.infer<typeof outOfCompetitionAdminLoginRequestSchema>;
export type OutOfCompetitionAdminLoginResponse = z.infer<typeof outOfCompetitionAdminLoginResponseSchema>;
export type OutOfCompetitionReadiness = z.infer<typeof outOfCompetitionReadinessSchema>;
export type OutOfCompetitionTargetResultRevision = z.infer<typeof outOfCompetitionTargetResultRevisionSchema>;
export type OutOfCompetitionCandidateResponse = z.infer<typeof outOfCompetitionCandidateResponseSchema>;
export type OutOfCompetitionRequest = z.infer<typeof outOfCompetitionRequestSchema>;
export type OutOfCompetitionResponse = z.infer<typeof outOfCompetitionResponseSchema>;
export type OutOfCompetitionAdminErrorCode = z.infer<typeof outOfCompetitionAdminErrorCodeSchema>;
export type OutOfCompetitionAdminErrorResponse = z.infer<typeof outOfCompetitionAdminErrorResponseSchema>;
