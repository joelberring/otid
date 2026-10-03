import { describe, expect, it } from "vitest";
import {
  WITHOUT_TIMING_DECISION_POLICY_VERSION,
  withoutTimingCandidateResponseSchema,
  withoutTimingIdempotencyKeySchema,
  withoutTimingRequestSchema,
  withoutTimingResponseSchema
} from "../src";

const ids = {
  race: "10000000-0000-4000-8000-000000000001", entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003", course: "40000000-0000-4000-8000-000000000004",
  target: "50000000-0000-4000-8000-000000000005", request: "60000000-0000-4000-8000-000000000006",
  decision: "70000000-0000-4000-8000-000000000007", result: "80000000-0000-4000-8000-000000000008"
};
const target = { id: ids.target, revision: 3, status: "OK" as const, reason: "COMPLETE" as const,
  cause: "CARD_READOUT" as const, createdAt: "2026-09-01T10:00:00.000Z", snapshotVersion: 7 };

describe("withoutTimingAdmin", () => {
  it("erbjuder endast aktuellt strikt direkt tekniskt OK/COMPLETE som target", () => {
    const base = { formatVersion: 1, raceId: ids.race, snapshotVersion: 7,
      policyVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION, entries: [{ id: ids.entry, displayName: "Ada", organisationName: null,
        classId: ids.class, className: "D21", courseVersionId: ids.course, entryVersion: 2,
        readiness: "READY" as const, targetResultRevision: target }] };
    expect(withoutTimingCandidateResponseSchema.safeParse(base).success).toBe(true);
    expect(withoutTimingCandidateResponseSchema.safeParse({ ...base, entries: [{ ...base.entries[0], targetResultRevision: { ...target, status: "MP" } }] }).success).toBe(false);
    expect(withoutTimingCandidateResponseSchema.safeParse({ ...base, entries: [{ ...base.entries[0], targetResultRevision: { ...target, reason: "MISSING_CONTROL" } }] }).success).toBe(false);
    expect(withoutTimingCandidateResponseSchema.safeParse({ ...base, entries: [{ ...base.entries[0], readiness: "ACTIVE_WITHOUT_TIMING", targetResultRevision: null }] }).success).toBe(true);
  });

  it("låser intent och returnerar endast NT-status utan tekniska resultatfält", () => {
    const request = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: ids.class,
      expectedCourseVersionId: ids.course, expectedSnapshotVersion: 7,
      expectedResultRevision: { id: ids.target, revision: 3, status: "OK" as const, reason: "COMPLETE" as const }, policyVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION };
    expect(withoutTimingRequestSchema.safeParse(request).success).toBe(true);
    expect(withoutTimingRequestSchema.safeParse({ ...request, expectedResultRevision: { ...request.expectedResultRevision, status: "MP" } }).success).toBe(false);
    expect(withoutTimingRequestSchema.safeParse({ ...request, expectedResultRevision: { ...request.expectedResultRevision, reason: "MISSING_CONTROL" } }).success).toBe(false);
    expect(withoutTimingIdempotencyKeySchema.safeParse(`without-timing:${ids.request}`).success).toBe(true);
    const response = { formatVersion: 1, replayed: false, requestId: ids.request, raceId: ids.race, entryId: ids.entry,
      withoutTimingDecisionId: ids.decision, targetResultRevisionId: ids.target, targetResultRevision: 3,
      resultRevisionId: ids.result, revision: 4, cause: "MANUAL_WITHOUT_TIMING" as const, status: "NT" as const,
      reason: "WITHOUT_TIMING" as const, policyVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION, snapshotVersion: 7,
      courseVersionId: ids.course, decidedAt: "2026-09-01T10:01:00.000Z" };
    expect(withoutTimingResponseSchema.safeParse(response).success).toBe(true);
    expect(withoutTimingResponseSchema.safeParse({ ...response, revision: 5 }).success).toBe(false);
    expect(withoutTimingResponseSchema.safeParse({ ...response, elapsedMs: 60_000 }).success).toBe(false);
  });
});
