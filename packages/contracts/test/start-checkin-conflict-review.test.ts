import { describe, expect, it } from "vitest";
import { canonicalStartCheckinConflictReviewRequest, canonicalStartCheckinConflictReviewSource,
  StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema,
  StartCheckinConflictReviewSourceSchema, StartCheckinConflictReviewCandidateSchema } from "../src/start-checkin-conflict-review";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const hash = "a".repeat(64), at = "2026-09-05T10:00:00.000Z";
const request = { formatVersion: 1, requestId: id(1), entryId: id(2), sourceHash: hash,
  conflictRequestIds: [id(3)], decision: "KEEP_CURRENT_STATE", reason: "Uppgiften kontrollerad vid mål" };
const operation = { formatVersion: 1, requestId: id(3), raceId: id(4), entryId: id(2), deviceId: id(5), actorCredentialId: id(6),
  localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, dependsOnRequestId: null,
  observedAt: at, action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } };
const receipt = { formatVersion: 1, storage: "STORED", requestId: id(3), raceId: id(4), entryId: id(2), deviceId: id(5),
  localSequence: 1, contentHash: hash, receivedAt: at, effect: { kind: "CONFLICT", revision: 1, reason: "STALE_REVISION" } };
const source = { formatVersion: 1, raceId: id(4), entryId: id(2), displayName: "Test Person", className: "Fri klass", organisationName: null,
  snapshotVersion: 1, entryVersion: 1, revision: 1, resultRevision: 0, startState: "STARTED", manualReturnRegistered: true,
  readoutReturnRegistered: false, activeDns: false, conflicts: [{ operation, receipt, contentHash: hash, deviceLabel: "Startmobil" }] };

describe("explicit checkin conflict review contracts", () => {
  it("freezes canonical request and source regardless of object key order", () => {
    expect(canonicalStartCheckinConflictReviewRequest(request)).toEqual(canonicalStartCheckinConflictReviewRequest(Object.fromEntries(Object.entries(request).reverse())));
    expect(canonicalStartCheckinConflictReviewSource(source)).toEqual(canonicalStartCheckinConflictReviewSource(Object.fromEntries(Object.entries(source).reverse())));
    expect(StartCheckinConflictReviewCandidateSchema.parse({ formatVersion: 1, sourceHash: hash, generatedAt: at, source }).source).toEqual(source);
  });
  it("requires exact sorted unique bounded ids and an explicit nonblank reason", () => {
    for (const conflictRequestIds of [[], [id(3), id(3)], [id(7), id(3)], Array.from({ length: 1001 }, (_, n) => id(n + 3))]) {
      expect(StartCheckinConflictReviewRequestSchema.safeParse({ ...request, conflictRequestIds }).success).toBe(false);
    }
    for (const reason of ["", " ", " x", "x ", "x".repeat(501)]) expect(StartCheckinConflictReviewRequestSchema.safeParse({ ...request, reason }).success).toBe(false);
    expect(StartCheckinConflictReviewRequestSchema.safeParse({ ...request, decision: "APPLY_REPORT" }).success).toBe(false);
    expect(StartCheckinConflictReviewRequestSchema.safeParse({ ...request, hidden: true }).success).toBe(false);
  });
  it("binds original operation and conflict receipt without accepting an applied receipt", () => {
    for (const changed of [{ ...receipt, requestId: id(9) }, { ...receipt, contentHash: "b".repeat(64) },
      { ...receipt, effect: { kind: "APPLIED", revision: 1, revisionId: id(8) } }]) {
      expect(StartCheckinConflictReviewSourceSchema.safeParse({ ...source, conflicts: [{ ...source.conflicts[0], receipt: changed }] }).success).toBe(false);
    }
    expect(StartCheckinConflictReviewSourceSchema.safeParse({ ...source, entryId: id(9) }).success).toBe(false);
    expect(StartCheckinConflictReviewSourceSchema.safeParse({ ...source, conflicts: [...source.conflicts, ...source.conflicts] }).success).toBe(false);
  });
  it("does not infer a cleared state from empty conflicts or permit impossible revision zero", () => {
    expect(StartCheckinConflictReviewSourceSchema.parse({ ...source, conflicts: [] }).startState).toBe("STARTED");
    expect(StartCheckinConflictReviewSourceSchema.safeParse({ ...source, revision: 0 }).success).toBe(false);
    expect(StartCheckinConflictReviewSourceSchema.safeParse({ ...source, generatedAt: at }).success).toBe(false);
  });
  it("validates a durable review response without pretending it is an operation receipt", () => {
    const response = { formatVersion: 1, reviewId: id(8), requestId: id(1), raceId: id(4), entryId: id(2),
      sourceHash: hash, conflictRequestIds: [id(3)], decision: "KEEP_CURRENT_STATE", reviewedAt: at };
    expect(StartCheckinConflictReviewResponseSchema.parse(response)).toEqual(response);
    expect(StartCheckinConflictReviewResponseSchema.safeParse({ ...response, reviewedAt: "2026-02-30T10:00:00.000Z" }).success).toBe(false);
    expect(StartCheckinConflictReviewResponseSchema.safeParse({ ...response, sourceHash: hash.toUpperCase() }).success).toBe(false);
    expect(StartCheckinConflictReviewResponseSchema.safeParse({ ...response, storage: "STORED" }).success).toBe(false);
  });
});
