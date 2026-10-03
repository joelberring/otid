import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const controlCode = z.number().int().positive().max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const manualCourseResultBearingDecisionSchema = z.enum([
  "NONE", "DNS", "CHECKIN_DNS", "DSQ", "APPROVAL", "DNF", "OOC", "NT"
]);

const decisionProofSchema = z.object({
  kind: manualCourseResultBearingDecisionSchema.exclude(["NONE"]),
  decisionId: uuid,
  createdResultRevisionId: uuid,
  createdResultRevision: version
}).strict();

const revisionHeadSchema = z.object({
  id: uuid, revision: version, courseVersionId: uuid, snapshotVersion: version,
  published: z.boolean(), status: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(64), cause: z.string().trim().min(1).max(64)
}).strict();

const entryBasisSchema = z.object({
  entryId: uuid, entryVersion: version,
  latestResultRevision: revisionHeadSchema.nullable(),
  effectiveManualDecision: decisionProofSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.latestResultRevision === null && value.effectiveManualDecision !== null) {
    context.addIssue({ code: "custom", path: ["effectiveManualDecision"], message: "Manuellt beslut kräver resultathuvud" });
  }
});

export const manualCourseResultBearingRelinkCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, courseId: uuid, classId: uuid,
  courseName: z.string().trim().min(1).max(160), className: z.string().trim().min(1).max(160),
  snapshotVersion: version, classCourseVersionId: uuid, classCourseVersion: version,
  currentControlCodes: z.array(controlCode).min(1).max(1000),
  historicalResultRevisionCount: z.number().int().nonnegative(),
  basisHash: sha256, entries: z.array(entryBasisSchema).max(10_000)
}).strict().superRefine((value, context) => {
  const ids = value.entries.map(entry => entry.entryId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && id <= ids[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Entries måste vara unika i UUID-ordning" });
  }
  if (value.historicalResultRevisionCount < value.entries.filter(entry => entry.latestResultRevision !== null).length) {
    context.addIssue({ code: "custom", path: ["historicalResultRevisionCount"], message: "Revisionsantalet är för lågt" });
  }
});

export const manualCourseResultBearingRelinkRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version,
  expectedBasisHash: sha256, courseId: uuid, classId: uuid,
  expectedClassCourseVersionId: uuid, controlCodes: z.array(controlCode).min(1).max(1000),
  acknowledgedImpact: z.literal(true)
}).strict();

export const manualCourseResultBearingRelinkIdempotencyKeySchema = z.string().regex(
  /^manual-course-result-bearing-link:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const manualCourseResultBearingRelinkResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  courseId: uuid, classId: uuid, previousCourseVersionId: uuid, previousCourseVersion: version,
  courseVersionId: uuid, courseVersion: version, sourceSnapshotVersion: version, sourceBasisHash: sha256,
  request: manualCourseResultBearingRelinkRequestSchema,
  entryCount: z.number().int().nonnegative().max(10_000), historicalResultRevisionCount: z.number().int().nonnegative(),
  snapshotVersionAfter: version, changedAt: instant
}).strict().superRefine((value, context) => {
  if (value.sourceSnapshotVersion !== value.request.expectedSnapshotVersion ||
      value.sourceBasisHash !== value.request.expectedBasisHash ||
      value.snapshotVersionAfter !== value.sourceSnapshotVersion + 1 ||
      value.previousCourseVersionId !== value.request.expectedClassCourseVersionId ||
      value.courseVersion !== value.previousCourseVersion + 1 ||
      value.requestId !== value.request.requestId || value.courseId !== value.request.courseId || value.classId !== value.request.classId) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda granskat intent och versionsföljd" });
  }
});

export type ManualCourseResultBearingRelinkCandidate = z.infer<typeof manualCourseResultBearingRelinkCandidateSchema>;
export type ManualCourseResultBearingRelinkRequest = z.infer<typeof manualCourseResultBearingRelinkRequestSchema>;
export type ManualCourseResultBearingRelinkResponse = z.infer<typeof manualCourseResultBearingRelinkResponseSchema>;
