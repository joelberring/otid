import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const instantSchema = z.iso.datetime({ offset: true });
const restorableStatusSchema = z.enum(["OK", "MP"]);
const restorableReasonSchema = z.enum([
  "COMPLETE", "MISSING_START", "MISSING_FINISH", "MISSING_CONTROL", "WRONG_ORDER", "INVALID_TIME_ORDER"
]);
const technicalRevisionCauseSchema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "UNKNOWN_READOUT_RESOLUTION"
]);

export const WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION = "without-timing-withdrawal-v1";
export const withoutTimingWithdrawalPolicyVersionSchema = z.literal(
  WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION
);

export const withoutTimingWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_without_timing_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const withoutTimingWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_WITHOUT_TIMING"),
  expiresAt: instantSchema
}).strict();

export const withoutTimingWithdrawalStateSchema = z.enum(["WITHDRAWABLE", "WITHDRAWN"]);

const revisionIdentitySchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
}).strict();

const restorationSourceRevisionSchema = revisionIdentitySchema.extend({
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  cause: technicalRevisionCauseSchema
}).strict().superRefine((source, context) => {
  const valid = source.status === "OK" ? source.reason === "COMPLETE" : source.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Källstatus och orsak matchar inte" });
  }
});

const withdrawalMetadataSchema = z.object({
  id: canonicalUuidSchema,
  restorationResultRevision: revisionIdentitySchema,
  reason: z.literal("ERRONEOUS_MANUAL_WITHOUT_TIMING"),
  policyVersion: withoutTimingWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

function validateRevisionChain(
  value: {
    targetResultRevision: z.infer<typeof revisionIdentitySchema>;
    withoutTimingResultRevision: z.infer<typeof revisionIdentitySchema>;
    absoluteResultRevision: z.infer<typeof revisionIdentitySchema>;
    restorationSourceResultRevision: z.infer<typeof restorationSourceRevisionSchema>;
  },
  context: z.RefinementCtx
): void {
  if (value.targetResultRevision.id === value.withoutTimingResultRevision.id ||
      value.withoutTimingResultRevision.revision !== value.targetResultRevision.revision + 1) {
    context.addIssue({ code: "custom", path: ["withoutTimingResultRevision"], message: "NT-revisionen måste vara targetets exakta efterföljare" });
  }
  const noLaterHead = value.absoluteResultRevision.id === value.withoutTimingResultRevision.id &&
    value.absoluteResultRevision.revision === value.withoutTimingResultRevision.revision;
  const laterHead = value.absoluteResultRevision.id !== value.withoutTimingResultRevision.id &&
    value.absoluteResultRevision.id !== value.targetResultRevision.id &&
    value.absoluteResultRevision.revision > value.withoutTimingResultRevision.revision;
  if (!noLaterHead && !laterHead) {
    context.addIssue({ code: "custom", path: ["absoluteResultRevision"], message: "Absolut resultathuvud måste vara NT-revisionen eller en senare revision" });
  }
  const sourceMatches = noLaterHead
    ? value.restorationSourceResultRevision.id === value.targetResultRevision.id &&
      value.restorationSourceResultRevision.revision === value.targetResultRevision.revision
    : laterHead && value.restorationSourceResultRevision.id === value.absoluteResultRevision.id &&
      value.restorationSourceResultRevision.revision === value.absoluteResultRevision.revision;
  if (!sourceMatches) {
    context.addIssue({ code: "custom", path: ["restorationSourceResultRevision"], message: "Restaureringskällan måste vara exakt target eller exakt senare absolut huvud" });
  }
}

function validateWithoutTimingSuccessor(
  target: z.infer<typeof revisionIdentitySchema>,
  withoutTiming: z.infer<typeof revisionIdentitySchema>,
  context: z.RefinementCtx
): void {
  if (target.id === withoutTiming.id || withoutTiming.revision !== target.revision + 1) {
    context.addIssue({ code: "custom", path: ["withoutTimingResultRevision"], message: "NT-revisionen måste vara targetets exakta efterföljare" });
  }
}

const withoutTimingWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  state: withoutTimingWithdrawalStateSchema,
  withoutTimingDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  targetResultRevision: revisionIdentitySchema,
  withoutTimingResultRevision: revisionIdentitySchema,
  absoluteResultRevision: revisionIdentitySchema,
  restorationSourceResultRevision: restorationSourceRevisionSchema,
  withdrawal: withdrawalMetadataSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.state === "WITHDRAWN") !== (entry.withdrawal !== null)) {
    context.addIssue({ code: "custom", path: ["withdrawal"], message: "Withdrawalmetadata matchar inte state" });
  }
  if (entry.state === "WITHDRAWABLE") validateRevisionChain(entry, context);
  else validateWithoutTimingSuccessor(entry.targetResultRevision, entry.withoutTimingResultRevision, context);
  if (entry.withdrawal !== null) {
    const sourceIsTarget = entry.restorationSourceResultRevision.id === entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.revision === entry.targetResultRevision.revision;
    const sourceIsLaterTechnical = entry.restorationSourceResultRevision.id !== entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.id !== entry.withoutTimingResultRevision.id &&
      entry.restorationSourceResultRevision.revision > entry.withoutTimingResultRevision.revision;
    if (!sourceIsTarget && !sourceIsLaterTechnical) {
      context.addIssue({ code: "custom", path: ["restorationSourceResultRevision"], message: "Restaureringskällan måste vara exakt target eller en distinkt senare teknisk revision" });
    }
    const restoration = entry.withdrawal.restorationResultRevision;
    if (restoration.id === entry.targetResultRevision.id || restoration.id === entry.withoutTimingResultRevision.id ||
        restoration.id === entry.restorationSourceResultRevision.id ||
        restoration.revision !== Math.max(entry.withoutTimingResultRevision.revision, entry.restorationSourceResultRevision.revision) + 1) {
      context.addIssue({ code: "custom", path: ["withdrawal", "restorationResultRevision"], message: "Restaureringsrevisionen måste följa exakt efter NT eller en senare teknisk källa" });
    }
    const restorationIsAbsolute = entry.absoluteResultRevision.id === restoration.id && entry.absoluteResultRevision.revision === restoration.revision;
    const absoluteIsLater = entry.absoluteResultRevision.id !== restoration.id && entry.absoluteResultRevision.revision > restoration.revision;
    if (!restorationIsAbsolute && !absoluteIsLater) {
      context.addIssue({ code: "custom", path: ["absoluteResultRevision"], message: "Absolut huvud måste vara restaureringen eller en senare revision" });
    }
  }
});

