import { expect, it } from "vitest";
import { manualClassCreateIdempotencyKeySchema, manualClassCreateRequestSchema, manualClassCreateResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 2,
  courseVersionId: id, className: " Ny klass ", startRule: "FIXED" };

it("TASK300 validates one exact existing course target and explicit start rule", () => {
  expect(manualClassCreateRequestSchema.parse(request)).toMatchObject({ className: "Ny klass", courseVersionId: id, startRule: "FIXED" });
  for (const invalid of [{ ...request, courseVersionId: "latest" }, { ...request, startRule: "AUTO" },
    { ...request, className: " " }, { ...request, expectedSnapshotVersion: 0 }, { ...request, ignored: true }]) {
    expect(manualClassCreateRequestSchema.safeParse(invalid).success).toBe(false);
  }
  expect(manualClassCreateIdempotencyKeySchema.safeParse(`manual-class-create:${id}`).success).toBe(true);
  expect(manualClassCreateIdempotencyKeySchema.safeParse(`manual-course-class-create:${id}`).success).toBe(false);
});

it("TASK300 receipt freezes the target and one snapshot step", () => {
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id,
    courseId: id, courseVersionId: id, courseName: "Bana", courseVersion: 1, classId: id,
    request: { ...request, className: "Ny klass" }, snapshotVersionBefore: 2,
    snapshotVersionAfter: 3, createdAt: "2026-10-03T12:00:00.000Z" };
  expect(manualClassCreateResponseSchema.safeParse(response).success).toBe(true);
  expect(manualClassCreateResponseSchema.safeParse({ ...response, courseVersionId: "10000000-0000-4000-8000-000000000002" }).success).toBe(false);
  expect(manualClassCreateResponseSchema.safeParse({ ...response, snapshotVersionAfter: 4 }).success).toBe(false);
  expect(manualClassCreateResponseSchema.safeParse({ ...response, requestId: "10000000-0000-4000-8000-000000000002" }).success).toBe(false);
});
