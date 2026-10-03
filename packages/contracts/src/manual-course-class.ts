import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const startRule = z.enum(["FIXED", "PUNCH"]);
const name = z.string().trim().min(1).max(160);
const controlCode = z.number().int().positive().max(2_147_483_647);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value =>
  Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const manualCourseClassCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version,
  courseName: name, className: name, startRule, controlCodes: z.array(controlCode).min(1).max(1000)
}).strict();
export const manualCourseClassCreateIdempotencyKeySchema = z.string().regex(
  /^manual-course-class-create:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const manualCourseClassCreateResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  courseId: uuid, courseVersionId: uuid, classId: uuid,
  request: manualCourseClassCreateRequestSchema,
  snapshotVersionBefore: version, snapshotVersionAfter: version, createdAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Snapshotversionen måste öka exakt ett steg" });
  }
  if (value.requestId !== value.request.requestId) {
    context.addIssue({ code: "custom", path: ["requestId"], message: "Kvittensen måste binda request-id" });
  }
  if (value.snapshotVersionBefore !== value.request.expectedSnapshotVersion) {
    context.addIssue({ code: "custom", path: ["snapshotVersionBefore"], message: "Kvittensen måste binda förväntad snapshotversion" });
  }
});

export type ManualCourseClassCreateRequest = z.infer<typeof manualCourseClassCreateRequestSchema>;
export type ManualCourseClassCreateResponse = z.infer<typeof manualCourseClassCreateResponseSchema>;
