import { describe, expect, it } from "vitest";
import {
  canonicalStartCheckinOperation,
  StartCheckinOperationSchema,
  StartCheckinReceiptSchema,
  StartCheckinSyncRequestSchema
} from "../src";

const ids = {
  request: "10000000-0000-4000-8000-000000000001",
  device: "10000000-0000-4000-8000-000000000002",
  credential: "10000000-0000-4000-8000-000000000003",
  race: "10000000-0000-4000-8000-000000000004",
  entry: "10000000-0000-4000-8000-000000000005",
  revision: "10000000-0000-4000-8000-000000000006"
};

function operation() {
  return {
    formatVersion: 1,
    requestId: ids.request,
    dependsOnRequestId: null,
    deviceId: ids.device,
    actorCredentialId: ids.credential,
    raceId: ids.race,
    entryId: ids.entry,
    localSequence: 1,
    packageVersion: 1,
    expectedEntryVersion: 1,
    expectedRevision: 0,
    observedAt: "2026-09-05T10:11:12.123Z",
    action: { kind: "MARK_START", state: "STARTED" }
  };
}

function receipt() {
  return {
    formatVersion: 1,
    storage: "STORED",
    requestId: ids.request,
    deviceId: ids.device,
    raceId: ids.race,
    entryId: ids.entry,
    localSequence: 1,
    contentHash: "a".repeat(64),
    receivedAt: "2026-09-05T10:11:13.456Z",
    effect: { kind: "APPLIED", revisionId: ids.revision, revision: 1 }
  };
}

describe("TASK 006W mobil avprickningskontrakt", () => {
  it("accepterar en fryst operation och ett strikt hashkuvert", () => {
    const value = operation();
    expect(StartCheckinOperationSchema.parse(value)).toEqual(value);
    expect(StartCheckinSyncRequestSchema.parse({ operation: value, contentHash: "a".repeat(64) })).toEqual({
      operation: value,
      contentHash: "a".repeat(64)
    });
  });

  it("avvisar felaktiga runtimevärden, räknare, identiteter och tid", () => {
    for (const invalid of [
      { localSequence: 0 },
      { localSequence: 2_147_483_648 },
      { packageVersion: 1.5 },
      { expectedEntryVersion: 0 },
      { expectedRevision: -1 },
      { expectedRevision: 2_147_483_648 },
      { requestId: "A0000000-0000-4000-8000-000000000001" },
      { observedAt: "2026-09-05T10:11:12Z" },
      { observedAt: "2026-09-05T10:11:12.123+00:00" },
      { observedAt: "2026-02-30T10:11:12.123Z" },
      { observedAt: "0000-01-01T00:00:00.000Z" },
      { observedAt: "10000-01-01T00:00:00.000Z" },
      { extra: true }
    ]) {
      expect(StartCheckinOperationSchema.safeParse({ ...operation(), ...invalid }).success).toBe(false);
    }
    expect(StartCheckinSyncRequestSchema.safeParse({ operation: operation(), contentHash: "A".repeat(64) }).success).toBe(false);
    expect(StartCheckinSyncRequestSchema.safeParse({ operation: operation(), contentHash: "a".repeat(64), extra: true }).success).toBe(false);
  });

  it("håller action-varianternas nycklar strikt åtskilda", () => {
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(),
      action: { kind: "MARK_START", state: "STARTED", manualReturnRegistered: true }
    }).success).toBe(false);
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(),
      action: { kind: "FINISH_CORRECTION", state: "REPORTED_NOT_STARTED", manualReturnRegistered: false }
    }).success).toBe(true);
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(), action: { kind: "FINISH_CORRECTION", state: "STARTED" }
    }).success).toBe(false);
  });

  it("kräver ett explicit beroende och förbjuder självberoende", () => {
    const { dependsOnRequestId, ...withoutDependency } = operation();
    expect(dependsOnRequestId).toBeNull();
    expect(StartCheckinOperationSchema.safeParse(withoutDependency).success).toBe(false);
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(), dependsOnRequestId: ids.request
    }).success).toBe(false);
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(), dependsOnRequestId: ids.revision
    }).success).toBe(true);
  });

  it("serialiserar validerade operationer canonicalt utan att hasha", () => {
    const first = operation();
    const second = {
      action: first.action,
      observedAt: first.observedAt,
      expectedRevision: first.expectedRevision,
      expectedEntryVersion: first.expectedEntryVersion,
      packageVersion: first.packageVersion,
      localSequence: first.localSequence,
      entryId: first.entryId,
      raceId: first.raceId,
      actorCredentialId: first.actorCredentialId,
      deviceId: first.deviceId,
      dependsOnRequestId: first.dependsOnRequestId,
      requestId: first.requestId,
      formatVersion: first.formatVersion
    };
    const canonical = new TextDecoder().decode(canonicalStartCheckinOperation(first));
    expect(canonicalStartCheckinOperation(second)).toEqual(canonicalStartCheckinOperation(first));
    expect(canonical).toBe('{"action":{"kind":"MARK_START","state":"STARTED"},"actorCredentialId":"10000000-0000-4000-8000-000000000003","dependsOnRequestId":null,"deviceId":"10000000-0000-4000-8000-000000000002","entryId":"10000000-0000-4000-8000-000000000005","expectedEntryVersion":1,"expectedRevision":0,"formatVersion":1,"localSequence":1,"observedAt":"2026-09-05T10:11:12.123Z","packageVersion":1,"raceId":"10000000-0000-4000-8000-000000000004","requestId":"10000000-0000-4000-8000-000000000001"}');
    expect(() => canonicalStartCheckinOperation({ ...first, localSequence: 0 })).toThrow();
  });

  it("kräver en durabel kvittens med konsistent effekttyp", () => {
    expect(StartCheckinReceiptSchema.parse(receipt())).toEqual(receipt());
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(), observedAt: "0001-01-01T00:00:00.000Z"
    }).success).toBe(true);
    expect(StartCheckinOperationSchema.safeParse({
      ...operation(), observedAt: "9999-12-31T23:59:59.999Z"
    }).success).toBe(true);
    expect(StartCheckinReceiptSchema.safeParse({ ...receipt(), receivedAt: "2026-09-05T10:11:13Z" }).success).toBe(false);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), receivedAt: "0000-01-01T00:00:00.000Z"
    }).success).toBe(false);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), receivedAt: "0001-01-01T00:00:00.000Z"
    }).success).toBe(true);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), receivedAt: "9999-12-31T23:59:59.999Z"
    }).success).toBe(true);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "APPLIED", revision: 1 }
    }).success).toBe(false);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "APPLIED", revisionId: ids.revision, revision: 0 }
    }).success).toBe(false);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "UNCHANGED", revision: 0, revisionId: ids.revision }
    }).success).toBe(false);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "CONFLICT", revision: 0, reason: "STALE_ENTRY" }
    }).success).toBe(true);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "CONFLICT", revision: 0, reason: "DEPENDENCY_CONFLICT" }
    }).success).toBe(true);
    expect(StartCheckinReceiptSchema.safeParse({
      ...receipt(), effect: { kind: "CONFLICT", revision: 0, reason: "OTHER" }
    }).success).toBe(false);
  });
});
