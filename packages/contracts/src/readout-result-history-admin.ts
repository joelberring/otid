import { z } from "zod";
import {
  isValidStoredResultPair,
  resultOutcomeV1Schema,
  resultOutcomeV2Schema,
  resultOutcomeV3Schema,
  resultOutcomeV4Schema,
  resultOutcomeV5Schema,
  resultOutcomeV6Schema,
  resultOutcomeV7Schema,
  resultOutcomeV8Schema,
  storedResultReasonV4Schema,
  storedResultReasonV6Schema,
  storedResultReasonSchema,
  storedResultRevisionCauseV5Schema,
  storedResultRevisionCauseV6Schema,
  storedResultRevisionCauseV7Schema,
  storedResultRevisionCauseSchema,
  storedResultRevisionCauseV8Schema,
  storedResultStatusV4Schema,
  storedResultStatusV6Schema,
  storedResultStatusSchema
} from "./result-outcome";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const instantSchema = z.iso.datetime({ offset: true });
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);
const pageLimitSchema = z.coerce.number().int().min(1).max(50).default(50);
const displayNameSchema = z.string().trim().min(1).max(321);
const cardNumberSchema = z.string().trim().min(1).max(32);
const evaluationStatusSchema = z.enum(["OK", "MP", "UNKNOWN_CARD"]);
const evaluationReasonSchema = z.enum([
  "COMPLETE", "UNKNOWN_CARD", "MISSING_START", "MISSING_FINISH",
  "MISSING_CONTROL", "WRONG_ORDER", "INVALID_TIME_ORDER"
]);

export const readoutResultHistoryAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_readout_result_history_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const readoutResultHistoryAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("VIEW_READOUT_RESULT_HISTORY"),
  expiresAt: instantSchema
}).strict();

export const readoutHistoryListQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema
}).strict();

export const readoutHistoryDetailQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema
}).strict();

const entryIdentitySchema = z.object({
  id: canonicalUuidSchema,
  displayName: displayNameSchema
}).strict();

const firstServerAssessmentSchema = z.object({
  status: evaluationStatusSchema,
  reason: evaluationReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema.nullable()
}).strict().superRefine((assessment, context) => {
  const valid = assessment.status === "UNKNOWN_CARD"
    ? assessment.reason === "UNKNOWN_CARD" && assessment.courseVersionId === null
    : assessment.status === "OK"
      ? assessment.reason === "COMPLETE" && assessment.courseVersionId !== null
      : assessment.reason !== "COMPLETE" && assessment.reason !== "UNKNOWN_CARD" && assessment.courseVersionId !== null;
  if (!valid) context.addIssue({ code: "custom", message: "Status, orsak och banversion måste höra ihop" });
});

const readoutListItemSchema = z.object({
  id: canonicalUuidSchema,
  readAt: instantSchema,
  cardNumber: cardNumberSchema,
  entry: entryIdentitySchema.nullable(),
  firstServerAssessment: firstServerAssessmentSchema.nullable()
}).strict();

