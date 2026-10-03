import { createHash, randomUUID } from "node:crypto";
import {
  canonicalOperationalBackupManifestBytes,
  type OperationalBackupManifest,
  type OperationalBackupOperationState
} from "@o-tid/contracts";
import { describe, expect, it, vi } from "vitest";
import { captureOperationalBackup, captureOperationalBackupSource, OperationalBackupCaptureError } from "../src/operational-backup-capture";

const backupId = randomUUID();
const storeId = randomUUID();
const pmObjects = [
  { storeId, key: `pm/${randomUUID()}/${randomUUID()}`, versionId: "v-1", sha256: "a".repeat(64), byteLength: 3 },
  { storeId, key: `pm/${randomUUID()}/${randomUUID()}`, versionId: "v-2", sha256: "b".repeat(64), byteLength: 4 }
];

function manifest(): OperationalBackupManifest {
  return {
    formatVersion: 1,
    backupId,
    createdAt: "2026-09-22T12:00:00.000Z",
    writeStopConfirmed: true,
    postgresDump: { identity: "otid.sql", sha256: "c".repeat(64), byteLength: 7 },
    migrationIdentity: "migration-0001",
    pmObjects
  };
}

function source(result = manifest()) {
  return {
    prepare: vi.fn().mockResolvedValue({
      manifest: result,
      manifestSha256: createHash("sha256").update(canonicalOperationalBackupManifestBytes(result)).digest("hex"),
      verifiedPmObjectCount: result.pmObjects.length
    })
  };
}

function ports() {
  return {
    createPostgresDump: vi.fn().mockResolvedValue(manifest().postgresDump),
    prepareEmptyTarget: vi.fn().mockResolvedValue(undefined),
    replicateAndCleanup: vi.fn().mockResolvedValue(undefined),
    verifyCompletion: vi.fn().mockResolvedValue({
      backupId,
      manifestSha256: createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest())).digest("hex"),
      verifiedPmObjectCount: pmObjects.length
    }),
    recordOperationState: vi.fn().mockResolvedValue(undefined)
  };
}

const intent = { backupId, createdAt: "2026-09-22T12:00:00.000Z", writeStopConfirmed: true };

describe("captureOperationalBackupSource", () => {
  it("writes pending state before dump, validates the matching source manifest, then records target waiting", async () => {
    const prepared = source();
    const worker = ports();
    const calls: string[] = [];
    const states: OperationalBackupOperationState[] = [];
    worker.recordOperationState.mockImplementation(async (state: OperationalBackupOperationState) => {
      calls.push(`state:${state.phase}`);
      states.push(state);
    });
    worker.createPostgresDump.mockImplementation(async () => {
      calls.push("dump");
      return manifest().postgresDump;
    });
    prepared.prepare.mockImplementation(async input => {
      calls.push("preflight");
      expect(input).toEqual({ ...intent, postgresDump: manifest().postgresDump });
      return {
        manifest: manifest(),
        manifestSha256: createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest())).digest("hex"),
        verifiedPmObjectCount: pmObjects.length
      };
    });

    const evidence = await captureOperationalBackupSource(intent, prepared, worker);
    expect(calls).toEqual(["state:DUMP_PENDING", "dump", "preflight", "state:TARGET_PREPARATION_PENDING"]);
    expect(states[1]).toMatchObject({ phase: "TARGET_PREPARATION_PENDING", backupId });
    expect(states[1]?.manifestSha256).toBe(evidence.manifestSha256);
    expect(states[1]?.storeIds).toEqual([...new Set(pmObjects.map(object => object.storeId))].sort());
    expect(evidence.kind).toBe("SOURCE_CAPTURE_EVIDENCE");
    expect(evidence).toMatchObject({ manifest: manifest(), verifiedPmObjectCount: pmObjects.length });
    expect(worker.prepareEmptyTarget).not.toHaveBeenCalled();
  });

  it("rejects an invalid write-stop attestation before state, dump, or preflight", async () => {
    const prepared = source();
    const worker = ports();
    await expect(captureOperationalBackupSource({ ...intent, writeStopConfirmed: false }, prepared, worker)).rejects.toThrow();
    expect(worker.recordOperationState).not.toHaveBeenCalled();
    expect(worker.createPostgresDump).not.toHaveBeenCalled();
    expect(prepared.prepare).not.toHaveBeenCalled();
  });

  it("withholds source evidence on dump, preflight, binding, or final-state failure", async () => {
    const dumpFailure = ports();
    dumpFailure.createPostgresDump.mockRejectedValue(new Error("dump failed"));
    await expect(captureOperationalBackupSource(intent, source(), dumpFailure)).rejects.toMatchObject({ code: "DUMP_UNAVAILABLE" });
    expect(dumpFailure.recordOperationState).toHaveBeenCalledTimes(1);

    const preflightFailure = ports();
    const failedSource = source();
    failedSource.prepare.mockRejectedValue(new Error("preflight failed"));
    await expect(captureOperationalBackupSource(intent, failedSource, preflightFailure)).rejects.toMatchObject({ code: "SOURCE_PREFLIGHT_FAILED" });
    expect(preflightFailure.recordOperationState).toHaveBeenCalledTimes(1);

    const wrongManifest = manifest();
    wrongManifest.backupId = randomUUID();
    const bindingFailure = source(wrongManifest);
    await expect(captureOperationalBackupSource(intent, bindingFailure, ports())).rejects.toMatchObject({ code: "SOURCE_PREFLIGHT_INVALID" });

    const stateFailure = ports();
    stateFailure.recordOperationState.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("state unavailable"));
    await expect(captureOperationalBackupSource(intent, source(), stateFailure)).rejects.toMatchObject({ code: "OPERATION_STATE_FAILED" });
  });
});

