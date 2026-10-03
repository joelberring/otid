import { expect, it } from "vitest";
import { manualCourseVersionClassRelinkIdempotencyKeySchema, manualCourseVersionClassRelinkPreviewSchema,
  manualCourseVersionClassRelinkRequestSchema, manualCourseVersionClassRelinkResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 2, courseId: id, classId: id,
  expectedClassCourseVersionId: id, controlCodes: [31, 42, 31] };

it("TASK082 validates a bounded append-only relink intent", () => {
  expect(manualCourseVersionClassRelinkRequestSchema.parse(request).controlCodes).toEqual([31, 42, 31]);
  for (const controlCodes of [[], [0], [1.5], Array.from({ length: 1001 }, () => 31)]) {
    expect(manualCourseVersionClassRelinkRequestSchema.safeParse({ ...request, controlCodes }).success).toBe(false);
  }
  expect(manualCourseVersionClassRelinkRequestSchema.safeParse({ ...request, ignored: true }).success).toBe(false);
  expect(manualCourseVersionClassRelinkIdempotencyKeySchema.safeParse(`manual-course-version-link:${id}`).success).toBe(true);
  expect(manualCourseVersionClassRelinkIdempotencyKeySchema.safeParse(`manual-course-class-create:${id}`).success).toBe(false);
});

it("TASK082 freezes preview and receipt semantics", () => {
  const preview = { formatVersion: 1, raceId: id, courseId: id, classId: id, courseName: "Bana", className: "Klass",
    snapshotVersion: 2, classCourseVersionId: id, classCourseVersion: 1, controlCodes: [31, 42], entryCount: 2,
    resultRevisionCount: 0, canRelink: true, generatedAt: "2026-09-19T12:00:00.000Z" };
  expect(manualCourseVersionClassRelinkPreviewSchema.safeParse(preview).success).toBe(true);
  expect(manualCourseVersionClassRelinkPreviewSchema.safeParse({ ...preview, resultRevisionCount: 1 }).success).toBe(false);
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, courseId: id, classId: id,
    previousCourseVersionId: id, previousCourseVersion: 1, courseVersionId: "10000000-0000-4000-8000-000000000002", courseVersion: 2,
    request, entryCount: 2, snapshotVersionBefore: 2, snapshotVersionAfter: 3, changedAt: "2026-09-19T12:00:00.000Z" };
  expect(manualCourseVersionClassRelinkResponseSchema.safeParse(response).success).toBe(true);
  expect(manualCourseVersionClassRelinkResponseSchema.safeParse({ ...response, courseVersion: 3 }).success).toBe(false);
  expect(manualCourseVersionClassRelinkResponseSchema.safeParse({ ...response, snapshotVersionAfter: 4 }).success).toBe(false);
});
