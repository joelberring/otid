import { z } from "zod";
import { courseEditChangeSchema } from "./course-edit";

/**
 * Redigera klass (ADR-0169 beslut 4): klassnamn, bana och startsätt ändras i
 * klasstabellens rad. Avlästa löpare räknas om när ändringen sparas.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const name = z.string().trim().min(1).max(160);
const startRule = z.enum(["PUNCH", "FIXED"]);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const classEditPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), expectedSnapshotVersion: version, courseId: uuid, startRule
}).strict();

export const classEditPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, className: name, snapshotVersion: version,
  courseId: uuid, courseName: name, startRule, readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count,
  unchangedCount: count, notRecalculatedCount: count, clearedStartTimeCount: count,
  changes: z.array(courseEditChangeSchema).max(10_000), requiresConfirmation: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.becomesOkCount + value.becomesMispunchedCount + value.unchangedCount + value.notRecalculatedCount !== value.readOutCount ||
      value.changes.length !== value.becomesOkCount + value.becomesMispunchedCount ||
      value.requiresConfirmation !== value.changes.length > 0) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const classEditRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, classId: uuid,
  className: name, courseId: uuid, startRule, confirmResultChanges: z.boolean()
}).strict();

export const classEditIdempotencyKeySchema = z.string().regex(
  /^class-edit:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const classEditResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  request: classEditRequestSchema, previousClassName: name, previousCourseVersionId: uuid, courseVersionId: uuid,
  previousStartRule: startRule, clearedStartTimeCount: count, snapshotVersionBefore: version, snapshotVersionAfter: version,
  recalculated: z.array(z.object({ entryId: uuid, resultRevisionId: uuid, revision: version }).strict()).max(10_000),
  editedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.classId !== value.request.classId || value.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
      (value.previousClassName === value.request.className && value.previousCourseVersionId === value.courseVersionId &&
        value.previousStartRule === value.request.startRule)) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran, en ändring och ett steg i versionsföljden" });
  }
});

export type ClassEditPreviewRequest = z.infer<typeof classEditPreviewRequestSchema>;
export type ClassEditPreviewResponse = z.infer<typeof classEditPreviewResponseSchema>;
export type ClassEditRequest = z.infer<typeof classEditRequestSchema>;
export type ClassEditResponse = z.infer<typeof classEditResponseSchema>;
