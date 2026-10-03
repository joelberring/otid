import { z } from "zod";
import { evaluationResultSchema } from "./local-station-evaluation";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);

/** The first and only manual result-decision policy in TASK 006E. */
export const DID_NOT_START_DECISION_POLICY_VERSION = "did-not-start-v1";
export const didNotStartDecisionPolicyVersionSchema = z.literal(DID_NOT_START_DECISION_POLICY_VERSION);

/**
 * A status-only manual result. It intentionally is not accepted by the local
 * station evaluation schema, since a card readout cannot prove absence.
 */
export const didNotStartResultSchema = z.object({
  status: z.literal("DNS"),
  reason: z.literal("DID_NOT_START"),
  entryId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  courseVersionId: canonicalUuidSchema
}).strict();

/**
 * A status-only manual DNF. The technical target is held by its immutable
 * decision, never copied into this outcome: a finish, elapsed time or split
 * would contradict the explicit did-not-finish fact.
 */
export const didNotFinishResultSchema = z.object({
  status: z.literal("DNF"),
  reason: z.literal("DID_NOT_FINISH"),
  entryId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  courseVersionId: canonicalUuidSchema
}).strict();

/**
 * A status-only manual NT. Its validated technical OK/COMPLETE target remains
 * immutable decision provenance and never leaks timing or control facts here.
 */
export const withoutTimingResultSchema = z.object({
  status: z.literal("NT"),
  reason: z.literal("WITHOUT_TIMING"),
  entryId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  courseVersionId: canonicalUuidSchema
}).strict();

const storedCodesSchema = z.array(z.number().int().positive()).max(1_000);
const storedSplitSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  elapsedMs: z.number().int(),
  legMs: z.number().int()
}).strict();
const disqualifiedIdentityFields = {
  entryId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  courseVersionId: canonicalUuidSchema
};
const disqualifiedExplanationFields = {
  missingControls: storedCodesSchema,
  extraPunches: storedCodesSchema,
  splits: z.array(storedSplitSchema).max(1_000)
};
const disqualifiedBaseFields = {
  status: z.literal("DSQ"),
  reason: z.literal("MANUAL_DISQUALIFICATION"),
  ...disqualifiedIdentityFields,
  ...disqualifiedExplanationFields
};

/**
 * Stored-only manual DSQ. Its four shapes mirror every valid OK/MP source
 * shape while deliberately replacing the source reason.
 */
export const disqualifiedResultSchema = z.union([
  z.object(disqualifiedBaseFields).strict(),
  z.object({
    ...disqualifiedBaseFields,
    startTime: z.iso.datetime({ offset: true })
  }).strict(),
  z.object({
    ...disqualifiedBaseFields,
    startTime: z.string().min(1).max(64),
    finishTime: z.string().min(1).max(64)
  }).strict(),
  z.object({
    ...disqualifiedBaseFields,
    startTime: z.iso.datetime({ offset: true }),
    finishTime: z.iso.datetime({ offset: true }),
    elapsedMs: z.number().int()
  }).strict()
]);

/**
 * Stored-only manual approval. The source is deliberately restricted to a
 * timed technical MP (MISSING_CONTROL or WRONG_ORDER). The decision aggregate
 * preserves that source identity; this outcome preserves every result fact
 * while changing only the effective status and explanation.
 */
export const manualApprovedResultSchema = z.object({
  status: z.literal("OK"),
  reason: z.literal("MANUAL_APPROVAL"),
  ...disqualifiedIdentityFields,
  startTime: z.iso.datetime({ offset: true }),
  finishTime: z.iso.datetime({ offset: true }),
  elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  ...disqualifiedExplanationFields
}).strict().superRefine((result, context) => {
  if (Date.parse(result.finishTime) - Date.parse(result.startTime) !== result.elapsedMs) {
    context.addIssue({
      code: "custom",
      path: ["elapsedMs"],
      message: "Totaltiden måste motsvara start- och måltid"
    });
  }
  if (result.splits.some((split) => split.elapsedMs < 0 || split.legMs < 0 || split.elapsedMs > result.elapsedMs)) {
    context.addIssue({
      code: "custom",
      path: ["splits"],
      message: "Sträcktider måste rymmas inom totaltiden"
    });
  }
});

