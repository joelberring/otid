import { z } from "zod";
import {
  DID_NOT_START_DECISION_POLICY_VERSION,
  didNotStartDecisionPolicyVersionSchema,
  isValidStoredResultPair,
  storedResultReasonSchema,
  storedResultStatusSchema
} from "./result-outcome";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });

export const didNotStartAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_did_not_start_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const didNotStartAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("DECIDE_DID_NOT_START"),
  expiresAt: instantSchema
}).strict();

export const didNotStartReadinessSchema = z.enum(["READY", "HAS_RESULT"]);

const latestResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict().superRefine((result, context) => {
  if (!isValidStoredResultPair(result.status, result.reason)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Status och orsak matchar inte" });
  }
});

const didNotStartCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  readiness: didNotStartReadinessSchema,
  latestResultRevision: latestResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.readiness === "READY") !== (entry.latestResultRevision === null)) {
    context.addIssue({
      code: "custom",
      path: ["latestResultRevision"],
      message: "Revisionshuvudet matchar inte kandidatens readiness"
    });
  }
});

export const didNotStartCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  decisionPolicyVersion: didNotStartDecisionPolicyVersionSchema,
  entries: z.array(didNotStartCandidateEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  if (new Set(response.entries.map((entry) => entry.id)).size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
});

/** The entry id is route-scoped; every other mutable fact is frozen in body. */
export const didNotStartRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedLatestResultRevision: z.null(),
  policyVersion: didNotStartDecisionPolicyVersionSchema
}).strict();

export const didNotStartIdempotencyKeySchema = z.string().regex(
  /^did-not-start:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara did-not-start:<kanoniskt request-uuid>"
);

export const didNotStartResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  didNotStartDecisionId: canonicalUuidSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_DID_NOT_START"),
  status: z.literal("DNS"),
  reason: z.literal("DID_NOT_START"),
  decisionPolicyVersion: z.literal(DID_NOT_START_DECISION_POLICY_VERSION),
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  decidedAt: instantSchema
}).strict();

export const didNotStartAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const didNotStartAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: didNotStartAdminErrorCodeSchema
}).strict();

export type DidNotStartAdminLoginRequest = z.infer<typeof didNotStartAdminLoginRequestSchema>;
export type DidNotStartAdminLoginResponse = z.infer<typeof didNotStartAdminLoginResponseSchema>;
export type DidNotStartReadiness = z.infer<typeof didNotStartReadinessSchema>;
export type DidNotStartCandidateResponse = z.infer<typeof didNotStartCandidateResponseSchema>;
export type DidNotStartRequest = z.infer<typeof didNotStartRequestSchema>;
export type DidNotStartResponse = z.infer<typeof didNotStartResponseSchema>;
export type DidNotStartAdminErrorCode = z.infer<typeof didNotStartAdminErrorCodeSchema>;
