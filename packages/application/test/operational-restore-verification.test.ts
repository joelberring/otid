import { describe, expect, it } from "vitest";
import { OperationalRestoreVerificationError, validateOperationalRestoreDatabaseEvidence, verifyOperationalRestoreTarget } from "../src/operational-restore-verification";

const object = {
  storeId: "11111111-1111-4111-8111-111111111111",
  key: "pm/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
  versionId: "version-1", sha256: "a".repeat(64), byteLength: 10,
};
const manifest = {
  formatVersion: 1 as const, backupId: "10000000-0000-4000-8000-000000000001", createdAt: "2026-09-20T08:00:00.000Z",
  writeStopConfirmed: true as const, postgresDump: { identity: "private/postgres.dump", sha256: "b".repeat(64), byteLength: 20 },
  migrationIdentity: `drizzle:${"c".repeat(64)}`, pmObjects: [object],
};

function evidence({ postgis = true, history = true } = {}) {
  return { migrationIdentity: manifest.migrationIdentity, pmObjects: [object], postgis, history: {
    events: history ? "1" : "0", races: "1", entries: "1", rawDeviceMessages: "1", cardReadouts: "1",
    resultRevisions: "1", auditEvents: "1", resultFinalizations: "1",
  } };
}

function expectFailure(action: () => unknown, code: OperationalRestoreVerificationError["code"]): void {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(OperationalRestoreVerificationError);
    if (error instanceof OperationalRestoreVerificationError) expect(error.code).toBe(code);
    return;
  }
  throw new Error("Expected restore verification to fail");
}

describe("TASK099 read-only restore database evidence", () => {
  it("requires PostGIS, the exact migration/PM references and a complete history chain", async () => {
    expect(validateOperationalRestoreDatabaseEvidence(manifest, evidence())).toMatchObject({
      migrationIdentity: manifest.migrationIdentity, pmObjects: [object], history: { resultFinalizations: 1, rawDeviceMessages: 1 }
    });
  });

  it("fails closed before a report when PostGIS or the required chain is absent", async () => {
    expectFailure(() => validateOperationalRestoreDatabaseEvidence(manifest, evidence({ postgis: false })), "POSTGIS_MISSING");
    expectFailure(() => validateOperationalRestoreDatabaseEvidence(manifest, evidence({ history: false })), "HISTORY_INCOMPLETE");
  });

  it("verifies every manifest-bound PM version before the read-only database proof", async () => {
    const verified: string[] = [];
    let databaseChecks = 0;
    const databaseEvidence = validateOperationalRestoreDatabaseEvidence(manifest, evidence());
    const receipt = await verifyOperationalRestoreTarget(manifest, {
      async measure() { verified.push("dump"); return manifest.postgresDump; }
    }, {
      async verify(pmObject) { verified.push(`pm:${pmObject.storeId}:${pmObject.key}:${pmObject.versionId}`); }
    }, {
      async verify() { verified.push("database"); databaseChecks += 1; return databaseEvidence; }
    });
    expect(verified).toEqual(["dump", `pm:${object.storeId}:${object.key}:${object.versionId}`, "database"]);
    expect(databaseChecks).toBe(1);
    expect(receipt.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.verifiedPmObjectCount).toBe(1);
    expect(receipt.databaseEvidence).toEqual(databaseEvidence);
  });

  it("fails before database evidence when an exact target PM object cannot be verified", async () => {
    let databaseChecks = 0;
    await expect(verifyOperationalRestoreTarget(manifest, {
      async measure() { return manifest.postgresDump; }
    }, {
      async verify() { throw new Error("synthetic target mismatch"); }
    }, {
      async verify() { databaseChecks += 1; return validateOperationalRestoreDatabaseEvidence(manifest, evidence()); }
    })).rejects.toMatchObject({ code: "PM_OBJECT_VERIFICATION_FAILED" } satisfies Partial<OperationalRestoreVerificationError>);
    expect(databaseChecks).toBe(0);
  });

  it("keeps database evidence fail-closed after successful target PM verification", async () => {
    let pmChecks = 0;
    await expect(verifyOperationalRestoreTarget(manifest, {
      async measure() { return manifest.postgresDump; }
    }, {
      async verify() { pmChecks += 1; }
    }, {
      async verify() { throw new OperationalRestoreVerificationError("POSTGIS_MISSING"); }
    })).rejects.toMatchObject({ code: "POSTGIS_MISSING" } satisfies Partial<OperationalRestoreVerificationError>);
    expect(pmChecks).toBe(1);
  });

  it.each([
    { identity: "other/private.dump" },
    { identity: " private/postgres.dump" },
    { sha256: "d".repeat(64) },
    { byteLength: 21 },
    { byteLength: 0 },
  ])("rejects a mismatched or invalid dump proof before PM and database reads: %j", async (difference) => {
    let pmChecks = 0;
    let databaseChecks = 0;
    await expect(verifyOperationalRestoreTarget(manifest, {
      async measure() { return { ...manifest.postgresDump, ...difference }; }
    }, {
      async verify() { pmChecks += 1; }
    }, {
      async verify() { databaseChecks += 1; return validateOperationalRestoreDatabaseEvidence(manifest, evidence()); }
    })).rejects.toMatchObject({ code: "POSTGRES_DUMP_VERIFICATION_FAILED" } satisfies Partial<OperationalRestoreVerificationError>);
    expect(pmChecks).toBe(0);
    expect(databaseChecks).toBe(0);
  });

  it("hides dump-reader failures and rejects an invalid manifest before any read", async () => {
    const calls: string[] = [];
    const dumpReader = { async measure(): Promise<typeof manifest.postgresDump> {
      calls.push("dump");
      throw new Error("private/source/path with secret bytes");
    } };
    const pmVerifier = { async verify() { calls.push("pm"); } };
    const databaseVerifier = { async verify() { calls.push("database"); return validateOperationalRestoreDatabaseEvidence(manifest, evidence()); } };
    await expect(verifyOperationalRestoreTarget(manifest, dumpReader, pmVerifier, databaseVerifier))
      .rejects.toMatchObject({ code: "POSTGRES_DUMP_VERIFICATION_FAILED", message: "POSTGRES_DUMP_VERIFICATION_FAILED" });
    expect(calls).toEqual(["dump"]);
    calls.length = 0;
    await expect(verifyOperationalRestoreTarget({ ...manifest, writeStopConfirmed: false }, dumpReader, pmVerifier, databaseVerifier))
      .rejects.toMatchObject({ code: "MANIFEST_INVALID" });
    expect(calls).toEqual([]);
  });
});