const outOfCompetitionBaseFields = {
  status: z.literal("OOC"),
  reason: z.literal("OUT_OF_COMPETITION"),
  ...disqualifiedIdentityFields,
  ...disqualifiedExplanationFields
};

/**
 * Stored-only OOC. Its four structural variants preserve the possible direct
 * technical OK/MP source shapes while replacing only status and reason.
 */
export const outOfCompetitionResultSchema = z.union([
  z.object(outOfCompetitionBaseFields).strict(),
  z.object({
    ...outOfCompetitionBaseFields,
    startTime: z.iso.datetime({ offset: true })
  }).strict(),
  z.object({
    ...outOfCompetitionBaseFields,
    startTime: z.string().min(1).max(64),
    finishTime: z.string().min(1).max(64)
  }).strict(),
  z.object({
    ...outOfCompetitionBaseFields,
    startTime: z.iso.datetime({ offset: true }),
    finishTime: z.iso.datetime({ offset: true }),
    elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  }).strict()
]).superRefine((result, context) => {
  if (!("elapsedMs" in result)) {
    if (result.missingControls.length > 0 || result.extraPunches.length > 0 || result.splits.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["splits"],
        message: "Tidslöst OOC får inte bära tekniska kontroll- eller splitfakta"
      });
    }
    return;
  }
  if (Date.parse(result.finishTime) - Date.parse(result.startTime) !== result.elapsedMs) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Totaltiden måste motsvara start- och måltid" });
  }
  if (result.splits.some((split) =>
    split.elapsedMs < 0 || split.legMs < 0 || split.elapsedMs > result.elapsedMs)) {
    context.addIssue({ code: "custom", path: ["splits"], message: "Sträcktider måste rymmas inom totaltiden" });
  }
});

/** TASK 006E persisted-result format, retained for formatVersion 1 readers. */
export const resultOutcomeV1Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema
]);

/** TASK 006G persisted-result format, retained for formatVersion 2 readers. */
export const resultOutcomeV2Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema,
  disqualifiedResultSchema
]);

/** Valid only for current persisted result revisions, never station evaluations. */
export const resultOutcomeV3Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema,
  disqualifiedResultSchema,
  manualApprovedResultSchema
]);

/** TASK 006I persisted-result format. Earlier formats remain readable. */
export const resultOutcomeV4Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema,
  didNotFinishResultSchema,
  disqualifiedResultSchema,
  manualApprovedResultSchema
]);

/** TASK 006K persisted-result format. Earlier formats remain readable. */
export const resultOutcomeV5Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema,
  didNotFinishResultSchema,
  outOfCompetitionResultSchema,
  disqualifiedResultSchema,
  manualApprovedResultSchema
]);
/** TASK 006L adds provenance only; its restored outcome remains exact OK/MP. */
export const resultOutcomeV6Schema = resultOutcomeV5Schema;
/** TASK 006M persisted-result format. Earlier formats remain readable. */
export const resultOutcomeV7Schema = z.union([
  evaluationResultSchema,
  didNotStartResultSchema,
  didNotFinishResultSchema,
  withoutTimingResultSchema,
  outOfCompetitionResultSchema,
  disqualifiedResultSchema,
  manualApprovedResultSchema
]);
/** TASK 006N adds revision provenance only; the stored outcome union is unchanged. */
export const resultOutcomeV8Schema = resultOutcomeV7Schema;
export const resultOutcomeSchema = resultOutcomeV8Schema;