export const readoutHistoryListResponseV1Schema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV2Schema = z.object({
  formatVersion: z.literal(2),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV3Schema = z.object({
  formatVersion: z.literal(3),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV4Schema = z.object({
  formatVersion: z.literal(4),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV5Schema = z.object({
  formatVersion: z.literal(5),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV6Schema = z.object({
  formatVersion: z.literal(6),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

/** Format 7 keeps the bounded list shape while its detail payload gains OOC withdrawal provenance. */
export const readoutHistoryListResponseV7Schema = z.object({
  formatVersion: z.literal(7),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseV8Schema = z.object({
  formatVersion: z.literal(8),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

/** Format 9 keeps the bounded list shape while detail gains NT withdrawal provenance. */
export const readoutHistoryListResponseV9Schema = z.object({
  formatVersion: z.literal(9),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

/** Format 10 keeps the list shape while detail gains check-in DNS provenance. */
export const readoutHistoryListResponseV10Schema = z.object({
  formatVersion: z.literal(10),
  raceId: canonicalUuidSchema,
  items: z.array(readoutListItemSchema).max(50),
  nextCursor: cursorSchema.nullable()
}).strict().superRefine((response, context) => {
  if (new Set(response.items.map((item) => item.id)).size !== response.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Avläsnings-id måste vara unika" });
  }
  for (const [index, item] of response.items.entries()) {
    if (item.firstServerAssessment?.status === "UNKNOWN_CARD" && item.entry !== null) {
      context.addIssue({ code: "custom", path: ["items", index, "entry"], message: "Okänd bricka får inte ha deltagare" });
    }
  }
});

export const readoutHistoryListResponseSchema = z.discriminatedUnion("formatVersion", [
  readoutHistoryListResponseV1Schema,
  readoutHistoryListResponseV2Schema,
  readoutHistoryListResponseV3Schema,
  readoutHistoryListResponseV4Schema,
  readoutHistoryListResponseV5Schema,
  readoutHistoryListResponseV6Schema,
  readoutHistoryListResponseV7Schema,
  readoutHistoryListResponseV8Schema,
  readoutHistoryListResponseV9Schema,
  readoutHistoryListResponseV10Schema
]);

const normalizedPunchSchema = z.object({
  code: z.number().int().positive(),
  punchedAt: instantSchema
}).strict();

const normalizedReadoutSchema = z.object({
  id: canonicalUuidSchema,
  cardNumber: cardNumberSchema,
  readAt: instantSchema,
  startPunchedAt: instantSchema.nullable(),
  finishPunchedAt: instantSchema,
  punches: z.array(normalizedPunchSchema).max(256)
}).strict();

const storedResultStatusV1Schema = z.enum(["OK", "MP", "DNS"]);
const storedResultReasonV1Schema = z.enum([
  "COMPLETE", "MISSING_START", "MISSING_FINISH", "MISSING_CONTROL",
  "WRONG_ORDER", "INVALID_TIME_ORDER", "DID_NOT_START"
]);
const storedResultRevisionCauseV1Schema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "MANUAL_DID_NOT_START"
]);

export const readoutHistoryRevisionV1Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  readoutId: canonicalUuidSchema.nullable(),
  cause: storedResultRevisionCauseV1Schema,
  status: storedResultStatusV1Schema,
  reason: storedResultReasonV1Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV1Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const manual = revision.cause === "MANUAL_DID_NOT_START";
  if (manual !== (revision.readoutId === null)) {
    context.addIssue({ code: "custom", path: ["readoutId"], message: "Revisionsorsak och readoutkälla motsäger varandra" });
  }
  if (manual !== (revision.evaluation.status === "DNS" && revision.evaluation.reason === "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DNS kräver manuell revisionsorsak" });
  }
});

export const readoutHistoryRevisionSourceV2Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const readoutHistoryRevisionSourceV3Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const readoutHistoryRevisionSourceV4Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_FINISH"),
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const readoutHistoryRevisionSourceV5Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_FINISH"),
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DID_NOT_FINISH_WITHDRAWAL"),
    didNotFinishWithdrawalId: canonicalUuidSchema,
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    didNotFinishResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const readoutHistoryRevisionSourceV6Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV5Schema.options,
  z.object({
    kind: z.literal("MANUAL_OUT_OF_COMPETITION"),
    notCompetingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict()
]);

/** TASK 006L freezes the full reciprocal OOC withdrawal provenance. */
export const readoutHistoryRevisionSourceV7Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV6Schema.options,
  z.object({
    kind: z.literal("MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"),
    notCompetingWithdrawalId: canonicalUuidSchema,
    notCompetingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    outOfCompetitionResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: z.number().int().positive(),
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const readoutHistoryRevisionSourceV8Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV7Schema.options,
  z.object({
    kind: z.literal("MANUAL_WITHOUT_TIMING"),
    withoutTimingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema
  }).strict()
]);

/** TASK 006N freezes the full reciprocal NT withdrawal chain. */
export const readoutHistoryRevisionSourceV9Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV8Schema.options,
  z.object({
    kind: z.literal("MANUAL_WITHOUT_TIMING_WITHDRAWAL"),
    withoutTimingWithdrawalId: canonicalUuidSchema,
    withoutTimingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    withoutTimingResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: z.number().int().positive(),
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

const startCheckinDnsWithdrawalSourceSchema = z.object({
  id: canonicalUuidSchema,
  operationRequestId: canonicalUuidSchema,
  startCheckinRevisionId: canonicalUuidSchema,
  operationalRevision: z.number().int().positive()
}).strict();

/** TASK 006W freezes the separate, verified check-in DNS lifecycle. */
export const readoutHistoryRevisionSourceV10Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV9Schema.options,
  z.object({
    kind: z.literal("START_CHECKIN_DID_NOT_START"),
    startCheckinDnsDecisionId: canonicalUuidSchema,
    operationRequestId: canonicalUuidSchema,
    startCheckinRevisionId: canonicalUuidSchema,
    operationalRevision: z.number().int().positive(),
    withdrawal: startCheckinDnsWithdrawalSourceSchema.nullable()
  }).strict().superRefine((source, context) => {
    if (source.withdrawal !== null && source.withdrawal.operationalRevision <= source.operationalRevision) {
      context.addIssue({
        code: "custom",
        path: ["withdrawal", "operationalRevision"],
        message: "Återtagandets operativa revision måste ligga efter DNS-rapporten"
      });
    }
  })
]);

/** TASK093 exposes only the immutable correction chain needed to audit a displayed time. */
export const readoutHistoryRevisionSourceV11Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV10Schema.options,
  z.object({
    kind: z.literal("MANUAL_FINISH_TIME_CORRECTION"),
    manualFinishTimeCorrectionId: canonicalUuidSchema,
    sourceResultRevisionId: canonicalUuidSchema,
    sourceResultRevision: z.number().int().positive(),
    sourceReadoutId: canonicalUuidSchema,
    sourceFinishTime: instantSchema,
    correctedFinishTime: instantSchema
  }).strict().superRefine((source, context) => {
    if (Date.parse(source.correctedFinishTime) === Date.parse(source.sourceFinishTime)) {
      context.addIssue({ code: "custom", path: ["correctedFinishTime"], message: "Rättad måltid måste skilja sig från källan" });
    }
  })
]);

/** TASK094 adds the immutable restoration link without changing prior history formats. */
export const readoutHistoryRevisionSourceV12Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV11Schema.options,
  z.object({
    kind: z.literal("MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"),
    manualFinishTimeCorrectionWithdrawalId: canonicalUuidSchema,
    manualFinishTimeCorrectionId: canonicalUuidSchema,
    sourceResultRevisionId: canonicalUuidSchema,
    sourceResultRevision: z.number().int().positive(),
    correctedResultRevisionId: canonicalUuidSchema,
    correctedResultRevision: z.number().int().positive()
  }).strict().superRefine((source, context) => {
    if (source.correctedResultRevision !== source.sourceResultRevision + 1) {
      context.addIssue({ code: "custom", message: "Återtagandet måste följa den direkta rättningskedjan" });
    }
  })
]);

/** TASK104 exposes the immutable observed-PUNCH-start correction chain. */
export const readoutHistoryRevisionSourceV13Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV12Schema.options,
  z.object({
    kind: z.literal("MANUAL_PUNCH_START_TIME_CORRECTION"),
    manualPunchStartTimeCorrectionId: canonicalUuidSchema,
    sourceResultRevisionId: canonicalUuidSchema,
    sourceResultRevision: z.number().int().positive(),
    sourceReadoutId: canonicalUuidSchema,
    sourceStartTime: instantSchema,
    correctedStartTime: instantSchema
  }).strict().superRefine((source, context) => {
    if (Date.parse(source.correctedStartTime) === Date.parse(source.sourceStartTime)) {
      context.addIssue({ code: "custom", path: ["correctedStartTime"], message: "Rättad start måste skilja sig från källan" });
    }
  })
]);

/** TASK105 exposes the immutable restoration of a direct PUNCH-start correction. */
export const readoutHistoryRevisionSourceV14Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV13Schema.options,
  z.object({
    kind: z.literal("MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"),
    manualPunchStartTimeCorrectionWithdrawalId: canonicalUuidSchema,
    manualPunchStartTimeCorrectionId: canonicalUuidSchema,
    sourceResultRevisionId: canonicalUuidSchema,
    sourceResultRevision: z.number().int().positive(),
    correctedResultRevisionId: canonicalUuidSchema,
    correctedResultRevision: z.number().int().positive()
  }).strict().superRefine((source, context) => {
    if (source.correctedResultRevision !== source.sourceResultRevision + 1) {
      context.addIssue({ code: "custom", message: "Återtagandet måste följa den direkta starträttningskedjan" });
    }
  })
]);

/** TASK135 exposes the immutable source/target pair of a separate short class. */
export const readoutHistoryRevisionSourceV15Schema = z.discriminatedUnion("kind", [
  ...readoutHistoryRevisionSourceV14Schema.options,
  z.object({
    kind: z.literal("SHORTENED_COURSE_CLASS_TRANSFER"),
    shortenedCourseClassTransferId: canonicalUuidSchema,
    sourceResultRevisionId: canonicalUuidSchema,
    sourceResultRevision: z.number().int().positive(),
    sourceReadoutId: canonicalUuidSchema,
    sourceClassId: canonicalUuidSchema,
    sourceCourseVersionId: canonicalUuidSchema,
    shortClassId: canonicalUuidSchema,
    shortCourseVersionId: canonicalUuidSchema
  }).strict().superRefine((source, context) => {
    if (source.shortClassId === source.sourceClassId || source.shortCourseVersionId === source.sourceCourseVersionId) {
      context.addIssue({ code: "custom", message: "Kortbanan måste vara ett separat klass- och banobjekt" });
    }
  })
]);

const storedResultStatusV2Schema = z.enum(["OK", "MP", "DSQ", "DNS"]);
const storedResultReasonV2Schema = z.enum([
  "COMPLETE", "MISSING_START", "MISSING_FINISH", "MISSING_CONTROL",
  "WRONG_ORDER", "INVALID_TIME_ORDER", "DID_NOT_START", "MANUAL_DISQUALIFICATION"
]);
const storedResultRevisionCauseV2Schema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION",
  "MANUAL_DID_NOT_START", "MANUAL_DISQUALIFICATION", "MANUAL_DISQUALIFICATION_WITHDRAWAL"
]);
const storedResultRevisionCauseV3Schema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION",
  "MANUAL_DID_NOT_START", "MANUAL_DISQUALIFICATION", "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL", "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
]);
const storedResultRevisionCauseV4Schema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION",
  "MANUAL_DID_NOT_START", "MANUAL_DID_NOT_FINISH", "MANUAL_DISQUALIFICATION",
  "MANUAL_DISQUALIFICATION_WITHDRAWAL", "MANUAL_RESULT_APPROVAL",
  "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
]);
const storedResultStatusV3Schema = z.enum(["OK", "MP", "DSQ", "DNS"]);
const storedResultReasonV3Schema = z.enum([
  ...storedResultReasonV2Schema.options,
  "MANUAL_APPROVAL"
]);

