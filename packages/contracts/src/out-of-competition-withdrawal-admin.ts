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
const technicalRevisionCauseSchema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION"
]);

export const OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION =
  "out-of-competition-withdrawal-v1";
export const outOfCompetitionWithdrawalPolicyVersionSchema = z.literal(
  OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION
);

export const outOfCompetitionWithdrawalAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_out_of_competition_withdrawal_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const outOfCompetitionWithdrawalAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("WITHDRAW_OUT_OF_COMPETITION"),
  expiresAt: instantSchema
}).strict();

export const outOfCompetitionWithdrawalStateSchema = z.enum(["WITHDRAWABLE", "WITHDRAWN"]);

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
  reason: z.literal("ERRONEOUS_MANUAL_OUT_OF_COMPETITION"),
  policyVersion: outOfCompetitionWithdrawalPolicyVersionSchema,
  withdrawnAt: instantSchema
}).strict();

function validateRevisionChain(
  value: {
    targetResultRevision: z.infer<typeof revisionIdentitySchema>;
    outOfCompetitionResultRevision: z.infer<typeof revisionIdentitySchema>;
    absoluteResultRevision: z.infer<typeof revisionIdentitySchema>;
    restorationSourceResultRevision: z.infer<typeof restorationSourceRevisionSchema>;
  },
  context: z.RefinementCtx
): void {
  if (value.targetResultRevision.id === value.outOfCompetitionResultRevision.id ||
      value.outOfCompetitionResultRevision.revision !== value.targetResultRevision.revision + 1) {
    context.addIssue({
      code: "custom",
      path: ["outOfCompetitionResultRevision"],
      message: "OOC-revisionen måste vara targetets exakta efterföljare"
    });
  }
  const noLaterHead =
    value.absoluteResultRevision.id === value.outOfCompetitionResultRevision.id &&
    value.absoluteResultRevision.revision === value.outOfCompetitionResultRevision.revision;
  const laterHead = value.absoluteResultRevision.id !== value.outOfCompetitionResultRevision.id &&
    value.absoluteResultRevision.id !== value.targetResultRevision.id &&
    value.absoluteResultRevision.revision > value.outOfCompetitionResultRevision.revision;
  if (!noLaterHead && !laterHead) {
    context.addIssue({
      code: "custom",
      path: ["absoluteResultRevision"],
      message: "Absolut resultathuvud måste vara OOC-revisionen eller en senare revision"
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

function validateOutOfCompetitionSuccessor(
  target: z.infer<typeof revisionIdentitySchema>,
  outOfCompetition: z.infer<typeof revisionIdentitySchema>,
  context: z.RefinementCtx
): void {
  if (target.id === outOfCompetition.id || outOfCompetition.revision !== target.revision + 1) {
    context.addIssue({
      code: "custom",
      path: ["outOfCompetitionResultRevision"],
      message: "OOC-revisionen måste vara targetets exakta efterföljare"
    });
  }
}

const outOfCompetitionWithdrawalEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  courseVersionId: canonicalUuidSchema,
  entryVersion: positiveVersionSchema,
  state: outOfCompetitionWithdrawalStateSchema,
  notCompetingDecisionId: canonicalUuidSchema,
  decidedAt: instantSchema,
  targetResultRevision: revisionIdentitySchema,
  outOfCompetitionResultRevision: revisionIdentitySchema,
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
    validateOutOfCompetitionSuccessor(entry.targetResultRevision, entry.outOfCompetitionResultRevision, context);
  }
  if (entry.withdrawal !== null) {
    const sourceIsTarget =
      entry.restorationSourceResultRevision.id === entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.revision === entry.targetResultRevision.revision;
    const sourceIsLaterTechnical =
      entry.restorationSourceResultRevision.id !== entry.targetResultRevision.id &&
      entry.restorationSourceResultRevision.id !== entry.outOfCompetitionResultRevision.id &&
      entry.restorationSourceResultRevision.revision > entry.outOfCompetitionResultRevision.revision;
    if (!sourceIsTarget && !sourceIsLaterTechnical) {
      context.addIssue({
        code: "custom",
        path: ["restorationSourceResultRevision"],
        message: "Restaureringskällan måste vara exakt target eller en distinkt senare teknisk revision"
      });
    }
    const restoration = entry.withdrawal.restorationResultRevision;
    if (restoration.id === entry.targetResultRevision.id ||
        restoration.id === entry.outOfCompetitionResultRevision.id ||
        restoration.id === entry.restorationSourceResultRevision.id ||
        restoration.revision !== Math.max(
          entry.outOfCompetitionResultRevision.revision,
          entry.restorationSourceResultRevision.revision
        ) + 1) {
      context.addIssue({
        code: "custom",
        path: ["withdrawal", "restorationResultRevision"],
        message: "Restaureringsrevisionen måste följa exakt efter OOC eller en senare teknisk källa"
      });
    }
    const restorationIsAbsolute = entry.absoluteResultRevision.id === restoration.id &&
      entry.absoluteResultRevision.revision === restoration.revision;
    const absoluteIsLater = entry.absoluteResultRevision.id !== restoration.id &&
      entry.absoluteResultRevision.id !== entry.outOfCompetitionResultRevision.id &&
      entry.absoluteResultRevision.id !== entry.targetResultRevision.id &&
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

export const outOfCompetitionWithdrawalListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  policyVersion: outOfCompetitionWithdrawalPolicyVersionSchema,
  entries: z.array(outOfCompetitionWithdrawalEntrySchema).max(10_000)
}).strict().superRefine((response, context) => {
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  const decisionIds = new Set(response.entries.map((entry) => entry.notCompetingDecisionId));
  if (entryIds.size !== response.entries.length || decisionIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries och OOC-beslut måste vara unika" });
  }
});

export const outOfCompetitionWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: positiveVersionSchema,
  expectedClassId: canonicalUuidSchema,
  expectedCourseVersionId: canonicalUuidSchema,
  expectedSnapshotVersion: positiveVersionSchema,
  expectedNotCompetingDecisionId: canonicalUuidSchema,
  expectedTargetResultRevision: revisionIdentitySchema,
  expectedOutOfCompetitionResultRevision: revisionIdentitySchema,
  expectedAbsoluteResultRevision: revisionIdentitySchema,
  expectedRestorationSourceResultRevision: restorationSourceRevisionSchema,
  reason: z.literal("ERRONEOUS_MANUAL_OUT_OF_COMPETITION"),
  policyVersion: outOfCompetitionWithdrawalPolicyVersionSchema
}).strict().superRefine((request, context) => validateRevisionChain({
  targetResultRevision: request.expectedTargetResultRevision,
  outOfCompetitionResultRevision: request.expectedOutOfCompetitionResultRevision,
  absoluteResultRevision: request.expectedAbsoluteResultRevision,
  restorationSourceResultRevision: request.expectedRestorationSourceResultRevision
}, context));