export const withoutTimingWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: withoutTimingWithdrawalPolicyVersionSchema,
  entries: z.array(withoutTimingWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.withoutTimingDecisionId));
  if (entryIds.size !== response.entries.length || decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries och NT-beslut måste vara unika" });
  }
});

export const withoutTimingWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedWithoutTimingDecisionId: canonicalUuidSchema,
  expectedTargetResultRevision: revisionIdentitySchema,
  expectedWithoutTimingResultRevision: revisionIdentitySchema,
  expectedAbsoluteResultRevision: revisionIdentitySchema,
  expectedRestorationSourceResultRevision: restorationSourceRevisionSchema,
  reason: z.literal("ERRONEOUS_MANUAL_WITHOUT_TIMING"),
  policyVersion: withoutTimingWithdrawalPolicyVersionSchema
}).strict().superRefine((request, context) => validateRevisionChain({
  targetResultRevision: request.expectedTargetResultRevision,
  withoutTimingResultRevision: request.expectedWithoutTimingResultRevision,
  absoluteResultRevision: request.expectedAbsoluteResultRevision,
  restorationSourceResultRevision: request.expectedRestorationSourceResultRevision
}, context));

export const withoutTimingWithdrawalIdempotencyKeySchema = z.string().regex(
  /^without-timing-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara without-timing-withdrawal:<kanoniskt request-uuid>"
);

export const withoutTimingWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  withoutTimingWithdrawalId: canonicalUuidSchema,
  withoutTimingDecisionId: canonicalUuidSchema,
  withoutTimingResultRevisionId: canonicalUuidSchema,
  restorationSourceResultRevisionId: canonicalUuidSchema,
  restorationResultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_WITHOUT_TIMING_WITHDRAWAL"),
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  withdrawalReason: z.literal("ERRONEOUS_MANUAL_WITHOUT_TIMING"),
  policyVersion: withoutTimingWithdrawalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  withdrawnAt: instantSchema
}).strict().superRefine((response, context) => {
  if ((response.status === "OK" && response.reason !== "COMPLETE") ||
      (response.status === "MP" && response.reason === "COMPLETE")) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Restaurerad status och orsak matchar inte" });
  }
});

export const withoutTimingWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"
]);
export const withoutTimingWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1), error: withoutTimingWithdrawalAdminErrorCodeSchema
}).strict();

export type WithoutTimingWithdrawalPolicyVersion = z.infer<typeof withoutTimingWithdrawalPolicyVersionSchema>;
export type WithoutTimingWithdrawalAdminLoginRequest = z.infer<typeof withoutTimingWithdrawalAdminLoginRequestSchema>;
export type WithoutTimingWithdrawalAdminLoginResponse = z.infer<typeof withoutTimingWithdrawalAdminLoginResponseSchema>;
export type WithoutTimingWithdrawalState = z.infer<typeof withoutTimingWithdrawalStateSchema>;
export type WithoutTimingWithdrawalListResponse = z.infer<typeof withoutTimingWithdrawalListResponseSchema>;
export type WithoutTimingWithdrawalRequest = z.infer<typeof withoutTimingWithdrawalRequestSchema>;
export type WithoutTimingWithdrawalResponse = z.infer<typeof withoutTimingWithdrawalResponseSchema>;
export type WithoutTimingWithdrawalAdminErrorCode = z.infer<typeof withoutTimingWithdrawalAdminErrorCodeSchema>;
export type WithoutTimingWithdrawalAdminErrorResponse = z.infer<typeof withoutTimingWithdrawalAdminErrorResponseSchema>;