export const readoutHistoryRevisionV2Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV2Schema,
  cause: storedResultRevisionCauseV2Schema,
  status: storedResultStatusV2Schema,
  reason: storedResultReasonV2Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV2Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DISQUALIFICATION"
      ? "MANUAL_DISQUALIFICATION"
      : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNS kräver DNS-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION" &&
      (revision.status !== "DSQ" || revision.reason !== "MANUAL_DISQUALIFICATION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell diskvalifikation kräver DSQ-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DSQ-återtagande måste restaurera OK eller MP" });
  }
});

export const readoutHistoryRevisionV3Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV3Schema,
  cause: storedResultRevisionCauseV3Schema,
  status: storedResultStatusV3Schema,
  reason: storedResultReasonV3Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV3Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DISQUALIFICATION"
      ? "MANUAL_DISQUALIFICATION"
      : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        : revision.cause === "MANUAL_RESULT_APPROVAL"
          ? "MANUAL_RESULT_APPROVAL"
          : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
            ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
            : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNS kräver DNS-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION" &&
      (revision.status !== "DSQ" || revision.reason !== "MANUAL_DISQUALIFICATION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell diskvalifikation kräver DSQ-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DSQ-återtagande måste restaurera OK eller MP" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL" &&
      (revision.status !== "OK" || revision.reason !== "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt godkännande kräver OK/MANUAL_APPROVAL" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Återtaget godkännande måste restaurera tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV4Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV4Schema,
  cause: storedResultRevisionCauseV4Schema,
  status: storedResultStatusV4Schema,
  reason: storedResultReasonV4Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV4Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DID_NOT_FINISH"
      ? "MANUAL_DID_NOT_FINISH"
      : revision.cause === "MANUAL_DISQUALIFICATION"
        ? "MANUAL_DISQUALIFICATION"
        : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
          ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
          : revision.cause === "MANUAL_RESULT_APPROVAL"
            ? "MANUAL_RESULT_APPROVAL"
            : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
              ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
              : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNS kräver DNS-resultat" });
  }
  if (revision.cause === "MANUAL_DID_NOT_FINISH" &&
      (revision.status !== "DNF" || revision.reason !== "DID_NOT_FINISH")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNF kräver DNF-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION" &&
      (revision.status !== "DSQ" || revision.reason !== "MANUAL_DISQUALIFICATION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell diskvalifikation kräver DSQ-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DSQ-återtagande måste restaurera OK eller MP" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL" &&
      (revision.status !== "OK" || revision.reason !== "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt godkännande kräver OK/MANUAL_APPROVAL" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Återtaget godkännande måste restaurera tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV5Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV5Schema,
  cause: storedResultRevisionCauseV5Schema,
  status: storedResultStatusV4Schema,
  reason: storedResultReasonV4Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV4Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DID_NOT_FINISH"
      ? "MANUAL_DID_NOT_FINISH"
      : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        : revision.cause === "MANUAL_DISQUALIFICATION"
          ? "MANUAL_DISQUALIFICATION"
          : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
            ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
            : revision.cause === "MANUAL_RESULT_APPROVAL"
              ? "MANUAL_RESULT_APPROVAL"
              : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNS kräver DNS-resultat" });
  }
  if (revision.cause === "MANUAL_DID_NOT_FINISH" &&
      (revision.status !== "DNF" || revision.reason !== "DID_NOT_FINISH")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNF kräver DNF-resultat" });
  }
  if (revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DNF-återtagande måste restaurera tekniskt OK eller MP" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION" &&
      (revision.status !== "DSQ" || revision.reason !== "MANUAL_DISQUALIFICATION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell diskvalifikation kräver DSQ-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DSQ-återtagande måste restaurera OK eller MP" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL" &&
      (revision.status !== "OK" || revision.reason !== "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt godkännande kräver OK/MANUAL_APPROVAL" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Återtaget godkännande måste restaurera tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV6Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV6Schema,
  cause: storedResultRevisionCauseV6Schema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV5Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DID_NOT_FINISH"
      ? "MANUAL_DID_NOT_FINISH"
      : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        : revision.cause === "MANUAL_OUT_OF_COMPETITION"
          ? "MANUAL_OUT_OF_COMPETITION"
          : revision.cause === "MANUAL_DISQUALIFICATION"
            ? "MANUAL_DISQUALIFICATION"
            : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
              ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
              : revision.cause === "MANUAL_RESULT_APPROVAL"
                ? "MANUAL_RESULT_APPROVAL"
                : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                  ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                  : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNS kräver DNS-resultat" });
  }
  if (revision.cause === "MANUAL_DID_NOT_FINISH" &&
      (revision.status !== "DNF" || revision.reason !== "DID_NOT_FINISH")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt DNF kräver DNF-resultat" });
  }
  if (revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DNF-återtagande måste restaurera tekniskt OK eller MP" });
  }
  if (revision.cause === "MANUAL_OUT_OF_COMPETITION" &&
      (revision.status !== "OOC" || revision.reason !== "OUT_OF_COMPETITION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt utom tävlan kräver OOC-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION" &&
      (revision.status !== "DSQ" || revision.reason !== "MANUAL_DISQUALIFICATION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell diskvalifikation kräver DSQ-resultat" });
  }
  if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
      (revision.status !== "OK" && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "DSQ-återtagande måste restaurera OK eller MP" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL" &&
      (revision.status !== "OK" || revision.reason !== "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt godkännande kräver OK/MANUAL_APPROVAL" });
  }
  if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Återtaget godkännande måste restaurera tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV7Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV7Schema,
  cause: storedResultRevisionCauseV7Schema,
  status: storedResultStatusV6Schema,
  reason: storedResultReasonV6Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV6Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DID_NOT_FINISH"
      ? "MANUAL_DID_NOT_FINISH"
      : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        : revision.cause === "MANUAL_OUT_OF_COMPETITION"
          ? "MANUAL_OUT_OF_COMPETITION"
          : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
            ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
            : revision.cause === "MANUAL_DISQUALIFICATION"
              ? "MANUAL_DISQUALIFICATION"
              : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                : revision.cause === "MANUAL_RESULT_APPROVAL"
                  ? "MANUAL_RESULT_APPROVAL"
                  : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                    ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                    : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_OUT_OF_COMPETITION" &&
      (revision.status !== "OOC" || revision.reason !== "OUT_OF_COMPETITION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt utom tävlan kräver OOC-resultat" });
  }
  if (revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "OOC-återtagande måste restaurera strikt tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV8Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV8Schema,
  cause: storedResultRevisionCauseSchema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV7Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_DID_NOT_START"
    ? "MANUAL_DID_NOT_START"
    : revision.cause === "MANUAL_DID_NOT_FINISH"
      ? "MANUAL_DID_NOT_FINISH"
      : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        : revision.cause === "MANUAL_OUT_OF_COMPETITION"
          ? "MANUAL_OUT_OF_COMPETITION"
          : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
            ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
            : revision.cause === "MANUAL_WITHOUT_TIMING"
              ? "MANUAL_WITHOUT_TIMING"
              : revision.cause === "MANUAL_DISQUALIFICATION"
                ? "MANUAL_DISQUALIFICATION"
                : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                  ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                  : revision.cause === "MANUAL_RESULT_APPROVAL"
                    ? "MANUAL_RESULT_APPROVAL"
                    : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                      ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                      : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_OUT_OF_COMPETITION" &&
      (revision.status !== "OOC" || revision.reason !== "OUT_OF_COMPETITION")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuellt utom tävlan kräver OOC-resultat" });
  }
  if (revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "OOC-återtagande måste restaurera strikt tekniskt OK eller MP" });
  }
  if (revision.cause === "MANUAL_WITHOUT_TIMING" &&
      (revision.status !== "NT" || revision.reason !== "WITHOUT_TIMING")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell utan tidtagning kräver NT-resultat" });
  }
});

