import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { canonicalOperationalBackupManifestBytes } from "@o-tid/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOperationalBackupOperationStateRecorder,
  verifyOperationalBackupCompletion,
  writeOperationalBackupTargetBinding
} from "../src";

const roots: string[] = [];
const backupId = "a0000000-0000-4000-8000-000000000001";
const storeId = "b0000000-0000-4000-8000-000000000002";
const targetId = "c0000000-0000-4000-8000-000000000003";
const store = { storeId, sourceEndpoint: "https://source.example.test", sourceBucket: "otid-pm", targetBucket: "otid-pm" };
const sourceCredentials = { accessKey: "synthetic-access", secretKey: "synthetic-secret" };
const pmBytes = Buffer.from("private-pm-bytes");
const dumpBytes = Buffer.from("synthetic-postgres-dump");
const pmObject = {
  storeId,
  key: "pm/d0000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000005",
  versionId: "pm-version-1",
  sha256: createHash("sha256").update(pmBytes).digest("hex"),
  byteLength: pmBytes.byteLength
};

async function privateDirectory(path: string): Promise<string> {
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("operational backup completion proof", () => {
  it("rechecks cleanup, zero source rules, exact target bytes, and private dump before returning only a safe receipt", async () => {
    const root = await mkdtemp("/private/tmp/otid-completion-");
    roots.push(root);
    await chmod(root, 0o700);
    const stateDirectory = await privateDirectory(join(root, "state"));
    const bindingDirectory = await privateDirectory(join(root, "binding"));
    const dataArea = await privateDirectory(join(bindingDirectory, "data"));
    const dumpPath = join(root, `${backupId}.dump`);
    await writeFile(dumpPath, dumpBytes, { mode: 0o600 });
    await chmod(dumpPath, 0o600);
    const dataIdentity = await stat(dataArea);
    const manifest = {
      formatVersion: 1 as const,
      backupId,
      createdAt: "2026-09-23T12:00:00.000Z",
      writeStopConfirmed: true as const,
      postgresDump: {
        identity: `${backupId}.dump`,
        sha256: createHash("sha256").update(dumpBytes).digest("hex"),
        byteLength: dumpBytes.byteLength
      },
      migrationIdentity: "migration-0001",
      pmObjects: [pmObject]
    };
    const manifestSha256 = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
    const sourceCapture = { kind: "SOURCE_CAPTURE_EVIDENCE", manifest, manifestSha256, verifiedPmObjectCount: 1 };
    const recorder = createOperationalBackupOperationStateRecorder({ directory: stateDirectory, repositoryRoot: process.cwd() });
    for (const phase of ["DUMP_PENDING", "TARGET_PREPARATION_PENDING", "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"] as const) {
      if (phase === "DUMP_PENDING") {
        await recorder.record({ formatVersion: 1, backupId, phase, manifestSha256: null, storeIds: [] });
      } else {
        await recorder.record({ formatVersion: 1, backupId, phase, manifestSha256, storeIds: [storeId] });
      }
    }
    await writeOperationalBackupTargetBinding({
      directory: bindingDirectory,
      repositoryRoot: process.cwd(),
      binding: {
        formatVersion: 2,
        backupId,
        manifestSha256,
        targetId,
        targetEndpoint: "http://127.0.0.1:9400",
        targetMode: "loopback-development",
        dataAreaPath: dataArea,
        dataAreaIdentity: { dev: dataIdentity.dev, ino: dataIdentity.ino },
        credentialFileIdentity: { dev: dataIdentity.dev, ino: dataIdentity.ino },
        credentialFileSha256: "d".repeat(64),
        credentialRef: "file:private-target-credential",
        stores: [store]
      }
    });
    const readRules = vi.fn().mockResolvedValue([]);
    const targetPmReader = { read: vi.fn().mockResolvedValue(pmBytes) };
    const result = await verifyOperationalBackupCompletion({
      sourceCapture,
      operationStateDirectory: stateDirectory,
      repositoryRoot: process.cwd(),
      targetBindingDirectory: bindingDirectory,
      store,
      sourceCredentials,
      targetPmReader,
      dumpPath,
      readRules
    });
    expect(result).toEqual({ backupId, manifestSha256, verifiedPmObjectCount: 1 });
    expect(Object.keys(result).sort()).toEqual(["backupId", "manifestSha256", "verifiedPmObjectCount"]);
    expect(readRules).toHaveBeenCalledOnce();
    expect(targetPmReader.read).toHaveBeenCalledWith({ formatVersion: 1, ...pmObject }, undefined);
  });

  it("fails closed with a generic error for malformed completion evidence", async () => {
    const root = await mkdtemp("/private/tmp/otid-completion-rule-");
    roots.push(root);
    await chmod(root, 0o700);
    await expect(verifyOperationalBackupCompletion({
      sourceCapture: {}, operationStateDirectory: root, repositoryRoot: process.cwd(),
      targetBindingDirectory: root, store, sourceCredentials, targetPmReader: { read: vi.fn() },
      dumpPath: join(root, "missing.dump"), readRules: async () => [{ ID: "foreign" }]
    })).rejects.toMatchObject({ message: "OPERATIONAL_BACKUP_COMPLETION_FAILED" });
  });
});
