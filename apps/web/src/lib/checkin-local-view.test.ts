import { describe, expect, it } from "vitest";
import type { StartCheckinOperation, StartCheckinReceipt, StartCheckinRosterResponse } from "@o-tid/contracts";
import { checkinLocalView } from "./checkin-local-view";

const entry: StartCheckinRosterResponse["entries"][number] = {
  entryId: "entry", entryVersion: 1, classId: "class", className: "Öppen", displayName: "Prov", organisationName: null,
  startRule: "PUNCH", fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false,
  revision: 0, startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false,
  activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true
};
function row(sequence: number, action: StartCheckinOperation["action"], effect?: StartCheckinReceipt["effect"]) {
  const operation: StartCheckinOperation = { formatVersion: 1, requestId: `request-${sequence}`, deviceId: "device", actorCredentialId: "actor",
    raceId: "race", entryId: entry.entryId, dependsOnRequestId: null, localSequence: sequence, packageVersion: 1,
    expectedEntryVersion: 1, expectedRevision: sequence - 1, observedAt: "2026-09-05T10:00:00.000Z", action };
  const receipt: StartCheckinReceipt | null = effect ? { formatVersion: 1, storage: "STORED", requestId: operation.requestId,
    deviceId: "device", raceId: "race", entryId: entry.entryId, localSequence: sequence, contentHash: "hash", receivedAt: operation.observedAt, effect } : null;
  return { operation, receipt };
}
describe("local checkin projection, not result or forest logic", () => {
  it("uses explicit review knowledge without changing receipts or replaying conflicts", () => {
    const conflict = row(1, { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, { kind: "CONFLICT", revision: 9, reason: "STALE_REVISION" });
    const before = structuredClone(conflict);
    expect(checkinLocalView(entry, [conflict])).toMatchObject({ conflicts: 1, reviewedConflicts: 0 });
    expect(checkinLocalView({ ...entry, reviewedConflictRequestIds: ["request-1"] }, [conflict]))
      .toMatchObject({ conflicts: 0, reviewedConflicts: 1, state: "UNMARKED", revision: 0, dependsOnRequestId: null });
    expect(checkinLocalView({ ...entry, reviewedConflictRequestIds: ["another"] }, [conflict])).toMatchObject({ conflicts: 1 });
    expect(conflict).toEqual(before);
  });
  it("keeps unknown roster unknown with no operations and preserves manual return across local start intents", () => {
    expect(checkinLocalView(entry, [])).toMatchObject({ state: "UNMARKED", revision: 0, pending: 0, conflicts: 0 });
    const operations = [row(1, { kind: "FINISH_CORRECTION", state: "UNMARKED", manualReturnRegistered: true }),
      row(2, { kind: "MARK_START", state: "STARTED" })];
    expect(checkinLocalView(entry, operations)).toEqual({ state: "STARTED", revision: 2, manualReturnRegistered: true,
      dependsOnRequestId: "request-2", pending: 2, conflicts: 0, reviewedConflicts: 0 });
    expect(entry.startState).toBe("UNMARKED"); expect(entry.fixedStartTime).toBeNull();
  });
  it("does not replay acknowledged older intents over a newer server roster", () => {
    const operations = [row(1, { kind: "MARK_START", state: "STARTED" }, { kind: "APPLIED", revision: 1, revisionId: "revision" })];
    expect(checkinLocalView({ ...entry, revision: 2, startState: "REPORTED_NOT_STARTED" }, operations))
      .toMatchObject({ state: "REPORTED_NOT_STARTED", revision: 2, pending: 0, dependsOnRequestId: null });
    expect(checkinLocalView(entry, operations)).toMatchObject({ state: "STARTED", revision: 1, pending: 0, dependsOnRequestId: "request-1" });
  });
  it("never applies a conflict or another person's intent", () => {
    const conflict = row(1, { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, { kind: "CONFLICT", revision: 9, reason: "STALE_REVISION" });
    const other = row(2, { kind: "MARK_START", state: "STARTED" }); other.operation.entryId = "other";
    expect(checkinLocalView(entry, [conflict, other])).toMatchObject({ state: "UNMARKED", revision: 0, conflicts: 1, pending: 0 });
  });
});