export const readoutHistoryRevisionV9Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV9Schema,
  cause: storedResultRevisionCauseV8Schema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
    ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
    : revision.cause === "MANUAL_DID_NOT_START"
      ? "MANUAL_DID_NOT_START"
      : revision.cause === "MANUAL_DID_NOT_FINISH"
        ? "MANUAL_DID_NOT_FINISH"
        : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
          ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
          : revision.cause === "MANUAL_OUT_OF_COMPETITION"
            ? "MANUAL_OUT_OF_COMPETITION"
            : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
              ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
              : revision.cause === "MANUAL_WITHOUT_TIMING"
                ? "MANUAL_WITHOUT_TIMING"
                : revision.cause === "MANUAL_DISQUALIFICATION"
                  ? "MANUAL_DISQUALIFICATION"
                  : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                    ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                    : revision.cause === "MANUAL_RESULT_APPROVAL"
                      ? "MANUAL_RESULT_APPROVAL"
                      : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                        ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                        : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_WITHOUT_TIMING" &&
      (revision.status !== "NT" || revision.reason !== "WITHOUT_TIMING")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell utan tidtagning kräver NT-resultat" });
  }
  if (revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "NT-återtagande måste restaurera strikt tekniskt OK eller MP" });
  }
});

const storedResultRevisionCauseV9Schema = z.enum([
  ...storedResultRevisionCauseV8Schema.options,
  "START_CHECKIN_DID_NOT_START"
]);
const storedResultRevisionCauseV10Schema = z.enum([
  ...storedResultRevisionCauseV9Schema.options,
  "MANUAL_FINISH_TIME_CORRECTION"
]);
const storedResultRevisionCauseV11Schema = z.enum([
  ...storedResultRevisionCauseV10Schema.options,
  "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
]);
const storedResultRevisionCauseV12Schema = z.enum([
  ...storedResultRevisionCauseV11Schema.options,
  "MANUAL_PUNCH_START_TIME_CORRECTION"
]);
const storedResultRevisionCauseV13Schema = z.enum([
  ...storedResultRevisionCauseV12Schema.options,
  "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"
]);
const storedResultRevisionCauseV14Schema = z.enum([
  ...storedResultRevisionCauseV13Schema.options,
  "SHORTENED_COURSE_CLASS_TRANSFER"
]);

