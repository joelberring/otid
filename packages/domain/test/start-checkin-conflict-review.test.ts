import { describe, expect, it } from "vitest";
import { planStartCheckinConflictReview, type StartCheckinConflictReviewFacts } from "../src/start-checkin-conflict-review";

const raceId = "00000000-0000-4000-8000-000000000001", entryId = "00000000-0000-4000-8000-000000000002";
const first = "00000000-0000-4000-8000-000000000003", second = "00000000-0000-4000-8000-000000000004";
function facts(): StartCheckinConflictReviewFacts {
  return { raceId, entryId, expectedSourceHash: "a".repeat(64), sourceHash: "a".repeat(64),
    expectedConflictRequestIds: [first], conflictRequestIds: [first],
    current: { raceId, entryId, startState: "STARTED", returnRegistered: false, activeDns: false } };
}

describe("explicit conflict review planning", () => {
  it.each([
    ["STARTED", false, false, "STARTED_NO_RETURN", true],
    ["UNMARKED", false, false, "UNCONFIRMED", true],
    ["STARTED", true, false, "RETURNED", false],
    ["REPORTED_NOT_STARTED", false, true, "NOT_STARTED", false]
  ] as const)("keeps %s / return %s / DNS %s without inventing facts", (startState, returnRegistered, activeDns, state, needsFollowUp) => {
    const base = facts(), input = { ...base, current: { ...base.current, startState, returnRegistered, activeDns } };
    const before = JSON.stringify(input);
    expect(planStartCheckinConflictReview(input)).toEqual({ kind: "REVIEW", decision: "KEEP_CURRENT_STATE",
      conflictRequestIds: [first], remainingForestState: state, needsFollowUp });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    ["REPORTED_NOT_STARTED", true, false], ["UNMARKED", true, true], ["STARTED", false, true]
  ] as const)("does not hide a current contradiction: %s / %s / %s", (startState, returnRegistered, activeDns) => {
    const base = facts();
    expect(planStartCheckinConflictReview({ ...base, current: { ...base.current, startState, returnRegistered, activeDns } }))
      .toEqual({ kind: "CONFLICT", reason: "CONTRADICTORY_CURRENT_STATE" });
  });

  it("rejects changed source or exact set and treats already-reviewed reports separately", () => {
    expect(planStartCheckinConflictReview({ ...facts(), sourceHash: "b".repeat(64) })).toEqual({ kind: "CONFLICT", reason: "BASIS_CHANGED" });
    expect(planStartCheckinConflictReview({ ...facts(), conflictRequestIds: [first, second] })).toEqual({ kind: "CONFLICT", reason: "BASIS_CHANGED" });
    expect(planStartCheckinConflictReview({ ...facts(), conflictRequestIds: [second] })).toEqual({ kind: "CONFLICT", reason: "BASIS_CHANGED" });
    expect(planStartCheckinConflictReview({ ...facts(), conflictRequestIds: [] })).toEqual({ kind: "CONFLICT", reason: "NO_PENDING_CONFLICTS" });
  });

  it("rejects ambiguous, oversized and cross-scope facts instead of truncating", () => {
    for (const conflictRequestIds of [[first, first], [second, first], ["invalid"], Array.from({ length: 1001 }, () => first)]) {
      expect(() => planStartCheckinConflictReview({ ...facts(), conflictRequestIds })).toThrow();
    }
    const base = facts();
    expect(() => planStartCheckinConflictReview({ ...base, current: { ...base.current, entryId: first } })).toThrow();
    expect(() => planStartCheckinConflictReview({ ...base, expectedConflictRequestIds: [] })).toThrow();
    expect(() => planStartCheckinConflictReview({ ...base, sourceHash: "A".repeat(64) })).toThrow();
  });
});
