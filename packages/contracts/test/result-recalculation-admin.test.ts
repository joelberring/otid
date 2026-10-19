import { describe, expect, it } from "vitest";
import { resultRecalculationAdminErrorResponseSchema, resultRecalculationCandidateResponseSchema, resultRecalculationIdempotencyKeySchema, resultRecalculationRequestSchema, resultRecalculationResponseSchema } from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "b0000000-0000-4000-8000-000000000002";
const entryId = "c0000000-0000-4000-8000-000000000003";
const classId = "d0000000-0000-4000-8000-000000000004";
const assignmentId = "e0000000-0000-4000-8000-000000000005";
const readoutId = "f0000000-0000-4000-8000-000000000006";
const previousRevisionId = "a0000000-0000-4000-8000-000000000007";
const resultRevisionId = "b0000000-0000-4000-8000-000000000008";
const courseVersionId = "c0000000-0000-4000-8000-000000000009";

describe("TASK 005I resultatomräkningskontrakt", () => {

  it("validerar kandidatens readiness och minsta privata DTO", () => {
    const response = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      engineVersion: "1.0.0",
      entries: [{
        id: entryId,
        displayName: "Ada Löpare",
        organisationName: "Centrum OK",
        classId,
        className: "D21",
        entryVersion: 3,
        readiness: "READY",
        cardAssignmentId: assignmentId,
        latestReadout: { id: readoutId, readAt: "2026-08-31T17:00:00.000Z" },
        latestResultRevision: {
          id: previousRevisionId,
          revision: 2,
          status: "MP",
          reason: "MISSING_CONTROL",
          cause: "CLASS_CHANGE_RECALCULATION",
          createdAt: "2026-08-31T17:01:00.000Z",
          snapshotVersion: 7,
          current: true
        }
      }]
    } as const;
    expect(resultRecalculationCandidateResponseSchema.parse(response)).toEqual(response);
    // A restored result must remain selectable for a later explicit recalculation.
    for (const status of ["OK", "MP"] as const) {
      const restored = {
        ...response,
        entries: [{
          ...response.entries[0],
          latestResultRevision: {
            ...response.entries[0].latestResultRevision,
            cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
            status,
            reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL"
          }
        }]
      };
      expect(resultRecalculationCandidateResponseSchema.parse(restored)).toEqual(restored);
    }
    expect(resultRecalculationCandidateResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], cardNumber: "12345" }]
    }).success).toBe(false);
    expect(resultRecalculationCandidateResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], readiness: "NO_READOUT", latestReadout: null }]
    }).success).toBe(true);
    expect(resultRecalculationCandidateResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], readiness: "NO_ACTIVE_ASSIGNMENT", latestReadout: null }]
    }).success).toBe(false);
    expect(resultRecalculationCandidateResponseSchema.safeParse({
      ...response,
      entries: [{
        ...response.entries[0],
        latestResultRevision: {
          ...response.entries[0].latestResultRevision,
          status: "DNS",
          reason: "DID_NOT_START",
          cause: "MANUAL_DID_NOT_START"
        }
      }]
    }).success).toBe(true);
  });

  it("fryser hela intentet och kräver canonical idempotensnyckel", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 3,
      expectedClassId: classId,
      expectedCardAssignmentId: assignmentId,
      expectedReadoutId: readoutId,
      expectedLatestResultRevision: { id: previousRevisionId, revision: 2 },
      expectedEngineVersion: "1.0.0"
    } as const;
    expect(resultRecalculationRequestSchema.parse(request)).toEqual(request);
    expect(resultRecalculationRequestSchema.parse({ ...request, expectedLatestResultRevision: null })
      .expectedLatestResultRevision).toBeNull();
    expect(resultRecalculationRequestSchema.safeParse({ ...request, expectedEntryVersion: 0 }).success).toBe(false);
    expect(resultRecalculationRequestSchema.safeParse({ ...request, entryId }).success).toBe(false);
    expect(resultRecalculationIdempotencyKeySchema.parse(`result-recalculation:${requestId}`))
      .toBe(`result-recalculation:${requestId}`);
    expect(resultRecalculationIdempotencyKeySchema.safeParse(
      `result-recalculation:${requestId.toUpperCase()}`
    ).success).toBe(false);
  });

  it("låser det begränsade revisionssvaret", () => {
    const response = {
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      readoutId,
      resultRevisionId,
      revision: 3,
      cause: "EXPLICIT_RECALCULATION",
      status: "MP",
      reason: "MISSING_CONTROL",
      engineVersion: "1.0.0",
      snapshotVersion: 7,
      courseVersionId,
      recalculatedAt: "2026-08-31T17:02:00.000Z"
    } as const;
    expect(resultRecalculationResponseSchema.parse(response)).toEqual(response);
    expect(resultRecalculationResponseSchema.parse({ ...response, replayed: true }).replayed).toBe(true);
    expect(resultRecalculationResponseSchema.safeParse({ ...response, cause: "CLASS_CHANGE_RECALCULATION" }).success)
      .toBe(false);
    expect(resultRecalculationResponseSchema.safeParse({ ...response, status: "OK" }).success).toBe(false);
    expect(resultRecalculationResponseSchema.safeParse({ ...response, evaluation: {} }).success).toBe(false);
  });

  it("ger endast stabila detaljfria fel", () => {
    for (const error of [
      "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"
    ]) {
      expect(resultRecalculationAdminErrorResponseSchema.parse({ formatVersion: 1, error }))
        .toEqual({ formatVersion: 1, error });
    }
    expect(resultRecalculationAdminErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "CONFLICT",
      details: "Resultatet ändrades samtidigt"
    }).success).toBe(false);
  });
});
