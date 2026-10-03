import { describe, expect, it } from "vitest";
import {
  canonicalStartCheckinRecoveryManifest,
  StartCheckinRecoveryManifestSchema,
  StartCheckinRecoveryTokenSchema
} from "../src/start-checkin-recovery";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  device: "10000000-0000-4000-8000-000000000002",
  credential: "10000000-0000-4000-8000-000000000003",
  request1: "10000000-0000-4000-8000-000000000004",
  request2: "10000000-0000-4000-8000-000000000005"
};

function manifest() {
  return {
    formatVersion: 1,
    kind: "OTID_CHECKIN_RECOVERY_MANIFEST" as const,
    raceId: ids.race,
    deviceId: ids.device,
    actorCredentialId: ids.credential,
    capability: "START_CHECKIN" as const,
    firstSequence: 41,
    lastSequence: 42,
    items: [
      { requestId: ids.request1, localSequence: 41, contentHash: "a".repeat(64) },
      { requestId: ids.request2, localSequence: 42, contentHash: "b".repeat(64) }
    ]
  };
}

describe("TASK 006W avgränsat återhämtningsmanifest för avprickning", () => {
  it("validerar den exakta frysta manifestformen och tokenformatet", () => {
    expect(StartCheckinRecoveryManifestSchema.parse(manifest())).toEqual(manifest());
    expect(StartCheckinRecoveryManifestSchema.parse({ ...manifest(), capability: "FINISH_FOREST_WATCH" }).capability)
      .toBe("FINISH_FOREST_WATCH");
    const token = `otid_checkin_recovery_v1.${ids.credential}.${"A".repeat(43)}`;
    expect(StartCheckinRecoveryTokenSchema.parse(token)).toBe(token);
  });

  it("avvisar okända och tomma fria data på alla nivåer", () => {
    const value = manifest();
    for (const invalid of [
      { ...value, note: "inte tillåtet" },
      { ...value, items: [] },
      { ...value, items: [{ ...value.items[0]!, credential: "inte tillåtet" }, value.items[1]! ] }
    ]) {
      expect(StartCheckinRecoveryManifestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("begränsar listan och PostgreSQL-räknarna", () => {
    const value = manifest();
    expect(StartCheckinRecoveryManifestSchema.safeParse({
      ...value,
      firstSequence: 1,
      lastSequence: 20_000,
      items: Array.from({ length: 20_001 }, (_, index) => ({
        requestId: `${(index + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
        localSequence: index + 1,
        contentHash: "a".repeat(64)
      }))
    }).success).toBe(false);
    for (const invalid of [
      { firstSequence: 0 },
      { lastSequence: 2_147_483_648 },
      { items: [{ ...value.items[0]!, localSequence: 2_147_483_648 }, value.items[1]! ] }
    ]) {
      expect(StartCheckinRecoveryManifestSchema.safeParse({ ...value, ...invalid }).success).toBe(false);
    }
  });

  it("avvisar luckor, ordningsfel, intervallfel och dubbla request-id", () => {
    const value = manifest();
    for (const invalid of [
      { ...value, items: [{ ...value.items[0]!, localSequence: 41 }, { ...value.items[1]!, localSequence: 43 }] },
      { ...value, items: [{ ...value.items[0]!, localSequence: 42 }, { ...value.items[1]!, localSequence: 41 }] },
      { ...value, lastSequence: 43 },
      { ...value, items: [{ ...value.items[0]! }, { ...value.items[1]!, requestId: ids.request1 }] }
    ]) {
      expect(StartCheckinRecoveryManifestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("avvisar fel scope, format, hash, UUID och tokenvarianter", () => {
    const value = manifest();
    for (const invalid of [
      { formatVersion: 2 },
      { kind: "OTID_CHECKIN_EXPORT" },
      { capability: "READOUT" },
      { raceId: "a0000000-0000-4000-8000-000000000001".toUpperCase() },
      { items: [{ ...value.items[0]!, contentHash: "A".repeat(64) }, value.items[1]! ] }
    ]) {
      expect(StartCheckinRecoveryManifestSchema.safeParse({ ...value, ...invalid }).success).toBe(false);
    }
    for (const invalidToken of [
      `otid_checkin_recovery_v1.${ids.credential}.${"A".repeat(42)}`,
      `otid_checkin_recovery_v2.${ids.credential}.${"A".repeat(43)}`,
      `otid_checkin_recovery_v1.${"a0000000-0000-4000-8000-000000000003".toUpperCase()}.${"A".repeat(43)}`,
      `otid_checkin_recovery_v1.${ids.credential}.${"/".repeat(43)}`
    ]) {
      expect(StartCheckinRecoveryTokenSchema.safeParse(invalidToken).success).toBe(false);
    }
  });

  it("serialiserar endast validerade manifest i canonical fältordning", () => {
    const first = manifest();
    const reordered = {
      items: first.items,
      lastSequence: first.lastSequence,
      firstSequence: first.firstSequence,
      capability: first.capability,
      actorCredentialId: first.actorCredentialId,
      deviceId: first.deviceId,
      raceId: first.raceId,
      kind: first.kind,
      formatVersion: first.formatVersion
    };
    expect(canonicalStartCheckinRecoveryManifest(reordered))
      .toEqual(canonicalStartCheckinRecoveryManifest(first));
    expect(new TextDecoder().decode(canonicalStartCheckinRecoveryManifest(first))).toBe(
      '{"actorCredentialId":"10000000-0000-4000-8000-000000000003","capability":"START_CHECKIN","deviceId":"10000000-0000-4000-8000-000000000002","firstSequence":41,"formatVersion":1,"items":[{"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","localSequence":41,"requestId":"10000000-0000-4000-8000-000000000004"},{"contentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","localSequence":42,"requestId":"10000000-0000-4000-8000-000000000005"}],"kind":"OTID_CHECKIN_RECOVERY_MANIFEST","lastSequence":42,"raceId":"10000000-0000-4000-8000-000000000001"}'
    );
    expect(() => canonicalStartCheckinRecoveryManifest({ ...first, items: [] })).toThrow();
  });
});
