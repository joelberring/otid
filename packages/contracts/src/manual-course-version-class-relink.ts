import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const controlCode = z.number().int().positive().max(2_147_483_647);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value =>
  Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const manualCourseVersionClassRelinkPreviewSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, courseId: uuid, classId: uuid,
  courseName: z.string().trim().min(1).max(160), className: z.string().trim().min(1).max(160),
  snapshotVersion: version, classCourseVersionId: uuid, classCourseVersion: version,
  controlCodes: z.array(controlCode).min(1).max(1000), entryCount: z.number().int().nonnegative().max(10000),
  resultRevisionCount: z.number().int().nonnegative(), canRelink: z.boolean(), generatedAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.canRelink !== (value.resultRevisionCount === 0)) {
    context.addIssue({ code: "custom", path: ["canRelink"], message: "Omlänkning måste blockeras när resultat finns" });
  }
});

export const manualCourseVersionClassRelinkRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version,
  courseId: uuid, classId: uuid, expectedClassCourseVersionId: uuid,
  controlCodes: z.array(controlCode).min(1).max(1000)
}).strict();

export const manualCourseVersionClassRelinkIdempotencyKeySchema = z.string().regex(
  /^manual-course-version-link:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const manualCourseVersionClassRelinkResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  courseId: uuid, classId: uuid, previousCourseVersionId: uuid, previousCourseVersion: version,
  courseVersionId: uuid, courseVersion: version, request: manualCourseVersionClassRelinkRequestSchema,
  entryCount: z.number().int().nonnegative().max(10000), snapshotVersionBefore: version,
  snapshotVersionAfter: version, changedAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Snapshotversionen måste öka exakt ett steg" });
  }
  if (value.requestId !== value.request.requestId || value.courseId !== value.request.courseId ||
      value.classId !== value.request.classId || value.previousCourseVersionId !== value.request.expectedClassCourseVersionId) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda det granskade intentet" });
  }
  if (value.snapshotVersionBefore !== value.request.expectedSnapshotVersion || value.courseVersion !== value.previousCourseVersion + 1) {
    context.addIssue({ code: "custom", message: "Kvittensen har fel versionsföljd" });
  }
});

export type ManualCourseVersionClassRelinkPreview = z.infer<typeof manualCourseVersionClassRelinkPreviewSchema>;
export type ManualCourseVersionClassRelinkRequest = z.infer<typeof manualCourseVersionClassRelinkRequestSchema>;
export type ManualCourseVersionClassRelinkResponse = z.infer<typeof manualCourseVersionClassRelinkResponseSchema>;