export const readoutHistoryRevisionV10Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV10Schema,
  cause: storedResultRevisionCauseV9Schema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak måste matcha evaluation" });
  }
  if (!isValidStoredResultPair(revision.status, revision.reason)) {
    context.addIssue({ code: "custom", message: "Revisionens status och orsak hör inte ihop" });
  }
  if (!("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens banversion måste matcha evaluation" });
  }
  const expectedKind = revision.cause === "START_CHECKIN_DID_NOT_START"
    ? "START_CHECKIN_DID_NOT_START"
    : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
      ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
      : revision.cause === "MANUAL_DID_NOT_START"
        ? "MANUAL_DID_NOT_START"
        : revision.cause === "MANUAL_DID_NOT_FINISH"
          ? "MANUAL_DID_NOT_FINISH"
          : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
            ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
            : revision.cause === "MANUAL_OUT_OF_COMPETITION"
              ? "MANUAL_OUT_OF_COMPETITION"
              : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                : revision.cause === "MANUAL_WITHOUT_TIMING"
                  ? "MANUAL_WITHOUT_TIMING"
                  : revision.cause === "MANUAL_DISQUALIFICATION"
                    ? "MANUAL_DISQUALIFICATION"
                    : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                      ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                      : revision.cause === "MANUAL_RESULT_APPROVAL"
                        ? "MANUAL_RESULT_APPROVAL"
                        : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                          ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                          : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "START_CHECKIN_DID_NOT_START" &&
      (revision.status !== "DNS" || revision.reason !== "DID_NOT_START" ||
       revision.evaluation.status !== "DNS" || revision.evaluation.reason !== "DID_NOT_START")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Avpricknings-DNS kräver status-only DNS/DID_NOT_START" });
  }
  if (revision.cause === "MANUAL_WITHOUT_TIMING" &&
      (revision.status !== "NT" || revision.reason !== "WITHOUT_TIMING")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Manuell utan tidtagning kräver NT-resultat" });
  }
  if (revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" &&
      ((revision.status !== "OK" && revision.status !== "MP") || revision.reason === "MANUAL_APPROVAL")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "NT-återtagande måste restaurera strikt tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV11Schema = z.object({
  id: canonicalUuidSchema,
  revision: z.number().int().positive(),
  source: readoutHistoryRevisionSourceV11Schema,
  cause: storedResultRevisionCauseV10Schema,
  status: storedResultStatusSchema,
  reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema,
  published: z.boolean(),
  createdAt: instantSchema,
  evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason ||
      !isValidStoredResultPair(revision.status, revision.reason) ||
      !("courseVersionId" in revision.evaluation) || revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens lagrade resultat motsäger evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_FINISH_TIME_CORRECTION"
    ? "MANUAL_FINISH_TIME_CORRECTION"
    : revision.cause === "START_CHECKIN_DID_NOT_START"
      ? "START_CHECKIN_DID_NOT_START"
      : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
        ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
        : revision.cause === "MANUAL_DID_NOT_START"
          ? "MANUAL_DID_NOT_START"
          : revision.cause === "MANUAL_DID_NOT_FINISH"
            ? "MANUAL_DID_NOT_FINISH"
            : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
              ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
              : revision.cause === "MANUAL_OUT_OF_COMPETITION"
                ? "MANUAL_OUT_OF_COMPETITION"
                : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                  ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                  : revision.cause === "MANUAL_WITHOUT_TIMING"
                    ? "MANUAL_WITHOUT_TIMING"
                    : revision.cause === "MANUAL_DISQUALIFICATION"
                      ? "MANUAL_DISQUALIFICATION"
                      : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                        ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                        : revision.cause === "MANUAL_RESULT_APPROVAL"
                          ? "MANUAL_RESULT_APPROVAL"
                          : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                            ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                            : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) {
    context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  }
  if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION" &&
      ((revision.status !== "OK" || revision.reason !== "COMPLETE") &&
       (revision.status !== "MP" || (revision.reason !== "MISSING_CONTROL" && revision.reason !== "WRONG_ORDER")))) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Måltidsrättning måste bevara tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV12Schema = z.object({
  id: canonicalUuidSchema, revision: z.number().int().positive(), source: readoutHistoryRevisionSourceV12Schema,
  cause: storedResultRevisionCauseV11Schema, status: storedResultStatusSchema, reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64), snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema, published: z.boolean(), createdAt: instantSchema, evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason ||
      !isValidStoredResultPair(revision.status, revision.reason) || !("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens lagrade resultat motsäger evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_FINISH_TIME_CORRECTION"
    ? "MANUAL_FINISH_TIME_CORRECTION" : revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
      ? "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" : revision.cause === "START_CHECKIN_DID_NOT_START"
        ? "START_CHECKIN_DID_NOT_START" : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
          ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL" : revision.cause === "MANUAL_DID_NOT_START" ? "MANUAL_DID_NOT_START"
            : revision.cause === "MANUAL_DID_NOT_FINISH" ? "MANUAL_DID_NOT_FINISH" : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
              ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL" : revision.cause === "MANUAL_OUT_OF_COMPETITION" ? "MANUAL_OUT_OF_COMPETITION"
                : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                  : revision.cause === "MANUAL_WITHOUT_TIMING" ? "MANUAL_WITHOUT_TIMING" : revision.cause === "MANUAL_DISQUALIFICATION"
                    ? "MANUAL_DISQUALIFICATION" : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                      : revision.cause === "MANUAL_RESULT_APPROVAL" ? "MANUAL_RESULT_APPROVAL" : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                        ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL" : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
});

