import { describe, expect, it } from "vitest";
import { appliedMigrationIdentityFromRow, mapOperationalBackupPmObjects } from "../src/operational-backup-read-model";

const a = { storeId: "11111111-1111-4111-8111-111111111111", objectKey: "pm/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333", versionId: "v1", sha256: "a".repeat(64), byteLength: 10 };
const b = { storeId: "11111111-1111-4111-8111-111111111111", objectKey: "pm/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333", versionId: "v2", sha256: "b".repeat(64), byteLength: 11 };

describe("TASK099 read-only backup model", () => {
  it("maps and sorts exact PM references", () => {
    expect(mapOperationalBackupPmObjects([b, a])).toEqual([
      { storeId: a.storeId, key: a.objectKey, versionId: "v1", sha256: a.sha256, byteLength: 10 },
      { storeId: b.storeId, key: b.objectKey, versionId: "v2", sha256: b.sha256, byteLength: 11 }
    ]);
  });

  it("fails closed for malformed or duplicate rows", () => {
    expect(() => mapOperationalBackupPmObjects([{ ...a, sha256: "bad" }])).toThrow("PM_MANIFEST_ROW_INVALID");
    expect(() => mapOperationalBackupPmObjects([a, a])).toThrow("PM_MANIFEST_DUPLICATE");
  });

  it("uses only a valid applied Drizzle hash as identity", () => {
    expect(appliedMigrationIdentityFromRow({ hash: "c".repeat(64) })).toBe(`drizzle:${"c".repeat(64)}`);
    expect(() => appliedMigrationIdentityFromRow({ hash: "unknown" })).toThrow("MIGRATION_IDENTITY_UNKNOWN");
  });
});
