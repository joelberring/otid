import { expect, it } from "vitest";
import {
  manualCourseResultBearingRelinkCandidateSchema,
  manualCourseResultBearingRelinkIdempotencyKeySchema,
  manualCourseResultBearingRelinkRequestSchema,
  manualCourseResultBearingRelinkResponseSchema
} from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const nextId = "10000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 2, expectedBasisHash: hash,
  courseId: id, classId: id, expectedClassCourseVersionId: id, controlCodes: [31, 42, 31], acknowledgedImpact: true };

it("TASK084 validates hash-bound acknowledged manual result-bearing intent", () => {
  expect(manualCourseResultBearingRelinkRequestSchema.parse(request).controlCodes).toEqual([31, 42, 31]);
  expect(manualCourseResultBearingRelinkRequestSchema.safeParse({ ...request, acknowledgedImpact: false }).success).toBe(false);
  expect(manualCourseResultBearingRelinkRequestSchema.safeParse({ ...request, expectedBasisHash: hash.toUpperCase() }).success).toBe(false);
  expect(manualCourseResultBearingRelinkIdempotencyKeySchema.safeParse(`manual-course-result-bearing-link:${id}`).success).toBe(true);
  expect(manualCourseResultBearingRelinkIdempotencyKeySchema.safeParse(`manual-course-version-link:${id}`).success).toBe(false);
});

it("TASK084 keeps the semantic candidate PII-free and receipt-bound", () => {
  const candidate = { formatVersion: 1, raceId: id, courseId: id, classId: id, courseName: "Bana", className: "Klass", currentControlCodes: [31, 42], snapshotVersion: 2,
    classCourseVersionId: id, classCourseVersion: 1, historicalResultRevisionCount: 1, basisHash: hash,
    entries: [{ entryId: id, entryVersion: 1, latestResultRevision: { id, revision: 1, courseVersionId: id,
      snapshotVersion: 2, published: true, status: "OK", reason: "COMPLETE", cause: "INGEST" }, effectiveManualDecision: null }] };
  expect(manualCourseResultBearingRelinkCandidateSchema.safeParse(candidate).success).toBe(true);
  expect(manualCourseResultBearingRelinkCandidateSchema.safeParse({ ...candidate, entries: [{ ...candidate.entries[0], entryId: nextId }, candidate.entries[0]] }).success).toBe(false);
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, courseId: id, classId: id,
    previousCourseVersionId: id, previousCourseVersion: 1, courseVersionId: nextId, courseVersion: 2,
    sourceSnapshotVersion: 2, sourceBasisHash: hash, request, entryCount: 1, historicalResultRevisionCount: 1,
    snapshotVersionAfter: 3, changedAt: "2026-09-19T12:00:00.000Z" };
  expect(manualCourseResultBearingRelinkResponseSchema.safeParse(response).success).toBe(true);
  expect(manualCourseResultBearingRelinkResponseSchema.safeParse({ ...response, sourceBasisHash: "b".repeat(64) }).success).toBe(false);
});
