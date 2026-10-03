import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalOperationalBackupManifestBytes } from "@o-tid/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOperationalBackupOperationStateRecorder,
  verifyOperationalBackupCompletion,
  writeOperationalBackupTargetBinding
} from "../src";
import { readOperationalBackupCompletionRecord, writeOperationalBackupCompletionRecord } from "../src/operational-backup-completion-record";

const roots: string[] = [];
const backupId = "a0000000-0000-4000-8000-000000000001";
const storeId = "b0000000-0000-4000-8000-000000000002";
const targetId = "c0000000-0000-4000-8000-000000000003";
const pmBytes = Buffer.from("synthetic-pm-object");
const dumpBytes = Buffer.from("synthetic-postgres-dump");
const store = { storeId, sourceEndpoint: "https://source.example.test", sourceBucket: "otid-pm", targetBucket: "otid-pm" };
const sourceCredentials = { accessKey: "synthetic-access", secretKey: "synthetic-secret" };
const pmObject = { storeId, key: "pm/d0000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000005",
  versionId: "pm-version-1", sha256: createHash("sha256").update(pmBytes).digest("hex"), byteLength: pmBytes.byteLength };

async function privateDir(path: string): Promise<string> { await mkdir(path, { mode: 0o700 }); await chmod(path, 0o700); return path; }
async function fixture() {
  const root = await mkdtemp("/private/tmp/otid-completion-record-");
  roots.push(root);
  await chmod(root, 0o700);
  const stateDirectory = await privateDir(join(root, "state"));
  const targetBindingDirectory = await privateDir(join(root, "binding"));
  const recordDirectory = await privateDir(join(root, "records"));
  const dataArea = await privateDir(join(targetBindingDirectory, "data"));
  const dumpDirectory = await privateDir(join(root, "dumps"));
  const dumpPath = join(dumpDirectory, `${backupId}.dump`);
  await writeFile(dumpPath, dumpBytes, { mode: 0o600 });
  await chmod(dumpPath, 0o600);
  const dataIdentity = await stat(dataArea);
  const manifest = { formatVersion: 1 as const, backupId, createdAt: "2026-09-23T12:00:00.000Z",
    writeStopConfirmed: true as const,
    postgresDump: { identity: `${backupId}.dump`, sha256: createHash("sha256").update(dumpBytes).digest("hex"), byteLength: dumpBytes.byteLength },
    migrationIdentity: "migration-0001", pmObjects: [pmObject] };
  const manifestSha256 = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
  const sourceCapture = { kind: "SOURCE_CAPTURE_EVIDENCE", manifest, manifestSha256, verifiedPmObjectCount: 1 };
  const recorder = createOperationalBackupOperationStateRecorder({ directory: stateDirectory, repositoryRoot: process.cwd() });
  await recorder.record({ formatVersion: 1, backupId, phase: "DUMP_PENDING", manifestSha256: null, storeIds: [] });
  for (const phase of ["TARGET_PREPARATION_PENDING", "REPLICATION_MAY_EXIST", "CLEANUP_REQUIRED", "CLEANUP_VERIFIED"] as const) {
    await recorder.record({ formatVersion: 1, backupId, phase, manifestSha256, storeIds: [storeId] });
  }
  await writeOperationalBackupTargetBinding({ directory: targetBindingDirectory, repositoryRoot: process.cwd(), binding: {
    formatVersion: 2, backupId, manifestSha256, targetId, targetEndpoint: "http://127.0.0.1:9400",
    targetMode: "loopback-development", dataAreaPath: dataArea,
    dataAreaIdentity: { dev: dataIdentity.dev, ino: dataIdentity.ino },
    credentialFileIdentity: { dev: dataIdentity.dev, ino: dataIdentity.ino },
    credentialFileSha256: "d".repeat(64), credentialRef: "file:private-target-credential", stores: [store]
  } });
  const readRules = vi.fn().mockResolvedValue([]);
  const targetPmReader = { read: vi.fn().mockResolvedValue(pmBytes) };
  const captureReceipt = await verifyOperationalBackupCompletion({ sourceCapture, operationStateDirectory: stateDirectory,
    repositoryRoot: process.cwd(), targetBindingDirectory, store, sourceCredentials, targetPmReader, dumpPath, readRules });
  const common = { sourceCapture, captureReceipt, operationStateDirectory: stateDirectory, repositoryRoot: process.cwd(),
    targetBindingDirectory, store, sourceCredentials, targetPmReader, dumpPath, readRules, recordDirectory };
  return { root, stateDirectory, targetBindingDirectory, recordDirectory, dumpDirectory, dumpPath, sourceCapture,
    captureReceipt, readRules, targetPmReader, common, manifestSha256 };
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("private operational backup completion record", () => {
  it("writes a write-once record and reopens it using only explicit private directories", async () => {
    const f = await fixture();
    expect(await writeOperationalBackupCompletionRecord(f.common)).toEqual(f.captureReceipt);
    const record = await readOperationalBackupCompletionRecord({ backupId, recordDirectory: f.recordDirectory,
      repositoryRoot: process.cwd(), operationStateDirectory: f.stateDirectory,
      targetBindingDirectory: f.targetBindingDirectory, dumpDirectory: f.dumpDirectory });
    expect(record).toMatchObject({ formatVersion: 1, backupId, manifestSha256: f.manifestSha256,
      verifiedPmObjectCount: 1, targetId, manifest: f.sourceCapture.manifest });
    expect(JSON.stringify(record)).not.toContain("source.example.test");
    await expect(writeOperationalBackupCompletionRecord(f.common)).rejects.toMatchObject({
      message: "OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID"
    });
  });

  it("rejects tampered, missing, noncanonical and incorrectly permissioned records", async () => {
    const f = await fixture();
    await writeOperationalBackupCompletionRecord(f.common);
    const path = join(f.recordDirectory, `${backupId}.completion.json`);
    const original = await readFile(path);
    await writeFile(path, Buffer.from(original.toString().replace(targetId, "d0000000-0000-4000-8000-000000000004")));
    await expect(readOperationalBackupCompletionRecord({ backupId, recordDirectory: f.recordDirectory,
      repositoryRoot: process.cwd(), operationStateDirectory: f.stateDirectory,
      targetBindingDirectory: f.targetBindingDirectory, dumpDirectory: f.dumpDirectory })).rejects.toMatchObject({
      message: "OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID"
    });
    await writeFile(path, original);
    await chmod(path, 0o644);
    await expect(readOperationalBackupCompletionRecord({ backupId, recordDirectory: f.recordDirectory,
      repositoryRoot: process.cwd(), operationStateDirectory: f.stateDirectory,
      targetBindingDirectory: f.targetBindingDirectory, dumpDirectory: f.dumpDirectory })).rejects.toMatchObject({
      message: "OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID"
    });
    await chmod(path, 0o600);
    const missing = await mkdtemp("/private/tmp/otid-completion-record-missing-");
    roots.push(missing);
    await chmod(missing, 0o700);
    await expect(readOperationalBackupCompletionRecord({ backupId, recordDirectory: missing,
      repositoryRoot: process.cwd(), operationStateDirectory: f.stateDirectory,
      targetBindingDirectory: f.targetBindingDirectory, dumpDirectory: f.dumpDirectory })).rejects.toMatchObject({
      message: "OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID"
    });
  });

  it("rejects a hardlinked record", async () => {
    const f = await fixture();
    await writeOperationalBackupCompletionRecord(f.common);
    await link(join(f.recordDirectory, `${backupId}.completion.json`), join(f.recordDirectory, "alias"));
    await expect(readOperationalBackupCompletionRecord({ backupId, recordDirectory: f.recordDirectory,
      repositoryRoot: process.cwd(), operationStateDirectory: f.stateDirectory,
      targetBindingDirectory: f.targetBindingDirectory, dumpDirectory: f.dumpDirectory })).rejects.toMatchObject({
      message: "OPERATIONAL_BACKUP_COMPLETION_RECORD_INVALID"
    });
  });
});
