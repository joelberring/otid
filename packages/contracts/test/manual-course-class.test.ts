import { expect, it } from "vitest";
import { manualCourseClassCreateIdempotencyKeySchema, manualCourseClassCreateRequestSchema, manualCourseClassCreateResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 1, courseName: " Bana ",
  className: " Klass ", startRule: "PUNCH", controlCodes: [31, 42, 31] };

it("TASK081 preserves ordered duplicate controls and validates the bounded manual intent", () => {
  expect(manualCourseClassCreateRequestSchema.parse(request)).toMatchObject({ courseName: "Bana", className: "Klass", controlCodes: [31, 42, 31] });
  for (const controlCodes of [[], [0], [-1], [1.5], Array.from({ length: 1001 }, () => 1)]) {
    expect(manualCourseClassCreateRequestSchema.safeParse({ ...request, controlCodes }).success).toBe(false);
  }
  expect(manualCourseClassCreateRequestSchema.safeParse({ ...request, ignored: true }).success).toBe(false);
  expect(manualCourseClassCreateIdempotencyKeySchema.safeParse(`manual-course-class-create:${id}`).success).toBe(true);
  expect(manualCourseClassCreateIdempotencyKeySchema.safeParse(`course-class:${id}`).success).toBe(false);
});

it("TASK081 receipt freezes the intent and exactly one snapshot step", () => {
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, courseId: id,
    courseVersionId: id, classId: id, request: { ...request, courseName: "Bana", className: "Klass" },
    snapshotVersionBefore: 1, snapshotVersionAfter: 2, createdAt: "2026-09-19T12:00:00.000Z" };
  expect(manualCourseClassCreateResponseSchema.safeParse(response).success).toBe(true);
  expect(manualCourseClassCreateResponseSchema.safeParse({ ...response, snapshotVersionAfter: 3 }).success).toBe(false);
  expect(manualCourseClassCreateResponseSchema.safeParse({ ...response, requestId: "10000000-0000-4000-8000-000000000002" }).success).toBe(false);
  expect(manualCourseClassCreateResponseSchema.safeParse({ ...response, snapshotVersionBefore: 2, snapshotVersionAfter: 3 }).success).toBe(false);
});
