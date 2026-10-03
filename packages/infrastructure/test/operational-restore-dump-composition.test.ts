import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateOperationalRestoreDatabaseEvidence, verifyOperationalRestoreTarget } from "@o-tid/application";
import { measureOperationalBackupPostgresDump } from "../src";

const dumpBytes = new TextEncoder().encode("synthetic-postgres-dump-for-TASK166");
const pmObject = {
  storeId: "11111111-1111-4111-8111-111111111111",
  key: "pm/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
  versionId: "synthetic-version-1", sha256: "a".repeat(64), byteLength: 10,
};
const manifest = {
  formatVersion: 1 as const, backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-23T10:00:00.000Z", writeStopConfirmed: true as const,
  postgresDump: {
    identity: "private/synthetic.dump",
    sha256: createHash("sha256").update(dumpBytes).digest("hex"),
    byteLength: dumpBytes.byteLength,
  },
  migrationIdentity: `drizzle:${"b".repeat(64)}`, pmObjects: [pmObject],
};

function databaseEvidence() {
  return validateOperationalRestoreDatabaseEvidence(manifest, {
    migrationIdentity: manifest.migrationIdentity, pmObjects: [pmObject], postgis: true,
    history: {
      events: "1", races: "1", entries: "1", rawDeviceMessages: "1",
      cardReadouts: "1", resultRevisions: "1", auditEvents: "1", resultFinalizations: "1",
    },
  });
}

describe("TASK166 already-open dump stream in restore order", () => {
  it("measures chunked bytes before checking exact PM and database evidence", async () => {
    const order: string[] = [];
    const receipt = await verifyOperationalRestoreTarget(manifest, {
      async measure() {
        order.push("dump");
        async function* chunks() {
          yield dumpBytes.subarray(0, 3);
          yield dumpBytes.subarray(3, 17);
          yield dumpBytes.subarray(17);
        }
        return measureOperationalBackupPostgresDump({ identity: manifest.postgresDump.identity, chunks: chunks() });
      },
    }, {
      async verify() { order.push("pm"); },
    }, {
      async verify() { order.push("database"); return databaseEvidence(); },
    });
    expect(order).toEqual(["dump", "pm", "database"]);
    expect(receipt.verifiedPmObjectCount).toBe(1);
  });

  it("stops before PM/database when the supplied bytes differ from the manifest", async () => {
    const order: string[] = [];
    await expect(verifyOperationalRestoreTarget(manifest, {
      async measure() {
        order.push("dump");
        async function* chunks() { yield new TextEncoder().encode("wrong dump bytes"); }
        return measureOperationalBackupPostgresDump({ identity: manifest.postgresDump.identity, chunks: chunks() });
      },
    }, {
      async verify() { order.push("pm"); },
    }, {
      async verify() { order.push("database"); return databaseEvidence(); },
    })).rejects.toMatchObject({ code: "POSTGRES_DUMP_VERIFICATION_FAILED" });
    expect(order).toEqual(["dump"]);
  });
});
