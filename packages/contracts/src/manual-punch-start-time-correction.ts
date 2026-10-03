import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const elapsedMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const manualPunchStartTimeCorrectionInstantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const match = /T\d{2}:\d{2}:\d{2}(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  return match[2] === "Z" || (Number(match[3]) <= 14 && Number(match[4]) <= 59 &&
    (Number(match[3]) < 14 || Number(match[4]) === 0));
}).transform((value) => new Date(value).toISOString());

const canonicalInstant = z.iso.datetime({ offset: true }).refine((value) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
);

const directTechnicalCauseSchema = z.enum([
  "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "UNKNOWN_READOUT_RESOLUTION"
]);
const directTechnicalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("OK"), reason: z.literal("COMPLETE") }).strict(),
  z.object({ status: z.literal("MP"), reason: z.enum(["MISSING_CONTROL", "WRONG_ORDER"]) }).strict()
]);
const splitSchema = z.object({
  controlCode: z.number().int().positive(), occurrence: z.number().int().positive(), elapsedMs, legMs: elapsedMs
}).strict();

export const manualPunchStartTimeCorrectionSourceSchema = z.object({
  resultRevisionId: uuid, resultRevision: version, readoutId: uuid, cause: directTechnicalCauseSchema,
  courseVersionId: uuid, snapshotVersion: version, startRule: z.literal("PUNCH"),
  outcome: directTechnicalOutcomeSchema, startTime: canonicalInstant, finishTime: canonicalInstant, elapsedMs,
  splits: z.array(splitSchema).max(256)
}).strict().superRefine((value, context) => {
  if (Date.parse(value.finishTime) - Date.parse(value.startTime) !== value.elapsedMs || value.elapsedMs <= 0) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Källans löptid måste motsvara observerad start och mål" });
  }
  let previous = -1;
  for (const [index, split] of value.splits.entries()) {
    if (split.elapsedMs < previous || split.elapsedMs > value.elapsedMs ||
      (index === 0 && split.legMs !== split.elapsedMs) || (index > 0 && split.legMs !== split.elapsedMs - previous)) {
      context.addIssue({ code: "custom", path: ["splits", index], message: "Källans split-tider måste vara sammanhängande" });
    }
    previous = split.elapsedMs;
  }
});

export const manualPunchStartTimeCorrectionCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, entryName: z.string().trim().min(1).max(321),
  entryVersion: version, classId: uuid, className: z.string().trim().min(1).max(160), snapshotVersion: version,
  basisHash: sha256, source: manualPunchStartTimeCorrectionSourceSchema
}).strict();

export const manualPunchStartTimeCorrectionRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, entryId: uuid, expectedEntryVersion: version,
  expectedClassId: uuid, expectedCourseVersionId: uuid, expectedSnapshotVersion: version, expectedBasisHash: sha256,
  expectedSourceResultRevisionId: uuid, expectedSourceResultRevision: version, expectedReadoutId: uuid,
  expectedSourceStartTime: canonicalInstant, correctedStartTime: manualPunchStartTimeCorrectionInstantSchema,
  acknowledgedCorrection: z.literal(true)
}).strict();

export const manualPunchStartTimeCorrectionIdempotencyKeySchema = z.string().regex(
  /^manual-punch-start-time-correction:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const manualPunchStartTimeCorrectionResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, correctionId: uuid, raceId: uuid, entryId: uuid,
  classId: uuid, courseVersionId: uuid, sourceSnapshotVersion: version, sourceBasisHash: sha256,
  snapshotVersionAfter: version, source: manualPunchStartTimeCorrectionSourceSchema,
  previousStartTime: canonicalInstant, correctedStartTime: canonicalInstant, elapsedMs,
  createdResultRevisionId: uuid, createdResultRevision: version, cause: z.literal("MANUAL_PUNCH_START_TIME_CORRECTION"),
  request: manualPunchStartTimeCorrectionRequestSchema, correctedAt: canonicalInstant
}).strict().superRefine((value, context) => {
  const request = value.request;
  if (value.requestId !== request.requestId || value.correctionId !== request.requestId || value.entryId !== request.entryId ||
      value.classId !== request.expectedClassId || value.courseVersionId !== request.expectedCourseVersionId ||
      value.sourceSnapshotVersion !== request.expectedSnapshotVersion || value.sourceBasisHash !== request.expectedBasisHash ||
      value.snapshotVersionAfter !== value.sourceSnapshotVersion || value.source.resultRevisionId !== request.expectedSourceResultRevisionId ||
      value.source.resultRevision !== request.expectedSourceResultRevision || value.source.readoutId !== request.expectedReadoutId ||
      value.source.startTime !== request.expectedSourceStartTime || value.previousStartTime !== value.source.startTime ||
      Date.parse(value.source.finishTime) - Date.parse(value.correctedStartTime) !== value.elapsedMs || value.elapsedMs <= 0 ||
      Date.parse(value.correctedStartTime) === Date.parse(value.previousStartTime)) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda granskat intent och korrekt tidsgrund" });
  }
});

export type ManualPunchStartTimeCorrectionCandidate = z.infer<typeof manualPunchStartTimeCorrectionCandidateSchema>;
export type ManualPunchStartTimeCorrectionRequest = z.infer<typeof manualPunchStartTimeCorrectionRequestSchema>;
export type ManualPunchStartTimeCorrectionResponse = z.infer<typeof manualPunchStartTimeCorrectionResponseSchema>;
