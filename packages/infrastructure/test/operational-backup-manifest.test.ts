import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildOperationalBackupManifest } from "../src";

const pm = (versionId: string) => ({
  storeId: "10000000-0000-4000-8000-000000000002",
  key: "pm/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001",
  versionId,
  sha256: createHash("sha256").update(versionId).digest("hex"),
  byteLength: versionId.length
});

const input = (pmObjects: unknown[]) => ({
  backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-19T12:00:00+02:00",
  writeStopConfirmed: true,
  postgresDump: {
    identity: "otid-postgres-2026-09-19.dump",
    sha256: "a".repeat(64),
    byteLength: 42
  },
  migrationIdentity: "0061_task_098_testeventor_entry_import_grant",
  pmObjects
});

describe("buildOperationalBackupManifest", () => {
  it("sorts PM references and produces identical canonical bytes", () => {
    const a = buildOperationalBackupManifest(input([pm("v-2"), pm("v-1")]));
    const b = buildOperationalBackupManifest(input([pm("v-1"), pm("v-2")]));
    expect(a.manifest.pmObjects.map(item => item.versionId)).toEqual(["v-1", "v-2"]);
    expect(Buffer.from(a.bytes)).toEqual(Buffer.from(b.bytes));
    expect(a.sha256).toBe(b.sha256);
  });

  it("fails closed when write stop is not explicitly confirmed", () => {
    expect(() => buildOperationalBackupManifest({ ...input([pm("v-1")]), writeStopConfirmed: false }))
      .toThrow();
  });

  it("fails closed for duplicate PM references", () => {
    expect(() => buildOperationalBackupManifest(input([pm("v-1"), pm("v-1")]))).toThrow();
  });
});
