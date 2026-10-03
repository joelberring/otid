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

export const DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION = "did-not-finish-withdrawal-v1";
export const didNotFinishWithdrawalPolicyVersionSchema = z.literal(
  DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION
);

export const didNotFinishWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_did_not_finish_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const didNotFinishWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_DID_NOT_FINISH"),
  expiresAt: instantSchema
}).strict();

export const didNotFinishWithdrawalStateSchema = z.enum(["WITHDRAWABLE", "WITHDRAWN"]);

const revisionIdentitySchema = z.object({
  id: canonicalUuidSchema,
  revision: positiveVersionSchema
}).strict();

const restorationSourceRevisionSchema = revisionIdentitySchema.extend({
  status: restorableStatusSchema,
  reason: restorableReasonSchema
}).strict().superRefine((source, context) => {
  const valid = source.status === "OK" ? source.reason === "COMPLETE" : source.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Källstatus och orsak matchar inte" });
  }
});

const withdrawalMetadataSchema = z.object({
  id: canonicalUuidSchema,
  restorationResultRevision: revisionIdentitySchema,
  reason: z.literal("ERRONEOUS_MANUAL_DID_NOT_FINISH"),
  policyVersion: didNotFinishWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

function validateRevisionChain(
  value: {
    targetResultRevision: z.infer<typeof revisionIdentitySchema>;
    didNotFinishResultRevision: z.infer<typeof revisionIdentitySchema>;
    absoluteResultRevision: z.infer<typeof revisionIdentitySchema>;
    restorationSourceResultRevision: z.infer<typeof restorationSourceRevisionSchema>;
  },
  context: z.RefinementCtx
): void {
  if (value.targetResultRevision.id === value.didNotFinishResultRevision.id ||
      value.didNotFinishResultRevision.revision !== value.targetResultRevision.revision + 1) {
    context.addIssue({
      code: "custom",
      path: ["didNotFinishResultRevision"],
      message: "DNF-revisionen måste vara targetets exakta efterföljare"
    });
  }
  const noLaterHead =
    value.absoluteResultRevision.id === value.didNotFinishResultRevision.id &&
    value.absoluteResultRevision.revision === value.didNotFinishResultRevision.revision;
  const laterHead = value.absoluteResultRevision.id !== value.didNotFinishResultRevision.id &&
    value.absoluteResultRevision.revision > value.didNotFinishResultRevision.revision;
  if (!noLaterHead && !laterHead) {
    context.addIssue({
      code: "custom",
      path: ["absoluteResultRevision"],
      message: "Absolut resultathuvud måste vara DNF-revisionen eller en senare revision"
    });
  }
  const sourceMatches = noLaterHead
    ? value.restorationSourceResultRevision.id === value.targetResultRevision.id &&
      value.restorationSourceResultRevision.revision === value.targetResultRevision.revision
    : laterHead &&
      value.restorationSourceResultRevision.id === value.absoluteResultRevision.id &&
      value.restorationSourceResultRevision.revision === value.absoluteResultRevision.revision;
  if (!sourceMatches) {
    context.addIssue({
      code: "custom",
      path: ["restorationSourceResultRevision"],
      message: "Restaureringskällan måste vara exakt target eller exakt senare absolut huvud"
    });
  }
}

function validateDidNotFinishSuccessor(
  target: z.infer<typeof revisionIdentitySchema>,
  didNotFinish: z.infer<typeof revisionIdentitySchema>,
  context: z.RefinementCtx
): void {
  if (target.id === didNotFinish.id || didNotFinish.revision !== target.revision + 1) {
    context.addIssue({
      code: "custom",
      path: ["didNotFinishResultRevision"],
      message: "DNF-revisionen måste vara targetets exakta efterföljare"
    });
  }
}

const didNotFinishWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  state: didNotFinishWithdrawalStateSchema,
  didNotFinishDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  targetResultRevision: revisionIdentitySchema,
  didNotFinishResultRevision: revisionIdentitySchema,
  absoluteResultRevision: revisionIdentitySchema,
  restorationSourceResultRevision: restorationSourceRevisionSchema,
  withdrawal: withdrawalMetadataSchema.nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.state === "WITHDRAWN") !== (entry.withdrawal !== null)) {
    context.addIssue({
      code: "custom",
      path: ["withdrawal"],
      message: "Withdrawalmetadata matchar inte state"
    });
  }
  if (entry.state === "WITHDRAWABLE") {
    validateRevisionChain(entry, context);
  } else {
    validateDidNotFinishSuccessor(entry.targetResultRevision, entry.didNotFinishResultRevision, context);
  }
  if (entry.withdrawal !== null) {
    const sourceIsTarget =
      entry.restorationSourceResultRevision.id === entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.revision === entry.targetResultRevision.revision;
    const sourceIsLaterTechnical =
      entry.restorationSourceResultRevision.id !== entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.id !== entry.didNotFinishResultRevision.id &&
      entry.restorationSourceResultRevision.revision > entry.didNotFinishResultRevision.revision;
    if (!sourceIsTarget && !sourceIsLaterTechnical) {
      context.addIssue({
        code: "custom",
        path: ["restorationSourceResultRevision"],
        message: "Restaureringskällan måste vara exakt target eller en distinkt senare teknisk revision"
      });
    }
    const restoration = entry.withdrawal.restorationResultRevision;
    if (restoration.id === entry.targetResultRevision.id ||
        restoration.id === entry.didNotFinishResultRevision.id ||
        restoration.id === entry.restorationSourceResultRevision.id ||
        restoration.revision !== Math.max(
          entry.didNotFinishResultRevision.revision,
          entry.restorationSourceResultRevision.revision
        ) + 1) {
      context.addIssue({
        code: "custom",
        path: ["withdrawal", "restorationResultRevision"],
        message: "Restaureringsrevisionen måste följa exakt efter DNF eller en senare teknisk källa"
      });
    }
    const restorationIsAbsolute = entry.absoluteResultRevision.id === restoration.id &&
      entry.absoluteResultRevision.revision === restoration.revision;
    const absoluteIsLater = entry.absoluteResultRevision.id !== restoration.id &&
      entry.absoluteResultRevision.revision > restoration.revision;
    if (!restorationIsAbsolute && !absoluteIsLater) {
      context.addIssue({
        code: "custom",
        path: ["absoluteResultRevision"],
        message: "Absolut huvud måste vara restaureringen eller en senare revision"
      });
    }
  }
});

