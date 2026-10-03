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

export const WITHOUT_TIMING_DECISION_POLICY_VERSION = "without-timing-v1";
export const withoutTimingDecisionPolicyVersionSchema = z.literal(WITHOUT_TIMING_DECISION_POLICY_VERSION);

export const withoutTimingAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_without_timing_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const withoutTimingAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("DECIDE_WITHOUT_TIMING"),
  expiresAt: instantSchema
}).strict();

export const withoutTimingReadinessSchema = z.enum([
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

/** Deliberately limited to the technically proved current result. */
export const withoutTimingTargetResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.literal("OK"),
  reason: z.literal("COMPLETE"),
  cause: technicalRevisionCauseSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict();

const withoutTimingCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: withoutTimingReadinessSchema,
  targetResultRevision: withoutTimingTargetResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.targetResultRevision !== null)) {
    context.addIssue({
      code: "custom",
      path: ["targetResultRevision"],
      message: "Exakt targetrevision får endast lämnas för READY"
    });
  }
});

export const withoutTimingCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: withoutTimingDecisionPolicyVersionSchema,
  entries: z.array(withoutTimingCandidateEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  if (new Set(response.entries.map((entry) => entry.id)).size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
});

const expectedResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: z.literal("OK"),
  reason: z.literal("COMPLETE")
}).strict();

export const withoutTimingRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: withoutTimingDecisionPolicyVersionSchema
}).strict();

export const withoutTimingIdempotencyKeySchema = z.string().regex(
  /^without-timing:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara without-timing:<kanoniskt request-uuid>"
);

export const withoutTimingResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  withoutTimingDecisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema,
  targetResultRevision: positiveVersionSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_WITHOUT_TIMING"),
  status: z.literal("NT"),
  reason: z.literal("WITHOUT_TIMING"),
  policyVersion: withoutTimingDecisionPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict().superRefine((response, context) => {
  if (response.resultRevisionId === response.targetResultRevisionId ||
      response.revision !== response.targetResultRevision + 1) {
    context.addIssue({
      code: "custom",
      path: ["revision"],
      message: "NT-revisionen måste följa target direkt och ha en egen identitet"
    });
  }
});

export const withoutTimingAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const withoutTimingAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: withoutTimingAdminErrorCodeSchema
}).strict();

export type WithoutTimingDecisionPolicyVersion = z.infer<typeof withoutTimingDecisionPolicyVersionSchema>;
export type WithoutTimingAdminLoginRequest = z.infer<typeof withoutTimingAdminLoginRequestSchema>;
export type WithoutTimingAdminLoginResponse = z.infer<typeof withoutTimingAdminLoginResponseSchema>;
export type WithoutTimingReadiness = z.infer<typeof withoutTimingReadinessSchema>;
export type WithoutTimingTargetResultRevision = z.infer<typeof withoutTimingTargetResultRevisionSchema>;
export type WithoutTimingCandidateResponse = z.infer<typeof withoutTimingCandidateResponseSchema>;
export type WithoutTimingRequest = z.infer<typeof withoutTimingRequestSchema>;
export type WithoutTimingResponse = z.infer<typeof withoutTimingResponseSchema>;
export type WithoutTimingAdminErrorCode = z.infer<typeof withoutTimingAdminErrorCodeSchema>;
export type WithoutTimingAdminErrorResponse = z.infer<typeof withoutTimingAdminErrorResponseSchema>;