export const readoutHistoryRevisionV13Schema = z.object({
  id: canonicalUuidSchema, revision: z.number().int().positive(), source: readoutHistoryRevisionSourceV13Schema,
  cause: storedResultRevisionCauseV12Schema, status: storedResultStatusSchema, reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64), snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema, published: z.boolean(), createdAt: instantSchema, evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason ||
      !isValidStoredResultPair(revision.status, revision.reason) || !("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens lagrade resultat motsäger evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION" ? "MANUAL_PUNCH_START_TIME_CORRECTION"
    : revision.cause === "MANUAL_FINISH_TIME_CORRECTION" ? "MANUAL_FINISH_TIME_CORRECTION"
      : revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" ? "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
        : revision.cause === "START_CHECKIN_DID_NOT_START" ? "START_CHECKIN_DID_NOT_START"
          : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
            : revision.cause === "MANUAL_DID_NOT_START" ? "MANUAL_DID_NOT_START"
              : revision.cause === "MANUAL_DID_NOT_FINISH" ? "MANUAL_DID_NOT_FINISH" : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
                ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL" : revision.cause === "MANUAL_OUT_OF_COMPETITION" ? "MANUAL_OUT_OF_COMPETITION"
                  : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                    : revision.cause === "MANUAL_WITHOUT_TIMING" ? "MANUAL_WITHOUT_TIMING" : revision.cause === "MANUAL_DISQUALIFICATION"
                      ? "MANUAL_DISQUALIFICATION" : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                        : revision.cause === "MANUAL_RESULT_APPROVAL" ? "MANUAL_RESULT_APPROVAL" : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                          ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL" : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  if (revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION" &&
      ((revision.status !== "OK" || revision.reason !== "COMPLETE") &&
       (revision.status !== "MP" || (revision.reason !== "MISSING_CONTROL" && revision.reason !== "WRONG_ORDER")))) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Starttidsrättning måste bevara tekniskt OK eller MP" });
  }
});

export const readoutHistoryRevisionV14Schema = z.object({
  id: canonicalUuidSchema, revision: z.number().int().positive(), source: readoutHistoryRevisionSourceV14Schema,
  cause: storedResultRevisionCauseV13Schema, status: storedResultStatusSchema, reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64), snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema, published: z.boolean(), createdAt: instantSchema, evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason ||
      !isValidStoredResultPair(revision.status, revision.reason) || !("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens lagrade resultat motsäger evaluation" });
  }
  const expectedKind = revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" ? "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"
    : revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION" ? "MANUAL_PUNCH_START_TIME_CORRECTION"
      : revision.cause === "MANUAL_FINISH_TIME_CORRECTION" ? "MANUAL_FINISH_TIME_CORRECTION"
        : revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" ? "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
          : revision.cause === "START_CHECKIN_DID_NOT_START" ? "START_CHECKIN_DID_NOT_START"
            : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
              : revision.cause === "MANUAL_DID_NOT_START" ? "MANUAL_DID_NOT_START"
                : revision.cause === "MANUAL_DID_NOT_FINISH" ? "MANUAL_DID_NOT_FINISH" : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
                  ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL" : revision.cause === "MANUAL_OUT_OF_COMPETITION" ? "MANUAL_OUT_OF_COMPETITION"
                    : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                      : revision.cause === "MANUAL_WITHOUT_TIMING" ? "MANUAL_WITHOUT_TIMING" : revision.cause === "MANUAL_DISQUALIFICATION"
                        ? "MANUAL_DISQUALIFICATION" : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                          : revision.cause === "MANUAL_RESULT_APPROVAL" ? "MANUAL_RESULT_APPROVAL" : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                            ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL" : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
});

export const readoutHistoryRevisionV15Schema = z.object({
  id: canonicalUuidSchema, revision: z.number().int().positive(), source: readoutHistoryRevisionSourceV15Schema,
  cause: storedResultRevisionCauseV14Schema, status: storedResultStatusSchema, reason: storedResultReasonSchema,
  engineVersion: z.string().trim().min(1).max(64), snapshotVersion: z.number().int().positive(),
  courseVersionId: canonicalUuidSchema, published: z.boolean(), createdAt: instantSchema, evaluation: resultOutcomeV8Schema
}).strict().superRefine((revision, context) => {
  if (revision.status !== revision.evaluation.status || revision.reason !== revision.evaluation.reason ||
      !isValidStoredResultPair(revision.status, revision.reason) || !("courseVersionId" in revision.evaluation) ||
      revision.courseVersionId !== revision.evaluation.courseVersionId) {
    context.addIssue({ code: "custom", message: "Revisionens lagrade resultat motsäger evaluation" });
  }
  const expectedKind = revision.cause === "SHORTENED_COURSE_CLASS_TRANSFER" ? "SHORTENED_COURSE_CLASS_TRANSFER"
    : revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" ? "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"
      : revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION" ? "MANUAL_PUNCH_START_TIME_CORRECTION"
        : revision.cause === "MANUAL_FINISH_TIME_CORRECTION" ? "MANUAL_FINISH_TIME_CORRECTION"
          : revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" ? "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
            : revision.cause === "START_CHECKIN_DID_NOT_START" ? "START_CHECKIN_DID_NOT_START"
              : revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" ? "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
                : revision.cause === "MANUAL_DID_NOT_START" ? "MANUAL_DID_NOT_START"
                  : revision.cause === "MANUAL_DID_NOT_FINISH" ? "MANUAL_DID_NOT_FINISH" : revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
                    ? "MANUAL_DID_NOT_FINISH_WITHDRAWAL" : revision.cause === "MANUAL_OUT_OF_COMPETITION" ? "MANUAL_OUT_OF_COMPETITION"
                      : revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ? "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
                        : revision.cause === "MANUAL_WITHOUT_TIMING" ? "MANUAL_WITHOUT_TIMING" : revision.cause === "MANUAL_DISQUALIFICATION"
                          ? "MANUAL_DISQUALIFICATION" : revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" ? "MANUAL_DISQUALIFICATION_WITHDRAWAL"
                            : revision.cause === "MANUAL_RESULT_APPROVAL" ? "MANUAL_RESULT_APPROVAL" : revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
                              ? "MANUAL_RESULT_APPROVAL_WITHDRAWAL" : "READOUT_RESULT";
  if (revision.source.kind !== expectedKind) context.addIssue({ code: "custom", path: ["source"], message: "Revisionsorsak och proveniens motsäger varandra" });
  if (revision.cause === "SHORTENED_COURSE_CLASS_TRANSFER" &&
      ((revision.status !== "OK" || revision.reason !== "COMPLETE") && revision.status !== "MP")) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Kortbaneomvärdering måste ge tekniskt OK eller MP" });
  }
});

