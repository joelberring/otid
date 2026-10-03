import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalStartCheckinOperation } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict } from "../src/stored-result-revision";
import { validateStoredStartCheckinDns, validateStoredStartCheckinDnsWithdrawal } from "../src/start-checkin-dns-source";

import { fixture, correction } from "./fixtures/start-checkin-dns";

describe("stored checkin DNS provenance", () => {
  it("validates a complete source but keeps legacy readers closed without that source", () => {
    const source = fixture();
    expect(validateStoredStartCheckinDns(source)).toEqual(source.result.evaluation);
    expect(() => parseStrictStoredResultRevision(source.result)).toThrow(StoredResultRevisionConflict);
    expect(parseStrictStoredResultRevision(source.result, source)).toEqual(source.result.evaluation);
  });

  it("does not accept a valid source as proof for a modified reader projection", () => {
    const source = fixture();
    for (const change of [{ id: randomUUID() }, { revision: 2 }, { published: false },
      { createdAt: new Date("2026-09-05T12:00:00.000Z") }, { evaluation: fixture().result.evaluation }]) {
      expect(() => parseStrictStoredResultRevision({ ...source.result, ...change }, source))
        .toThrow(StoredResultRevisionConflict);
    }
    expect(() => parseStrictStoredResultRevision(source.result, fixture())).toThrow(StoredResultRevisionConflict);
  });

  it("rejects mismatched decisions, scope, result identities and policy", () => {
    const changes: Partial<typeof schema.startCheckinDnsDecisions.$inferSelect>[] = [
      { id: randomUUID() }, { raceId: randomUUID() }, { entryId: randomUUID() }, { actorCredentialId: randomUUID() },
      { operationRequestId: randomUUID() }, { startCheckinRevisionId: randomUUID() }, { operationalRevision: 2 },
      { classId: randomUUID() }, { courseVersionId: randomUUID() }, { snapshotVersion: 2 },
      { expectedLatestResultRevision: 1 }, { createdResultRevisionId: randomUUID() }, { createdResultRevision: 2 },
      { decidedAt: new Date("2026-09-05T11:00:00.000Z") }
    ];
    for (const change of changes) {
      const source = fixture();
      expect(() => validateStoredStartCheckinDns({ ...source, decision: { ...source.decision, ...change } })).toThrow(StoredResultRevisionConflict);
    }
  });

  it("rejects injected older provenance and an unpublished or mismatched result", () => {
    for (const change of [{ readoutId: randomUUID() }, { didNotStartDecisionId: randomUUID() },
      { published: false }, { engineVersion: "wrong" }, { snapshotVersion: 2 }, { id: randomUUID() }, { revision: 2 }]) {
      const source = fixture();
      expect(() => validateStoredStartCheckinDns({ ...source, result: { ...source.result, ...change } })).toThrow(StoredResultRevisionConflict);
    }
  });

  it("rejects altered canonical intent, receipt, operational state, device role and actor", () => {
    const source = fixture();
    for (const operation of [
      { ...source.operation, contentHash: "a".repeat(64) },
      { ...source.operation, intent: { ...source.operation.intent, expectedRevision: 1 } },
      { ...source.operation, receipt: { ...source.operation.receipt, effect: { kind: "UNCHANGED", revision: 0 } } },
      { ...source.operation, deviceId: randomUUID() },
      { ...source.operation, conflictReason: "STALE_REVISION" as const }
    ]) expect(() => validateStoredStartCheckinDns({ ...source, operation })).toThrow(StoredResultRevisionConflict);
    for (const operationalRevision of [
      { ...source.operationalRevision, startState: "UNMARKED" as const },
      { ...source.operationalRevision, manualReturnRegistered: true }
    ]) expect(() => validateStoredStartCheckinDns({ ...source, operationalRevision })).toThrow(StoredResultRevisionConflict);
    for (const device of [{ ...source.device, capability: "VIEW_START_LIST" as const },
      { ...source.device, actorCredentialId: randomUUID() }, { ...source.device, capability: "FINISH_FOREST_WATCH" as const }
    ]) expect(() => validateStoredStartCheckinDns({ ...source, device })).toThrow(StoredResultRevisionConflict);
  });

  it("validates an exact later correction and rejects mismatched or non-corrective withdrawal", () => {
    const source = fixture(), c = correction(source);
    expect(validateStoredStartCheckinDnsWithdrawal(source, c)).toEqual(c.withdrawal);
    for (const change of [{ startCheckinDnsDecisionId: randomUUID() }, { withdrawnResultRevisionId: randomUUID() },
      { raceId: randomUUID() }, { entryId: randomUUID() }, { actorCredentialId: randomUUID() }, { operationalRevision: 1 }]) {
      expect(() => validateStoredStartCheckinDnsWithdrawal(source, { ...c, withdrawal: { ...c.withdrawal, ...change } })).toThrow(StoredResultRevisionConflict);
    }
    c.operationalRevision.startState = "REPORTED_NOT_STARTED";
    c.operation.intent = { ...c.operation.intent, action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } };
    c.operation.contentHash = createHash("sha256").update(canonicalStartCheckinOperation(c.operation.intent)).digest("hex");
    c.operation.receipt = { ...c.operation.receipt, contentHash: c.operation.contentHash };
    expect(() => validateStoredStartCheckinDnsWithdrawal(source, c)).toThrow(StoredResultRevisionConflict);
  });
});