export const outOfCompetitionWithdrawalIdempotencyKeySchema = z.string().regex(
  /^out-of-competition-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara out-of-competition-withdrawal:<kanoniskt request-uuid>"
);

export const outOfCompetitionWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  outOfCompetitionWithdrawalId: canonicalUuidSchema,
  notCompetingDecisionId: canonicalUuidSchema,
  outOfCompetitionResultRevisionId: canonicalUuidSchema,
  restorationSourceResultRevisionId: canonicalUuidSchema,
  restorationResultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  cause: z.literal("MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"),
  status: restorableStatusSchema,
  reason: restorableReasonSchema,
  withdrawalReason: z.literal("ERRONEOUS_MANUAL_OUT_OF_COMPETITION"),
  policyVersion: outOfCompetitionWithdrawalPolicyVersionSchema,
  snapshotVersion: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema,
  withdrawnAt: instantSchema
}).strict().superRefine((response, context) => {
  const valid = response.status === "OK" ? response.reason === "COMPLETE" : response.reason !== "COMPLETE";
  if (!valid) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Restaurerad status och orsak matchar inte" });
  }
});

export const outOfCompetitionWithdrawalAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const outOfCompetitionWithdrawalAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: outOfCompetitionWithdrawalAdminErrorCodeSchema
}).strict();

export type OutOfCompetitionWithdrawalPolicyVersion = z.infer<typeof outOfCompetitionWithdrawalPolicyVersionSchema>;
export type OutOfCompetitionWithdrawalAdminLoginRequest = z.infer<typeof outOfCompetitionWithdrawalAdminLoginRequestSchema>;
export type OutOfCompetitionWithdrawalAdminLoginResponse = z.infer<typeof outOfCompetitionWithdrawalAdminLoginResponseSchema>;
export type OutOfCompetitionWithdrawalState = z.infer<typeof outOfCompetitionWithdrawalStateSchema>;
export type OutOfCompetitionWithdrawalListResponse = z.infer<typeof outOfCompetitionWithdrawalListResponseSchema>;
export type OutOfCompetitionWithdrawalRequest = z.infer<typeof outOfCompetitionWithdrawalRequestSchema>;
export type OutOfCompetitionWithdrawalResponse = z.infer<typeof outOfCompetitionWithdrawalResponseSchema>;
export type OutOfCompetitionWithdrawalAdminErrorCode = z.infer<typeof outOfCompetitionWithdrawalAdminErrorCodeSchema>;
export type OutOfCompetitionWithdrawalAdminErrorResponse = z.infer<typeof outOfCompetitionWithdrawalAdminErrorResponseSchema>;