describe("captureOperationalBackup", () => {
  it("binds the dump, verifies every target version and clears the rule before returning a receipt", async () => {
    const prepared = source();
    const worker = ports();
    const states: OperationalBackupOperationState[] = [];
    worker.recordOperationState.mockImplementation(async (state: OperationalBackupOperationState) => { states.push(state); });

    const receipt = await captureOperationalBackup(intent, prepared, worker);
    expect("kind" in receipt).toBe(false);
    expect(Object.keys(receipt).sort()).toEqual(["backupId", "manifestSha256", "verifiedPmObjectCount"]);
    expect(receipt.backupId).toBe(backupId);
    expect(receipt.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.verifiedPmObjectCount).toBe(2);
    expect(receipt).not.toHaveProperty("manifest");

    expect(prepared.prepare).toHaveBeenCalledWith({ ...intent, postgresDump: manifest().postgresDump });
    expect(worker.prepareEmptyTarget).toHaveBeenCalledWith(expect.objectContaining({ manifest: manifest() }));
    expect(worker.replicateAndCleanup).toHaveBeenCalledTimes(1);
    expect(worker.verifyCompletion).toHaveBeenCalledTimes(1);
    expect(worker.replicateAndCleanup.mock.invocationCallOrder[0]).toBeLessThan(worker.verifyCompletion.mock.invocationCallOrder[0]!);
    expect(states.map(state => state.phase)).toEqual(["DUMP_PENDING", "TARGET_PREPARATION_PENDING"]);
    for (const state of states.slice(1)) {
      expect(state.manifestSha256).toBe(receipt.manifestSha256);
      expect(state.storeIds).toEqual([...new Set(pmObjects.map(object => object.storeId))].sort());
    }
  });

  it("maps managed port failures to a secret-free code and returns no receipt", async () => {
    const prepared = source();
    const worker = ports();
    worker.replicateAndCleanup.mockRejectedValue(new Error("secret endpoint and credential"));

    await expect(captureOperationalBackup(intent, prepared, worker)).rejects.toMatchObject(
      { code: "REPLICATION_FAILED" } satisfies Partial<OperationalBackupCaptureError>
    );
    expect(worker.verifyCompletion).not.toHaveBeenCalled();
  });

  it("does not issue a receipt when final proof fails", async () => {
    const prepared = source();
    const worker = ports();
    worker.verifyCompletion.mockRejectedValueOnce(new Error("private state mismatch"));
    await expect(captureOperationalBackup(intent, prepared, worker)).rejects.toMatchObject(
      { code: "FINAL_VERIFICATION_FAILED" } satisfies Partial<OperationalBackupCaptureError>
    );
    expect(worker.replicateAndCleanup).toHaveBeenCalledTimes(1);

    const mismatchedProof = ports();
    mismatchedProof.verifyCompletion.mockResolvedValue({
      backupId: randomUUID(),
      manifestSha256: createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest())).digest("hex"),
      verifiedPmObjectCount: pmObjects.length
    });
    await expect(captureOperationalBackup(intent, source(), mismatchedProof)).rejects.toMatchObject({ code: "FINAL_VERIFICATION_FAILED" });
  });

  it("rejects zero or multiple stores before target side effects", async () => {
    const empty = manifest();
    empty.pmObjects = [];
    const noStoreWorker = ports();
    await expect(captureOperationalBackup(intent, source(empty), noStoreWorker)).rejects.toMatchObject({ code: "SOURCE_STORE_UNSUPPORTED" });
    expect(noStoreWorker.prepareEmptyTarget).not.toHaveBeenCalled();
    expect(noStoreWorker.replicateAndCleanup).not.toHaveBeenCalled();

    const multiple = manifest();
    multiple.pmObjects[1] = { ...multiple.pmObjects[1]!, storeId: randomUUID() };
    const multipleStoreWorker = ports();
    await expect(captureOperationalBackup(intent, source(multiple), multipleStoreWorker)).rejects.toMatchObject({ code: "SOURCE_STORE_UNSUPPORTED" });
    expect(multipleStoreWorker.prepareEmptyTarget).not.toHaveBeenCalled();
  });

  it("does not create a dump when the initial recovery state cannot be saved", async () => {
    const worker = ports();
    worker.recordOperationState.mockRejectedValueOnce(new Error("private state unavailable"));
    await expect(captureOperationalBackup(intent, source(), worker)).rejects.toMatchObject(
      { code: "OPERATION_STATE_FAILED" } satisfies Partial<OperationalBackupCaptureError>
    );
    expect(worker.createPostgresDump).not.toHaveBeenCalled();
  });

});
