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
const instantSchema = z.iso.datetime({ offset: true });

/** The first and only manual DNS-withdrawal policy in TASK 006F. */
export const DID_NOT_START_WITHDRAWAL_POLICY_VERSION = "did-not-start-withdrawal-v1";
export const didNotStartWithdrawalPolicyVersionSchema = z.literal(
  DID_NOT_START_WITHDRAWAL_POLICY_VERSION
);

export const didNotStartWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_did_not_start_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const didNotStartWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_DID_NOT_START"),
  expiresAt: instantSchema
}).strict();

export const didNotStartWithdrawalStateSchema = z.enum([
  "WITHDRAWABLE",
  "WITHDRAWN",
  "SUPERSEDED"
]);

const targetResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict();

const latestResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: storedResultRevisionCauseV8Schema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  createdAt: instantSchema,
  snapshotVersion: positiveVersionSchema
}).strict().superRefine((result, context) => {
  if (!isValidStoredResultPair(result.status, result.reason)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Status och orsak matchar inte" });
  }
});

const withdrawalMetadataSchema = z.object({
  id: canonicalUuidSchema,
  reason: z.literal("ERRONEOUS_MANUAL_DNS"),
  policyVersion: didNotStartWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

const didNotStartWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  didNotStartDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  state: didNotStartWithdrawalStateSchema,
  targetResultRevision: targetResultRevisionSchema,
  latestResultRevision: latestResultRevisionSchema,
  withdrawal: withdrawalMetadataSchema.nullable()
}).strict().superRefine((entry, context) => {
  const targetIsLatest = entry.targetResultRevision.id === entry.latestResultRevision.id &&
    entry.targetResultRevision.revision === entry.latestResultRevision.revision;

  if (entry.latestResultRevision.revision < entry.targetResultRevision.revision ||
      ((entry.targetResultRevision.id === entry.latestResultRevision.id) !==
       (entry.targetResultRevision.revision === entry.latestResultRevision.revision))) {
    context.addIssue({
      code: "custom",
      path: ["latestResultRevision"],
      message: "Senaste revisionen motsäger det manuella DNS-targetet"
    });
  }
  if (targetIsLatest &&
      (entry.latestResultRevision.cause !== "MANUAL_DID_NOT_START" ||
       entry.latestResultRevision.status !== "DNS" ||
       entry.latestResultRevision.reason !== "DID_NOT_START")) {
    context.addIssue({
      code: "custom",
      path: ["latestResultRevision"],
      message: "Det aktuella targethuvudet är inte ett manuellt DNS"
    });
  }

  const hasWithdrawal = entry.withdrawal !== null;
  if ((entry.state === "WITHDRAWN") !== hasWithdrawal) {
    context.addIssue({
      code: "custom",
      path: ["withdrawal"],
      message: "Withdrawalmetadata matchar inte beslutets state"
    });
  }
  if (entry.state === "WITHDRAWABLE" && !targetIsLatest) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Endast ett aktuellt DNS-resultathuvud kan återtas"
    });
  }
  if (entry.state === "SUPERSEDED" &&
      entry.latestResultRevision.revision <= entry.targetResultRevision.revision) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Superseded kräver en senare resultatrevision"
    });
  }
});

export const didNotStartWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  withdrawalPolicyVersion: didNotStartWithdrawalPolicyVersionSchema,
  entries: z.array(didNotStartWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.didNotStartDecisionId));
  const targetRevisionIds = new Set(response.entries.map((entry) => entry.targetResultRevision.id));
  if (entryIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
  if (decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "DNS-beslut måste vara unika" });
  }
  if (targetRevisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "DNS-resultattarget måste vara unika" });
  }
});

const expectedResultRevisionSchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
}).strict();

/** The entry id is route-scoped; all mutable facts and the exact DNS target are frozen here. */
export const didNotStartWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedDidNotStartDecisionId: canonicalUuidSchema,
  expectedResultRevision: expectedResultRevisionSchema,
  policyVersion: didNotStartWithdrawalPolicyVersionSchema
}).strict();

export const didNotStartWithdrawalIdempotencyKeySchema = z.string().regex(
  /^did-not-start-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara did-not-start-withdrawal:<kanoniskt request-uuid>"
);

/** Immutable withdrawal metadata; deliberately no result status or readout fields. */
export const didNotStartWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  withdrawalId: canonicalUuidSchema,
  didNotStartDecisionId: canonicalUuidSchema,
  withdrawnResultRevisionId: canonicalUuidSchema,
  withdrawnResultRevision: positiveVersionSchema,
  withdrawalPolicyVersion: didNotStartWithdrawalPolicyVersionSchema,
  reason: z.literal("ERRONEOUS_MANUAL_DNS"),
  withdrawnAt: instantSchema
}).strict();

export const didNotStartWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const didNotStartWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: didNotStartWithdrawalAdminErrorCodeSchema
}).strict();

export type DidNotStartWithdrawalPolicyVersion = z.infer<typeof didNotStartWithdrawalPolicyVersionSchema>;
export type DidNotStartWithdrawalAdminLoginRequest = z.infer<typeof didNotStartWithdrawalAdminLoginRequestSchema>;
export type DidNotStartWithdrawalAdminLoginResponse = z.infer<typeof didNotStartWithdrawalAdminLoginResponseSchema>;
export type DidNotStartWithdrawalState = z.infer<typeof didNotStartWithdrawalStateSchema>;
export type DidNotStartWithdrawalListResponse = z.infer<typeof didNotStartWithdrawalListResponseSchema>;
export type DidNotStartWithdrawalRequest = z.infer<typeof didNotStartWithdrawalRequestSchema>;
export type DidNotStartWithdrawalResponse = z.infer<typeof didNotStartWithdrawalResponseSchema>;
export type DidNotStartWithdrawalAdminErrorCode = z.infer<typeof didNotStartWithdrawalAdminErrorCodeSchema>;
export type DidNotStartWithdrawalAdminErrorResponse = z.infer<typeof didNotStartWithdrawalAdminErrorResponseSchema>;
