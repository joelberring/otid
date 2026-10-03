import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().trim().min(1).max(160);
const displayName = z.string().trim().min(1).max(321);
const controlCode = z.number().int().positive().max(2_147_483_647);
const startRule = z.enum(["FIXED", "PUNCH"]);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value =>
  Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

const sourceControlSchema = z.object({
  courseControlId: uuid,
  sequence: version,
  controlCode
}).strict();

const sourceResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NO_RESULT") }).strict(),
  z.object({
    kind: z.literal("CARD_READOUT_MP"), resultRevisionId: uuid, resultRevision: version,
    readoutId: uuid, snapshotVersion: version, courseVersionId: uuid,
    status: z.literal("MP"), cause: z.literal("CARD_READOUT"), published: z.literal(true)
  }).strict()
]);

const entryCandidateSchema = z.object({
  entryId: uuid, entryVersion: version, displayName,
  startRule, fixedStartTime: utcMilliseconds.nullable(),
  sourceResult: sourceResultSchema
}).strict().superRefine((value, context) => {
  if ((value.startRule === "FIXED") !== (value.fixedStartTime !== null)) {
    context.addIssue({ code: "custom", path: ["fixedStartTime"], message: "Startregel och tidsgrund måste stämma" });
  }
});

export const shortenedCourseClassTransferPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), sourceClassId: uuid
}).strict();

export const shortenedCourseClassTransferCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  sourceClassId: uuid, sourceClassName: name,
  sourceCourseId: uuid, sourceCourseName: name,
  sourceCourseVersionId: uuid, sourceCourseVersion: version,
  sourceStartRule: startRule, snapshotVersion: version, basisHash: sha256,
  sourceControls: z.array(sourceControlSchema).min(2).max(1_000),
  entries: z.array(entryCandidateSchema).max(10_000)
}).strict().superRefine((value, context) => {
  if (new Set(value.sourceControls.map(control => control.courseControlId)).size !== value.sourceControls.length ||
      value.sourceControls.some((control, index) => control.sequence !== index + 1)) {
    context.addIssue({ code: "custom", path: ["sourceControls"], message: "Källkontroller måste vara unika och ligga i exakt ordning" });
  }
  if (new Set(value.entries.map(entry => entry.entryId)).size !== value.entries.length ||
      value.entries.some((entry, index) => index > 0 && entry.entryId <= value.entries[index - 1]!.entryId)) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagare måste vara unika i UUID-ordning" });
  }
  if (value.entries.some(entry => entry.startRule !== value.sourceStartRule ||
    (entry.sourceResult.kind === "CARD_READOUT_MP" && entry.sourceResult.courseVersionId !== value.sourceCourseVersionId))) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagargrund måste stämma med aktuell källklass och bana" });
  }
});

export const shortenedCourseClassTransferRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid,
  sourceClassId: uuid, expectedSourceCourseVersionId: uuid, expectedSourceStartRule: startRule,
  expectedSnapshotVersion: version, expectedBasisHash: sha256,
  shortCourseName: name, shortClassName: name,
  expectedSourceControlCount: z.number().int().min(2).max(1_000),
  controlPrefix: z.array(sourceControlSchema).min(1).max(999),
  entryIds: z.array(uuid).min(1).max(100)
}).strict().superRefine((value, context) => {
  if (new Set(value.entryIds).size !== value.entryIds.length ||
      value.entryIds.some((entryId, index) => index > 0 && entryId <= value.entryIds[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["entryIds"], message: "Deltagare måste vara unika i kanonisk UUID-ordning" });
  }
  if (new Set(value.controlPrefix.map(control => control.courseControlId)).size !== value.controlPrefix.length ||
      value.controlPrefix.some((control, index) => control.sequence !== index + 1)) {
    context.addIssue({ code: "custom", path: ["controlPrefix"], message: "Prefixets kontroller måste vara unika och ordnade från början" });
  }
  if (value.controlPrefix.length >= value.expectedSourceControlCount) {
    context.addIssue({ code: "custom", path: ["controlPrefix"], message: "Prefixet måste vara strikt kortare än källbanan" });
  }
});

export const shortenedCourseClassTransferIdempotencyKeySchema = z.string().regex(
  /^shortened-course-class-transfer:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

const receiptItemSchema = z.object({
  entryId: uuid, entryVersionBefore: version, entryVersionAfter: version,
  effect: z.enum(["MOVED_ONLY", "MOVED_AND_REEVALUATED"]),
  sourceResultRevisionId: uuid.nullable(), sourceReadoutId: uuid.nullable(),
  createdResultRevisionId: uuid.nullable(), createdResultRevision: version.nullable(),
  resultingStatus: z.enum(["OK", "MP"]).nullable()
}).strict().superRefine((value, context) => {
  if (value.entryVersionAfter !== value.entryVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["entryVersionAfter"], message: "Flytt måste öka deltagarversionen exakt ett steg" });
  }
  const reevaluated = value.effect === "MOVED_AND_REEVALUATED";
  if (reevaluated !== (value.sourceResultRevisionId !== null && value.sourceReadoutId !== null &&
    value.createdResultRevisionId !== null && value.createdResultRevision !== null && value.resultingStatus !== null)) {
    context.addIssue({ code: "custom", message: "Omvärdering kräver exakt käll- och målrevision samt readout" });
  }
  if (!reevaluated && (value.sourceResultRevisionId !== null || value.sourceReadoutId !== null ||
    value.createdResultRevisionId !== null || value.createdResultRevision !== null || value.resultingStatus !== null)) {
    context.addIssue({ code: "custom", message: "Resultatlös flytt får inte fabricera resultatgrund" });
  }
});

export const shortenedCourseClassTransferReceiptSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, transferId: uuid,
  raceId: uuid, sourceClassId: uuid, sourceCourseVersionId: uuid,
  shortCourseId: uuid, shortCourseVersionId: uuid, shortClassId: uuid,
  sourceSnapshotVersion: version, snapshotVersionAfter: version, sourceBasisHash: sha256,
  request: shortenedCourseClassTransferRequestSchema,
  transferredAt: utcMilliseconds, items: z.array(receiptItemSchema).min(1).max(100)
}).strict().superRefine((value, context) => {
  if (value.transferId !== value.requestId || value.requestId !== value.request.requestId ||
      value.sourceClassId !== value.request.sourceClassId ||
      value.sourceCourseVersionId !== value.request.expectedSourceCourseVersionId ||
      value.sourceSnapshotVersion !== value.request.expectedSnapshotVersion ||
      value.sourceBasisHash !== value.request.expectedBasisHash ||
      value.snapshotVersionAfter !== value.sourceSnapshotVersion + 1) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda request, källgrund och exakt snapshotsprång" });
  }
  if (value.items.map(item => item.entryId).join("\0") !== value.request.entryIds.join("\0")) {
    context.addIssue({ code: "custom", path: ["items"], message: "Kvittensen måste innehålla exakt den kanoniska entrymängden" });
  }
});

export type ShortenedCourseClassTransferPreviewRequest = z.infer<typeof shortenedCourseClassTransferPreviewRequestSchema>;
export type ShortenedCourseClassTransferCandidate = z.infer<typeof shortenedCourseClassTransferCandidateSchema>;
export type ShortenedCourseClassTransferRequest = z.infer<typeof shortenedCourseClassTransferRequestSchema>;
export type ShortenedCourseClassTransferReceipt = z.infer<typeof shortenedCourseClassTransferReceiptSchema>;