export const readoutHistoryDetailResponseV1Schema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV1Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 ||
        response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV2Schema = z.object({
  formatVersion: z.literal(2),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV2Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 ||
        response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV3Schema = z.object({
  formatVersion: z.literal(3),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV3Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 ||
        response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV4Schema = z.object({
  formatVersion: z.literal(4),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV4Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV5Schema = z.object({
  formatVersion: z.literal(5),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV5Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV6Schema = z.object({
  formatVersion: z.literal(6),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV6Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV7Schema = z.object({
  formatVersion: z.literal(7),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV7Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV8Schema = z.object({
  formatVersion: z.literal(8),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV8Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV9Schema = z.object({
  formatVersion: z.literal(9),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV9Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV10Schema = z.object({
  formatVersion: z.literal(10),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV10Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null) {
    if (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null) {
      context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
    }
  } else {
    for (const [index, revision] of response.history.items.entries()) {
      if (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
      }
      if (revision.revision > response.history.upperRevision) {
        context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
      }
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV11Schema = z.object({
  formatVersion: z.literal(11),
  raceId: canonicalUuidSchema,
  readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(),
  entry: entryIdentitySchema.nullable(),
  history: z.object({
    upperRevision: z.number().int().nonnegative(),
    items: z.array(readoutHistoryRevisionV11Schema).max(50),
    nextCursor: cursorSchema.nullable()
  }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null && (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null)) {
    context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
  }
  for (const [index, revision] of response.history.items.entries()) {
    if (response.entry !== null && (!("entryId" in revision.evaluation) || revision.evaluation.entryId !== response.entry.id)) {
      context.addIssue({ code: "custom", path: ["history", "items", index, "evaluation", "entryId"], message: "Revisionen måste höra till deltagaren" });
    }
    if (revision.revision > response.history.upperRevision) {
      context.addIssue({ code: "custom", path: ["history", "items", index, "revision"], message: "Revisionen ligger över vattenmärket" });
    }
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV12Schema = z.object({
  formatVersion: z.literal(12), raceId: canonicalUuidSchema, readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(), entry: entryIdentitySchema.nullable(),
  history: z.object({ upperRevision: z.number().int().nonnegative(), items: z.array(readoutHistoryRevisionV12Schema).max(50), nextCursor: cursorSchema.nullable() }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null && (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null)) {
    context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV13Schema = z.object({
  formatVersion: z.literal(13), raceId: canonicalUuidSchema, readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(), entry: entryIdentitySchema.nullable(),
  history: z.object({ upperRevision: z.number().int().nonnegative(), items: z.array(readoutHistoryRevisionV13Schema).max(50), nextCursor: cursorSchema.nullable() }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null && (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null)) {
    context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV14Schema = z.object({
  formatVersion: z.literal(14), raceId: canonicalUuidSchema, readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(), entry: entryIdentitySchema.nullable(),
  history: z.object({ upperRevision: z.number().int().nonnegative(), items: z.array(readoutHistoryRevisionV14Schema).max(50), nextCursor: cursorSchema.nullable() }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null && (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null)) {
    context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseV15Schema = z.object({
  formatVersion: z.literal(15), raceId: canonicalUuidSchema, readout: normalizedReadoutSchema,
  firstServerAssessment: firstServerAssessmentSchema.nullable(), entry: entryIdentitySchema.nullable(),
  history: z.object({ upperRevision: z.number().int().nonnegative(), items: z.array(readoutHistoryRevisionV15Schema).max(50), nextCursor: cursorSchema.nullable() }).strict()
}).strict().superRefine((response, context) => {
  if (response.entry === null && (response.history.upperRevision !== 0 || response.history.items.length !== 0 || response.history.nextCursor !== null)) {
    context.addIssue({ code: "custom", path: ["history"], message: "Okänd avläsning får inte ha revisionshistorik" });
  }
  const numbers = response.history.items.map((item) => item.revision);
  if (new Set(numbers).size !== numbers.length || numbers.some((value, index) => index > 0 && value <= numbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["history", "items"], message: "Revisioner måste vara unika och stigande" });
  }
});

export const readoutHistoryDetailResponseSchema = z.discriminatedUnion("formatVersion", [
  readoutHistoryDetailResponseV1Schema,
  readoutHistoryDetailResponseV2Schema,
  readoutHistoryDetailResponseV3Schema,
  readoutHistoryDetailResponseV4Schema,
  readoutHistoryDetailResponseV5Schema,
  readoutHistoryDetailResponseV6Schema,
  readoutHistoryDetailResponseV7Schema,
  readoutHistoryDetailResponseV8Schema,
  readoutHistoryDetailResponseV9Schema,
  readoutHistoryDetailResponseV10Schema,
  readoutHistoryDetailResponseV11Schema,
  readoutHistoryDetailResponseV12Schema,
  readoutHistoryDetailResponseV13Schema,
  readoutHistoryDetailResponseV14Schema,
  readoutHistoryDetailResponseV15Schema
]);

export const readoutResultHistoryAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INTERNAL_ERROR"
]);

export const readoutResultHistoryAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: readoutResultHistoryAdminErrorCodeSchema
}).strict();

export type ReadoutResultHistoryAdminLoginRequest = z.infer<typeof readoutResultHistoryAdminLoginRequestSchema>;
export type ReadoutResultHistoryAdminLoginResponse = z.infer<typeof readoutResultHistoryAdminLoginResponseSchema>;
export type ReadoutHistoryListQuery = z.infer<typeof readoutHistoryListQuerySchema>;
export type ReadoutHistoryDetailQuery = z.infer<typeof readoutHistoryDetailQuerySchema>;
export type ReadoutHistoryListResponseV1 = z.infer<typeof readoutHistoryListResponseV1Schema>;
export type ReadoutHistoryListResponseV2 = z.infer<typeof readoutHistoryListResponseV2Schema>;
export type ReadoutHistoryListResponseV3 = z.infer<typeof readoutHistoryListResponseV3Schema>;
export type ReadoutHistoryListResponseV4 = z.infer<typeof readoutHistoryListResponseV4Schema>;
export type ReadoutHistoryListResponseV5 = z.infer<typeof readoutHistoryListResponseV5Schema>;
export type ReadoutHistoryListResponseV6 = z.infer<typeof readoutHistoryListResponseV6Schema>;
export type ReadoutHistoryListResponseV7 = z.infer<typeof readoutHistoryListResponseV7Schema>;
export type ReadoutHistoryListResponseV8 = z.infer<typeof readoutHistoryListResponseV8Schema>;
export type ReadoutHistoryListResponseV9 = z.infer<typeof readoutHistoryListResponseV9Schema>;
export type ReadoutHistoryListResponseV10 = z.infer<typeof readoutHistoryListResponseV10Schema>;
export type ReadoutHistoryListResponse = z.infer<typeof readoutHistoryListResponseSchema>;
export type ReadoutHistoryDetailResponseV1 = z.infer<typeof readoutHistoryDetailResponseV1Schema>;
export type ReadoutHistoryDetailResponseV2 = z.infer<typeof readoutHistoryDetailResponseV2Schema>;
export type ReadoutHistoryDetailResponseV3 = z.infer<typeof readoutHistoryDetailResponseV3Schema>;
export type ReadoutHistoryDetailResponseV4 = z.infer<typeof readoutHistoryDetailResponseV4Schema>;
export type ReadoutHistoryDetailResponseV5 = z.infer<typeof readoutHistoryDetailResponseV5Schema>;
export type ReadoutHistoryDetailResponseV6 = z.infer<typeof readoutHistoryDetailResponseV6Schema>;
export type ReadoutHistoryDetailResponseV7 = z.infer<typeof readoutHistoryDetailResponseV7Schema>;
export type ReadoutHistoryDetailResponseV8 = z.infer<typeof readoutHistoryDetailResponseV8Schema>;
export type ReadoutHistoryDetailResponseV9 = z.infer<typeof readoutHistoryDetailResponseV9Schema>;
export type ReadoutHistoryDetailResponseV10 = z.infer<typeof readoutHistoryDetailResponseV10Schema>;
export type ReadoutHistoryDetailResponseV11 = z.infer<typeof readoutHistoryDetailResponseV11Schema>;
export type ReadoutHistoryDetailResponseV12 = z.infer<typeof readoutHistoryDetailResponseV12Schema>;
export type ReadoutHistoryDetailResponseV13 = z.infer<typeof readoutHistoryDetailResponseV13Schema>;
export type ReadoutHistoryDetailResponseV14 = z.infer<typeof readoutHistoryDetailResponseV14Schema>;
export type ReadoutHistoryDetailResponseV15 = z.infer<typeof readoutHistoryDetailResponseV15Schema>;
export type ReadoutHistoryDetailResponse = z.infer<typeof readoutHistoryDetailResponseSchema>;
export type ReadoutHistoryRevisionV1 = z.infer<typeof readoutHistoryRevisionV1Schema>;
export type ReadoutHistoryRevisionSourceV2 = z.infer<typeof readoutHistoryRevisionSourceV2Schema>;
export type ReadoutHistoryRevisionV2 = z.infer<typeof readoutHistoryRevisionV2Schema>;
export type ReadoutHistoryRevisionSourceV3 = z.infer<typeof readoutHistoryRevisionSourceV3Schema>;
export type ReadoutHistoryRevisionV3 = z.infer<typeof readoutHistoryRevisionV3Schema>;
export type ReadoutHistoryRevisionSourceV4 = z.infer<typeof readoutHistoryRevisionSourceV4Schema>;
export type ReadoutHistoryRevisionV4 = z.infer<typeof readoutHistoryRevisionV4Schema>;
export type ReadoutHistoryRevisionSourceV5 = z.infer<typeof readoutHistoryRevisionSourceV5Schema>;
export type ReadoutHistoryRevisionV5 = z.infer<typeof readoutHistoryRevisionV5Schema>;
export type ReadoutHistoryRevisionSourceV6 = z.infer<typeof readoutHistoryRevisionSourceV6Schema>;
export type ReadoutHistoryRevisionV6 = z.infer<typeof readoutHistoryRevisionV6Schema>;
export type ReadoutHistoryRevisionSourceV7 = z.infer<typeof readoutHistoryRevisionSourceV7Schema>;
export type ReadoutHistoryRevisionV7 = z.infer<typeof readoutHistoryRevisionV7Schema>;
export type ReadoutHistoryRevisionSourceV8 = z.infer<typeof readoutHistoryRevisionSourceV8Schema>;
export type ReadoutHistoryRevisionV8 = z.infer<typeof readoutHistoryRevisionV8Schema>;
export type ReadoutHistoryRevisionSourceV9 = z.infer<typeof readoutHistoryRevisionSourceV9Schema>;
export type ReadoutHistoryRevisionV9 = z.infer<typeof readoutHistoryRevisionV9Schema>;
export type ReadoutHistoryRevisionSourceV10 = z.infer<typeof readoutHistoryRevisionSourceV10Schema>;
export type ReadoutHistoryRevisionV10 = z.infer<typeof readoutHistoryRevisionV10Schema>;
export type ReadoutHistoryRevisionSourceV11 = z.infer<typeof readoutHistoryRevisionSourceV11Schema>;
export type ReadoutHistoryRevisionV11 = z.infer<typeof readoutHistoryRevisionV11Schema>;
export type ReadoutHistoryRevisionSourceV12 = z.infer<typeof readoutHistoryRevisionSourceV12Schema>;
export type ReadoutHistoryRevisionSourceV13 = z.infer<typeof readoutHistoryRevisionSourceV13Schema>;
export type ReadoutHistoryRevisionSourceV14 = z.infer<typeof readoutHistoryRevisionSourceV14Schema>;
export type ReadoutHistoryRevisionSourceV15 = z.infer<typeof readoutHistoryRevisionSourceV15Schema>;
export type ReadoutHistoryRevisionV12 = z.infer<typeof readoutHistoryRevisionV12Schema>;
export type ReadoutHistoryRevisionV15 = z.infer<typeof readoutHistoryRevisionV15Schema>;
export type ReadoutResultHistoryAdminErrorCode = z.infer<typeof readoutResultHistoryAdminErrorCodeSchema>;
