import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const revision = z.number().int().min(0).max(2_147_483_647);
const positiveRevision = revision.min(1);
const pixel = z.number().finite().min(0).max(200_000);
const point = z.object({ courseControlId: uuid, pixelX: pixel, pixelY: pixel }).strict();

export const courseControlGeometryIdempotencyKeySchema = z.string().regex(new RegExp(`^course-control-geometry:${uuidPattern}$`));
/** A complete replacement is a new immutable revision, never an in-place edit. */
export const courseControlGeometryCreateRequestSchema = z.object({
  formatVersion: z.literal(1), courseVersionId: uuid, mapManifestId: uuid, georeferenceId: uuid,
  expectedGeometryRevision: revision, points: z.array(point).min(1).max(256)
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  for (const item of value.points) {
    if (seen.has(item.courseControlId)) context.addIssue({ code: "custom", message: "Kontrollförekomst får bara ha en position" });
    seen.add(item.courseControlId);
  }
});

export const courseControlGeometryResponseSchema = z.object({
  formatVersion: z.literal(1), geometryRevisionId: uuid, requestId: uuid, raceId: uuid,
  courseVersionId: uuid, mapManifestId: uuid, georeferenceId: uuid, revision: positiveRevision,
  decidedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();

const candidateControl = z.object({ courseControlId: uuid, sequence: positiveRevision, controlCode: z.number().int().positive() }).strict();
const candidateCourse = z.object({ courseVersionId: uuid, courseName: z.string().trim().min(1).max(160), version: positiveRevision, controls: z.array(candidateControl).min(1).max(256) }).strict();
const adminGeometry = courseControlGeometryResponseSchema.omit({ requestId: true, replayed: true });
export const adminCourseControlGeometryStateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, courses: z.array(candidateCourse).max(100), geometries: z.array(adminGeometry).max(100)
}).strict();

export type CourseControlGeometryCreateRequest = z.infer<typeof courseControlGeometryCreateRequestSchema>;
export type CourseControlGeometryResponse = z.infer<typeof courseControlGeometryResponseSchema>;
export type AdminCourseControlGeometryStateResponse = z.infer<typeof adminCourseControlGeometryStateResponseSchema>;
