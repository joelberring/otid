import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classControlNeutralizationCandidateSchema,
  classControlNeutralizationIdempotencyKeySchema,
  classControlNeutralizationRequestSchema,
  classControlNeutralizationResponseSchema
} from "../src";

const raceId = randomUUID(), classId = randomUUID(), versionId = randomUUID(), controlId = randomUUID(), requestId = randomUUID();
const hash = "a".repeat(64);
const request = { formatVersion: 1 as const, requestId, expectedSnapshotVersion: 2, expectedBasisHash: hash,
  classId, expectedCourseVersionId: versionId, courseControlId: controlId, sequence: 1, controlCode: 31,
  acknowledgedNoAutomaticRecalculation: true as const };

describe("class-control-neutralization contracts", () => {
  it("binds response and exact idempotency key to a single control occurrence", () => {
    expect(classControlNeutralizationRequestSchema.parse(request)).toEqual(request);
    expect(classControlNeutralizationIdempotencyKeySchema.safeParse(`class-control-neutralization:${requestId}`).success).toBe(true);
    expect(classControlNeutralizationIdempotencyKeySchema.safeParse(`class-control-neutralization:${randomUUID()}`).success).toBe(true);
    expect(classControlNeutralizationResponseSchema.safeParse({ formatVersion: 1, replayed: false, requestId,
      neutralizationId: requestId, raceId, classId, courseVersionId: versionId, courseControlId: controlId,
      sequence: 1, controlCode: 31, sourceSnapshotVersion: 2, sourceBasisHash: hash, snapshotVersionAfter: 3,
      request, historicalResultRevisionCount: 4, neutralizedAt: "2026-09-19T15:00:00.000Z" }).success).toBe(true);
  });

  it("rejects a mismatched course occurrence and unordered candidate controls", () => {
    expect(classControlNeutralizationResponseSchema.safeParse({ formatVersion: 1, replayed: false, requestId,
      neutralizationId: requestId, raceId, classId, courseVersionId: versionId, courseControlId: controlId,
      sequence: 2, controlCode: 31, sourceSnapshotVersion: 2, sourceBasisHash: hash, snapshotVersionAfter: 3,
      request, historicalResultRevisionCount: 0, neutralizedAt: "2026-09-19T15:00:00.000Z" }).success).toBe(false);
    expect(classControlNeutralizationCandidateSchema.safeParse({ formatVersion: 1, raceId, classId, className: "Öppen",
      courseVersionId: versionId, courseVersion: 1, snapshotVersion: 2, basisHash: hash,
      controls: [{ id: controlId, sequence: 2, controlCode: 31 }], historicalResultRevisionCount: 0,
      generatedAt: "2026-09-19T15:00:00.000Z" }).success).toBe(false);
  });
});
