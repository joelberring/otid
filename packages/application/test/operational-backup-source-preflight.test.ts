import { describe, expect, it, vi } from "vitest";
import {
  completeOperationalBackupSourcePreflight,
  OperationalBackupSourcePreflightError
} from "../src/operational-backup-source-preflight";

const first = {
  storeId: "10000000-0000-4000-8000-000000000002",
  key: "pm/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001",
  versionId: "v-1", sha256: "a".repeat(64), byteLength: 10
};
const second = { ...first, versionId: "v-2", sha256: "b".repeat(64), byteLength: 11 };
const intent = {
  backupId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-22T10:00:00.000Z",
  writeStopConfirmed: true,
  postgresDump: { identity: "private/otid.dump", sha256: "c".repeat(64), byteLength: 12 }
};
const evidence = { migrationIdentity: `drizzle:${"d".repeat(64)}`, pmObjects: [second, first] };

describe("TASK134 operational backup source preflight", () => {
  it("verifies every stable exact PM reference before reporting a canonical manifest", async () => {
    const verifiedVersions: string[] = [];
    const verify = vi.fn(async (pmObject: { versionId: string }) => {
      verifiedVersions.push(pmObject.versionId);
    });
    const result = await completeOperationalBackupSourcePreflight(intent, evidence, { verify });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verifiedVersions).toEqual(["v-1", "v-2"]);
    expect(result).toMatchObject({ verifiedPmObjectCount: 2, manifest: { pmObjects: [first, second] } });
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid intent before PM access and stops on a failed exact object check", async () => {
    const unused = { verify: vi.fn().mockResolvedValue(undefined) };
    await expect(completeOperationalBackupSourcePreflight({ ...intent, writeStopConfirmed: false }, evidence, unused)).rejects.toThrow();
    expect(unused.verify).not.toHaveBeenCalled();
    await expect(completeOperationalBackupSourcePreflight(intent, { ...evidence, pmObjects: [] }, unused))
      .rejects.toMatchObject({ code: "PM_REFERENCES_EMPTY" } satisfies Partial<OperationalBackupSourcePreflightError>);
    expect(unused.verify).not.toHaveBeenCalled();

    await expect(completeOperationalBackupSourcePreflight(intent, evidence, {
      verify: vi.fn().mockRejectedValue(new Error("not retained"))
    })).rejects.toMatchObject({ code: "PM_OBJECT_VERIFICATION_FAILED" } satisfies Partial<OperationalBackupSourcePreflightError>);
  });
});
