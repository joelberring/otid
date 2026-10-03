import { z } from "zod";
import {
  isValidStoredResultPair,
  storedResultReasonSchema,
  storedResultRevisionCauseV8Schema,
  storedResultStatusSchema
} from "./result-outcome";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const engineVersionSchema = z.string().trim().min(1).max(64);

export const resultRecalculationAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_recalc_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultRecalculationAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("RECALCULATE_RESULT"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

export const resultRecalculationReadinessSchema = z.enum([
  "READY",
  "NO_ACTIVE_ASSIGNMENT",
  "MULTIPLE_ACTIVE_ASSIGNMENTS",
  "NO_READOUT"
]);

export const resultRevisionCauseSchema = storedResultRevisionCauseV8Schema;

const cardResultStatusSchema = z.enum(["OK", "MP"]);
const cardResultReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);

function validCardResultPair(status: z.infer<typeof cardResultStatusSchema>, reason: z.infer<typeof cardResultReasonSchema>): boolean {
  return status === "OK" ? reason === "COMPLETE" : reason !== "COMPLETE";
}

const latestReadoutSchema = z.object({
  id: canonicalUuidSchema,
  readAt: z.iso.datetime({ offset: true })
}).strict();

const latestResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  cause: resultRevisionCauseSchema,
  createdAt: z.iso.datetime({ offset: true }),
  snapshotVersion: positiveVersionSchema
}).strict().superRefine((result, context) => {
  if (!isValidStoredResultPair(result.status, result.reason)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Status och orsak matchar inte" });
  }
});

const resultRecalculationCandidateEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  entryVersion: positiveVersionSchema,
  readiness: resultRecalculationReadinessSchema,
  cardAssignmentId: canonicalUuidSchema.nullable(),
  latestReadout: latestReadoutSchema.nullable(),
  latestResultRevision: latestResultRevisionSchema.nullable()
}).strict().superRefine((entry, context) => {
  const assignmentExpected = entry.readiness === "READY" || entry.readiness === "NO_READOUT";
  const readoutExpected = entry.readiness === "READY";
  if ((entry.cardAssignmentId !== null) !== assignmentExpected) {
    context.addIssue({ code: "custom", path: ["cardAssignmentId"], message: "Assignment matchar inte readiness" });
  }
  if ((entry.latestReadout !== null) !== readoutExpected) {
    context.addIssue({ code: "custom", path: ["latestReadout"], message: "Readout matchar inte readiness" });
  }
});

export const resultRecalculationCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  engineVersion: engineVersionSchema,
  entries: z.array(resultRecalculationCandidateEntrySchema)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  if (entryIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
});

const expectedLatestResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
}).strict();

export const resultRecalculationRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedCardAssignmentId: canonicalUuidSchema,
  expectedReadoutId: canonicalUuidSchema,
  expectedLatestResultRevision: expectedLatestResultRevisionSchema.nullable(),
  expectedEngineVersion: engineVersionSchema
}).strict();

export const resultRecalculationIdempotencyKeySchema = z.string().regex(
  /^result-recalculation:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara result-recalculation:<kanoniskt request-uuid>"
);

export const resultRecalculationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  readoutId: canonicalUuidSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("EXPLICIT_RECALCULATION"),
  status: cardResultStatusSchema,
  reason: cardResultReasonSchema,
  engineVersion: engineVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  recalculatedAt: z.iso.datetime({ offset: true })
}).strict().superRefine((result, context) => {
  if (!validCardResultPair(result.status, result.reason)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Status och orsak matchar inte" });
  }
});

export const resultRecalculationAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const resultRecalculationAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultRecalculationAdminErrorCodeSchema
}).strict();

export type ResultRecalculationAdminLoginRequest = z.infer<typeof resultRecalculationAdminLoginRequestSchema>;
export type ResultRecalculationAdminLoginResponse = z.infer<typeof resultRecalculationAdminLoginResponseSchema>;
export type ResultRecalculationReadiness = z.infer<typeof resultRecalculationReadinessSchema>;
export type ResultRecalculationCandidateResponse = z.infer<typeof resultRecalculationCandidateResponseSchema>;
export type ResultRecalculationRequest = z.infer<typeof resultRecalculationRequestSchema>;
export type ResultRecalculationResponse = z.infer<typeof resultRecalculationResponseSchema>;
export type ResultRecalculationAdminErrorCode = z.infer<typeof resultRecalculationAdminErrorCodeSchema>;
export type ResultRecalculationAdminErrorResponse = z.infer<typeof resultRecalculationAdminErrorResponseSchema>;