export const didNotFinishWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: didNotFinishWithdrawalPolicyVersionSchema,
  entries: z.array(didNotFinishWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.didNotFinishDecisionId));
  if (entryIds.size !== response.entries.length || decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries och DNF-beslut måste vara unika" });
  }
});

export const didNotFinishWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedDidNotFinishDecisionId: canonicalUuidSchema,
  expectedTargetResultRevision: revisionIdentitySchema,
  expectedDidNotFinishResultRevision: revisionIdentitySchema,
  expectedAbsoluteResultRevision: revisionIdentitySchema,
  expectedRestorationSourceResultRevision: restorationSourceRevisionSchema,
  reason: z.literal("ERRONEOUS_MANUAL_DID_NOT_FINISH"),
  policyVersion: didNotFinishWithdrawalPolicyVersionSchema
}).strict().superRefine((request, context) => validateRevisionChain({
  targetResultRevision: request.expectedTargetResultRevision,
  didNotFinishResultRevision: request.expectedDidNotFinishResultRevision,
  absoluteResultRevision: request.expectedAbsoluteResultRevision,
  restorationSourceResultRevision: request.expectedRestorationSourceResultRevision
}, context));

export const didNotFinishWithdrawalIdempotencyKeySchema = z.string().regex(
  /^did-not-finish-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara did-not-finish-withdrawal:<kanoniskt request-uuid>"
);

export const didNotFinishWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  didNotFinishWithdrawalId: canonicalUuidSchema,
  didNotFinishDecisionId: canonicalUuidSchema,
  didNotFinishResultRevisionId: canonicalUuidSchema,
  restorationSourceResultRevisionId: canonicalUuidSchema,
  restorationResultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_DID_NOT_FINISH_WITHDRAWAL"),
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  withdrawalReason: z.literal("ERRONEOUS_MANUAL_DID_NOT_FINISH"),
  policyVersion: didNotFinishWithdrawalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  withdrawnAt: instantSchema
}).strict().superRefine((response, context) => {
  const valid = response.status === "OK" ? response.reason === "COMPLETE" : response.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Restaurerad status och orsak matchar inte" });
  }
});

export const didNotFinishWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const didNotFinishWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: didNotFinishWithdrawalAdminErrorCodeSchema
}).strict();

export type DidNotFinishWithdrawalPolicyVersion = z.infer<typeof didNotFinishWithdrawalPolicyVersionSchema>;
export type DidNotFinishWithdrawalAdminLoginRequest = z.infer<typeof didNotFinishWithdrawalAdminLoginRequestSchema>;
export type DidNotFinishWithdrawalAdminLoginResponse = z.infer<typeof didNotFinishWithdrawalAdminLoginResponseSchema>;
export type DidNotFinishWithdrawalState = z.infer<typeof didNotFinishWithdrawalStateSchema>;
export type DidNotFinishWithdrawalListResponse = z.infer<typeof didNotFinishWithdrawalListResponseSchema>;
export type DidNotFinishWithdrawalRequest = z.infer<typeof didNotFinishWithdrawalRequestSchema>;
export type DidNotFinishWithdrawalResponse = z.infer<typeof didNotFinishWithdrawalResponseSchema>;
export type DidNotFinishWithdrawalAdminErrorCode = z.infer<typeof didNotFinishWithdrawalAdminErrorCodeSchema>;
export type DidNotFinishWithdrawalAdminErrorResponse = z.infer<typeof didNotFinishWithdrawalAdminErrorResponseSchema>;
