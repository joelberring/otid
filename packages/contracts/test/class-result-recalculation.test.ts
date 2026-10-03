import { describe, expect, it } from "vitest";
import { classResultRecalculationCandidateResponseSchema, classResultRecalculationIdempotencyKeySchema, classResultRecalculationRequestSchema } from "../src/class-result-recalculation";

const raceId = "11111111-1111-4111-8111-111111111111";
const classId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";

describe("TASK091 class result recalculation contracts", () => {
  it("requires a canonical selected manifest and 1–100 unique UUID ordered entries", () => {
    const request = { formatVersion: 1, classId, snapshotVersion: 2, engineVersion: "v1", manifestHash: "a".repeat(64), entryIds: [entryId] };
    expect(classResultRecalculationRequestSchema.parse(request)).toEqual(request);
    expect(classResultRecalculationRequestSchema.safeParse({ ...request, entryIds: [] }).success).toBe(false);
    expect(classResultRecalculationRequestSchema.safeParse({ ...request, entryIds: [entryId, entryId] }).success).toBe(false);
    expect(classResultRecalculationIdempotencyKeySchema.safeParse(`class-result-recalculation:${entryId}`).success).toBe(true);
  });
  it("exposes blocked/current rows but keeps their concrete immutable basis", () => {
    const value = { formatVersion: 1, raceId, classId, className: "H21", snapshotVersion: 2, engineVersion: "v1", manifestHash: "a".repeat(64), entries: [{ id: entryId, entryVersion: 1, displayName: "Anna Andersson", readiness: "CURRENT", cardAssignmentId: entryId, readoutId: entryId, latestResultRevision: { id: entryId, revision: 1, snapshotVersion: 2 } }] };
    expect(classResultRecalculationCandidateResponseSchema.parse(value)).toEqual(value);
  });
});
