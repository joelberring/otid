import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const elapsedMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * The operator may enter an offset-bearing instant. It is normalized by the
 * application before it is persisted or included in an immutable decision.
 */
export const manualFinishTimeCorrectionInstantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const match = /T\d{2}:\d{2}:\d{2}(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  return match[2] === "Z" || (Number(match[3]) <= 14 && Number(match[4]) <= 59 &&
    (Number(match[3]) < 14 || Number(match[4]) === 0));
}).transform((value) => new Date(value).toISOString());

const canonicalInstant = z.iso.datetime({ offset: true }).refine((value) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
);

const directTechnicalCauseSchema = z.enum([
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION"
]);

const directTechnicalOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("OK"), reason: z.literal("COMPLETE") }).strict(),
  z.object({ status: z.literal("MP"), reason: z.enum(["MISSING_CONTROL", "WRONG_ORDER"]) }).strict()
]);

export const manualFinishTimeCorrectionSourceSchema = z.object({
  resultRevisionId: uuid,
  resultRevision: version,
  readoutId: uuid,
  cause: directTechnicalCauseSchema,
  courseVersionId: uuid,
  snapshotVersion: version,
  outcome: directTechnicalOutcomeSchema,
  startTime: canonicalInstant,
  finishTime: canonicalInstant,
  elapsedMs,
  latestMatchedSplitElapsedMs: elapsedMs.nullable()
}).strict().superRefine((value, context) => {
  const measuredElapsedMs = Date.parse(value.finishTime) - Date.parse(value.startTime);
  if (measuredElapsedMs !== value.elapsedMs) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Löptiden måste motsvara källans start och mål" });
  }
  if (value.latestMatchedSplitElapsedMs !== null && value.latestMatchedSplitElapsedMs > value.elapsedMs) {
    context.addIssue({ code: "custom", path: ["latestMatchedSplitElapsedMs"], message: "Senaste split får inte ligga efter källans mål" });
  }
});

/** The read-only preview projection. Its basis must be echoed unchanged on commit. */
export const manualFinishTimeCorrectionCandidateSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  entryId: uuid,
  entryName: z.string().trim().min(1).max(321),
  entryVersion: version,
  classId: uuid,
  className: z.string().trim().min(1).max(160),
  snapshotVersion: version,
  basisHash: sha256,
  source: manualFinishTimeCorrectionSourceSchema
}).strict();

/**
 * Commit intent for one correction. All source fields are locks, not editable
 * result fields; the only new result value is correctedFinishTime.
 */
export const manualFinishTimeCorrectionRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  entryId: uuid,
  expectedEntryVersion: version,
  expectedClassId: uuid,
  expectedCourseVersionId: uuid,
  expectedSnapshotVersion: version,
  expectedBasisHash: sha256,
  expectedSourceResultRevisionId: uuid,
  expectedSourceResultRevision: version,
  expectedReadoutId: uuid,
  expectedSourceFinishTime: canonicalInstant,
  correctedFinishTime: manualFinishTimeCorrectionInstantSchema,
  acknowledgedCorrection: z.literal(true)
}).strict();

export const manualFinishTimeCorrectionIdempotencyKeySchema = z.string().regex(
  /^manual-finish-time-correction:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const manualFinishTimeCorrectionResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  correctionId: uuid,
  raceId: uuid,
  entryId: uuid,
  classId: uuid,
  courseVersionId: uuid,
  sourceSnapshotVersion: version,
  sourceBasisHash: sha256,
  snapshotVersionAfter: version,
  source: manualFinishTimeCorrectionSourceSchema,
  previousFinishTime: canonicalInstant,
  correctedFinishTime: canonicalInstant,
  elapsedMs,
  createdResultRevisionId: uuid,
  createdResultRevision: version,
  cause: z.literal("MANUAL_FINISH_TIME_CORRECTION"),
  request: manualFinishTimeCorrectionRequestSchema,
  correctedAt: canonicalInstant
}).strict().superRefine((value, context) => {
  const correctedElapsedMs = Date.parse(value.correctedFinishTime) - Date.parse(value.source.startTime);
  const source = value.source;
  const request = value.request;
  if (value.requestId !== request.requestId || value.entryId !== request.entryId ||
      value.classId !== request.expectedClassId || value.courseVersionId !== request.expectedCourseVersionId ||
      value.sourceSnapshotVersion !== request.expectedSnapshotVersion || value.sourceBasisHash !== request.expectedBasisHash ||
      value.snapshotVersionAfter !== value.sourceSnapshotVersion ||
      source.resultRevisionId !== request.expectedSourceResultRevisionId ||
      source.resultRevision !== request.expectedSourceResultRevision || source.readoutId !== request.expectedReadoutId ||
      source.finishTime !== request.expectedSourceFinishTime || value.previousFinishTime !== source.finishTime) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda granskat intent och exakt källa" });
  }
  if (value.createdResultRevision <= source.resultRevision ||
      Date.parse(value.correctedFinishTime) === Date.parse(value.previousFinishTime) ||
      correctedElapsedMs !== value.elapsedMs || correctedElapsedMs <= 0 ||
      (source.latestMatchedSplitElapsedMs !== null && correctedElapsedMs < source.latestMatchedSplitElapsedMs)) {
    context.addIssue({ code: "custom", message: "Korrigerad måltid måste skapa en senare revision efter start och senaste split" });
  }
});

export type ManualFinishTimeCorrectionCandidate = z.infer<typeof manualFinishTimeCorrectionCandidateSchema>;
export type ManualFinishTimeCorrectionRequest = z.infer<typeof manualFinishTimeCorrectionRequestSchema>;
export type ManualFinishTimeCorrectionResponse = z.infer<typeof manualFinishTimeCorrectionResponseSchema>;
