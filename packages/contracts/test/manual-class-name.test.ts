import { expect, it } from "vitest";
import { manualClassNameCandidateSchema, manualClassNameChangeIdempotencyKeySchema,
  manualClassNameChangeRequestSchema, manualClassNameChangeResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 2,
  expectedClassName: " D40 ", className: "Damer 40" };

it("TASK301 keeps the previously read name exact and normalizes only the replacement", () => {
  expect(manualClassNameCandidateSchema.safeParse({ formatVersion: 1, raceId: id, classId: id,
    snapshotVersion: 2, className: " D40 ", courseVersionId: id, editable: true }).success).toBe(true);
  expect(manualClassNameChangeRequestSchema.parse({ ...request, className: " Damer 40 " })).toMatchObject({
    expectedClassName: " D40 ", className: "Damer 40" });
  for (const invalid of [{ ...request, className: "   " }, { ...request, expectedClassName: "D".repeat(161) },
    { ...request, expectedSnapshotVersion: 0 }, { ...request, extra: true }]) {
    expect(manualClassNameChangeRequestSchema.safeParse(invalid).success).toBe(false);
  }
  expect(manualClassNameChangeRequestSchema.safeParse({ ...request,
    expectedClassName: "D40", className: "D40" }).success).toBe(true);
  expect(manualClassNameChangeIdempotencyKeySchema.safeParse(`manual-class-name:${id}`).success).toBe(true);
});

it("TASK301 receipt binds the reviewed names and one snapshot step", () => {
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, classId: id,
    courseVersionId: id, previousClassName: " D40 ", className: "Damer 40", request,
    snapshotVersionBefore: 2, snapshotVersionAfter: 3, changedAt: "2026-10-03T12:00:00.000Z" };
  expect(manualClassNameChangeResponseSchema.safeParse(response).success).toBe(true);
  expect(manualClassNameChangeResponseSchema.safeParse({ ...response, previousClassName: "D40" }).success).toBe(false);
  expect(manualClassNameChangeResponseSchema.safeParse({ ...response, snapshotVersionAfter: 4 }).success).toBe(false);
  expect(manualClassNameChangeResponseSchema.safeParse({ ...response, requestId: "10000000-0000-4000-8000-000000000002" }).success).toBe(false);
});