export const storedResultStatusV4Schema = z.enum(["OK", "MP", "DSQ", "DNF", "DNS"]);
/** TASK 006K/006L status union, retained for historical format readers. */
export const storedResultStatusV6Schema = z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]);
export const storedResultStatusSchema = z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "NT", "DNS"]);
export const storedResultReasonV4Schema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER",
  "DID_NOT_START",
  "DID_NOT_FINISH",
  "MANUAL_DISQUALIFICATION",
  "MANUAL_APPROVAL"
]);
/** TASK 006K/006L reason union, retained for historical format readers. */
export const storedResultReasonV6Schema = z.enum([
  ...storedResultReasonV4Schema.options,
  "OUT_OF_COMPETITION"
]);
export const storedResultReasonSchema = z.enum([
  ...storedResultReasonV6Schema.options,
  "WITHOUT_TIMING"
]);

export const storedResultRevisionCauseV5Schema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "MANUAL_DID_NOT_START",
  "MANUAL_DID_NOT_FINISH",
  "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  "MANUAL_DISQUALIFICATION",
  "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL",
  "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
]);
export const storedResultRevisionCauseV6Schema = z.enum([
  ...storedResultRevisionCauseV5Schema.options,
  "MANUAL_OUT_OF_COMPETITION"
]);
/** TASK 006L source union, retained for historical format 7 readers. */
export const storedResultRevisionCauseV7Schema = z.enum([
  ...storedResultRevisionCauseV6Schema.options,
  "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
]);
export const storedResultRevisionCauseSchema = z.enum([
  ...storedResultRevisionCauseV7Schema.options,
  "MANUAL_WITHOUT_TIMING"
]);
/** TASK 006N source union. Earlier readers deliberately retain their frozen causes. */
export const storedResultRevisionCauseV8Schema = z.enum([
  ...storedResultRevisionCauseSchema.options,
  "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  "UNKNOWN_READOUT_RESOLUTION"
]);
/** TASK093 source union. Earlier readers deliberately retain their frozen causes. */
export const storedResultRevisionCauseV9Schema = z.enum([
  ...storedResultRevisionCauseV8Schema.options,
  "MANUAL_FINISH_TIME_CORRECTION"
]);
/** TASK094 source union. Frozen historical readers retain their earlier causes. */
export const storedResultRevisionCauseV10Schema = z.enum([
  ...storedResultRevisionCauseV9Schema.options,
  "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
]);
/** TASK135 source union. Older projections retain their frozen cause sets. */
export const storedResultRevisionCauseV11Schema = z.enum([
  ...storedResultRevisionCauseV10Schema.options,
  "MANUAL_PUNCH_START_TIME_CORRECTION",
  "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL",
  "SHORTENED_COURSE_CLASS_TRANSFER"
]);

export function isValidStoredResultPair(
  status: z.infer<typeof storedResultStatusSchema>,
  reason: z.infer<typeof storedResultReasonSchema>
): boolean {
  if (status === "OK") return reason === "COMPLETE" || reason === "MANUAL_APPROVAL";
  if (status === "MP") return reason === "MISSING_START" || reason === "MISSING_FINISH" ||
    reason === "MISSING_CONTROL" || reason === "WRONG_ORDER" || reason === "INVALID_TIME_ORDER";
  if (status === "DSQ") return reason === "MANUAL_DISQUALIFICATION";
  if (status === "DNF") return reason === "DID_NOT_FINISH";
  if (status === "OOC") return reason === "OUT_OF_COMPETITION";
  if (status === "NT") return reason === "WITHOUT_TIMING";
  return reason === "DID_NOT_START";
}

export type DidNotStartResult = z.infer<typeof didNotStartResultSchema>;
export type DidNotFinishResult = z.infer<typeof didNotFinishResultSchema>;
export type WithoutTimingResult = z.infer<typeof withoutTimingResultSchema>;
export type OutOfCompetitionResult = z.infer<typeof outOfCompetitionResultSchema>;
export type DisqualifiedResult = z.infer<typeof disqualifiedResultSchema>;
export type ManualApprovedResult = z.infer<typeof manualApprovedResultSchema>;
export type ResultOutcome = z.infer<typeof resultOutcomeSchema>;
export type DidNotStartDecisionPolicyVersion = z.infer<typeof didNotStartDecisionPolicyVersionSchema>;
