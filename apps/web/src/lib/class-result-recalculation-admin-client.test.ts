import { describe, expect, it } from "vitest";
import { createClassResultRecalculationAttempt, parseClassResultRecalculationCandidates } from "./class-result-recalculation-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const entryId = "10000000-0000-4000-8000-000000000003";
const candidate = { formatVersion: 1 as const, raceId, classId, className: "D21", snapshotVersion: 2,
  engineVersion: "v1", manifestHash: "a".repeat(64), entries: [{ id: entryId, entryVersion: 1,
    displayName: "Ada Test", readiness: "READY" as const, cardAssignmentId: classId, readoutId: raceId,
    latestResultRevision: { id: raceId, revision: 1, snapshotVersion: 1 } }] };

describe("TASK091 klassomräkningens webbkontrakt", () => {
  it("sorterar urvalet och fryser manifestet i försöket", () => {
    const value = createClassResultRecalculationAttempt(candidate, [entryId], { randomUUID: () => raceId } as Crypto);
    expect(value.requestId).toBe(raceId);
    expect(value.request.entryIds).toEqual([entryId]);
    expect(value.request.manifestHash).toBe(candidate.manifestHash);
  });

  it("avvisar kandidat från annat lopp", () => {
    expect(() => parseClassResultRecalculationCandidates(candidate, "10000000-0000-4000-8000-000000000004")).toThrow();
  });
});
