import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "minio";
import { afterEach, describe, expect, it } from "vitest";
import { buildOperationalBackupManifest } from "../src/operational-backup-manifest";
import { createOperationalBackupOperationStateRecorder } from "../src/operational-backup-operation-state";
import { openCompletedPinnedOperationalBackupTarget, provisionPinnedOperationalBackupTarget, resumePinnedOperationalBackupTarget } from "../src/operational-backup-pinned-target";
import { readOperationalBackupTargetBinding } from "../src/operational-backup-target-binding";

const roots: string[] = [];
const storeId = "c0000000-0000-4000-8000-000000000003";

async function privateDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(`/private/tmp/${prefix}-`);
  await chmod(path, 0o700);
  roots.push(path);
  return path;
}

async function retainedPrivateDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(`/private/tmp/${prefix}-`);
  await chmod(path, 0o700);
  return path;
}

async function killWorkerGroup(worker: ChildProcess): Promise<void> {
  if (worker.pid === undefined) throw new Error("CRASH_WORKER_MISSING_PID");
  try { process.kill(-worker.pid, "SIGKILL"); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
  await new Promise<void>((resolvePromise, reject) => {
    if (worker.exitCode !== null || worker.signalCode !== null) return resolvePromise();
    worker.once("error", reject);
    worker.once("close", () => resolvePromise());
  });
}

async function crashAtCheckpoint(input: {
  checkpoint: "reservation-created" | "binding-synced";
  workerInput: Parameters<typeof provisionPinnedOperationalBackupTarget>[0];
}): Promise<void> {
  const fixture = fileURLToPath(new URL("./fixtures/operational-backup-pinned-target-crash-worker.ts", import.meta.url));
  const worker = spawn(process.execPath, ["--import", "tsx", fixture, JSON.stringify({
    checkpoint: input.checkpoint,
    input: input.workerInput
  })], {
    cwd: process.cwd(), detached: true,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  try {
    const message = await new Promise<unknown>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("CRASH_WORKER_CHECKPOINT_TIMEOUT")), 30_000);
      worker.once("message", value => { clearTimeout(timer); resolvePromise(value); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
      worker.once("close", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`CRASH_WORKER_EXITED_BEFORE_CHECKPOINT:${code ?? signal ?? "unknown"}`));
      });
    });
    expect(message).toEqual({ checkpoint: input.checkpoint });
    await killWorkerGroup(worker);
    expect(worker.signalCode).toBe("SIGKILL");
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) await killWorkerGroup(worker);
  }
}

async function sourceSetup(directory: string, backupId: string) {
  const built = buildOperationalBackupManifest({
    backupId,
    createdAt: "2026-09-23T09:00:00+02:00",
    writeStopConfirmed: true,
    postgresDump: { identity: "synthetic.dump", sha256: "a".repeat(64), byteLength: 100 },
    migrationIdentity: "synthetic-migration",
    pmObjects: [{ storeId, key: `pm/${backupId}/${randomUUID()}`, versionId: "source-v1", sha256: "b".repeat(64), byteLength: 20 }]
  });
  const recorder = createOperationalBackupOperationStateRecorder({ directory, repositoryRoot: process.cwd() });
  await recorder.record({ formatVersion: 1, backupId, phase: "DUMP_PENDING", manifestSha256: null, storeIds: [] });
  await recorder.record({ formatVersion: 1, backupId, phase: "TARGET_PREPARATION_PENDING", manifestSha256: built.sha256, storeIds: [storeId] });
  return {
    sourceCapture: { kind: "SOURCE_CAPTURE_EVIDENCE" as const, manifest: built.manifest, manifestSha256: built.sha256, verifiedPmObjectCount: 1 },
    stores: [{ storeId, sourceEndpoint: "http://127.0.0.1:9001", sourceBucket: "otid-pm", targetBucket: "otid-pm" }]
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("pinned loopback operational backup target", () => {
  it("rejects a manifest hash mismatch before reserving or creating a target", async () => {
    const privateRoot = await privateDirectory("otid-pinned-target");
    const stateDirectory = await privateDirectory("otid-pinned-state");
    const backupId = randomUUID();
    const source = await sourceSetup(stateDirectory, backupId);
    await expect(provisionPinnedOperationalBackupTarget({
      backupId,
      sourceCapture: { ...source.sourceCapture, manifestSha256: "d".repeat(64) },
      operationStateDirectory: stateDirectory,
      stores: source.stores,
      privateRoot,
      repositoryRoot: process.cwd(),
      minioBinary: "/private/tmp/not-used"
    })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    expect(await readdir(privateRoot)).toEqual([]);
  });

  it("rejects a persisted state from another manifest before target side effects", async () => {
    const privateRoot = await privateDirectory("otid-pinned-target");
    const stateDirectory = await privateDirectory("otid-pinned-state");
    const backupId = randomUUID();
    const source = await sourceSetup(stateDirectory, backupId);
    await expect(provisionPinnedOperationalBackupTarget({
      backupId,
      sourceCapture: source.sourceCapture,
      operationStateDirectory: stateDirectory,
      stores: [{ ...source.stores[0], targetBucket: "other-bucket" }],
      privateRoot,
      repositoryRoot: process.cwd(),
      minioBinary: "/private/tmp/not-used"
    })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    expect(await readdir(privateRoot)).toEqual([]);
  });

  it("requires CLEANUP_VERIFIED to open a completed target and keeps resume gated to preparation", async () => {
    const privateRoot = await privateDirectory("otid-completed-target");
    const stateDirectory = await privateDirectory("otid-completed-state");
    const backupId = randomUUID();
    const source = await sourceSetup(stateDirectory, backupId);
    const completion = {
      backupId,
      manifestSha256: source.sourceCapture.manifestSha256,
      verifiedPmObjectCount: 1,
      manifest: source.sourceCapture.manifest,
      targetId: randomUUID(),
      targetBindingSha256: createHash("sha256").update("synthetic-binding").digest("hex")
    };
    const reopenInput = {
      backupId, completion, operationStateDirectory: stateDirectory, privateRoot,
      repositoryRoot: process.cwd(), minioBinary: "/private/tmp/not-used"
    };

    await expect(openCompletedPinnedOperationalBackupTarget(reopenInput))
      .rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    await expect(resumePinnedOperationalBackupTarget({
      backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
      repositoryRoot: process.cwd(), minioBinary: "/private/tmp/not-used"
    })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    expect(await readdir(privateRoot)).toEqual([]);
  });

  const pinnedBinary = process.env.OTID_TEST_PINNED_MINIO_BINARY;
  it.skipIf(!pinnedBinary)("fails closed after a reservation-only crash and resumes the exact binding after a synced-binding crash", async () => {
    const privateRoot = await privateDirectory("otid-pinned-crash-target");
    const stateDirectory = await privateDirectory("otid-pinned-crash-state");
    const backupId = randomUUID();
    const source = await sourceSetup(stateDirectory, backupId);
    const input = {
      backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
      repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
    };

    await crashAtCheckpoint({ checkpoint: "reservation-created", workerInput: input });
    expect((await readdir(privateRoot)).sort()).toEqual([`${backupId}.reservation`]);
    await expect(resumePinnedOperationalBackupTarget(input)).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    await expect(provisionPinnedOperationalBackupTarget(input)).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    expect((await readdir(privateRoot)).sort()).toEqual([`${backupId}.reservation`]);

    const secondPrivateRoot = await privateDirectory("otid-pinned-crash-bound");
    const secondBackupId = randomUUID();
    const secondSource = await sourceSetup(stateDirectory, secondBackupId);
    const secondInput = {
      backupId: secondBackupId, ...secondSource, operationStateDirectory: stateDirectory, privateRoot: secondPrivateRoot,
      repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
    };
    await crashAtCheckpoint({ checkpoint: "binding-synced", workerInput: secondInput });
    const persisted = await readOperationalBackupTargetBinding({
      directory: secondPrivateRoot, repositoryRoot: process.cwd(), backupId: secondBackupId
    });
    const resumed = await resumePinnedOperationalBackupTarget(secondInput);
    try {
      expect(resumed.binding).toEqual(persisted);
      expect(resumed.binding).toMatchObject({
        backupId: secondBackupId,
        targetId: persisted.targetId,
        manifestSha256: secondSource.sourceCapture.manifestSha256,
        dataAreaPath: persisted.dataAreaPath,
        dataAreaIdentity: persisted.dataAreaIdentity,
        stores: secondSource.stores
      });
      expect(resumed.readiness.kind).toBe("TARGET_READY_EVIDENCE");
    } finally {
      await resumed.stop();
    }
    await rm(join(secondPrivateRoot, `${secondBackupId}.target-ready.json`));
    await expect(resumePinnedOperationalBackupTarget(secondInput)).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
  });

  it.skipIf(!pinnedBinary)("provisions, stops, and resumes the exact private target with the pinned binary", async () => {
    const privateRoot = await retainedPrivateDirectory("otid-pinned-target-optin");
    const stateDirectory = await retainedPrivateDirectory("otid-pinned-state-optin");
    const backupId = randomUUID();
    const source = await sourceSetup(stateDirectory, backupId);
    let first: Awaited<ReturnType<typeof provisionPinnedOperationalBackupTarget>> | undefined;
    let resumed: Awaited<ReturnType<typeof resumePinnedOperationalBackupTarget>> | undefined;
    try {
      const reservedBackupId = randomUUID();
      const reservedSource = await sourceSetup(stateDirectory, reservedBackupId);
      const reservationRoot = await privateDirectory("otid-pinned-reserved-only");
      await mkdir(join(reservationRoot, `${reservedBackupId}.reservation`), { mode: 0o700 });
      await expect(resumePinnedOperationalBackupTarget({
        backupId: reservedBackupId, ...reservedSource, operationStateDirectory: stateDirectory, privateRoot: reservationRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      await expect(provisionPinnedOperationalBackupTarget({
        backupId: reservedBackupId, ...reservedSource, operationStateDirectory: stateDirectory, privateRoot: reservationRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      expect((await readdir(reservationRoot)).sort()).toEqual([`${reservedBackupId}.reservation`]);

      first = await provisionPinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      });
      await expect(provisionPinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      await expect(resumePinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      await first.stop();
      const credentialPath = first.binding.credentialRef.slice("file:".length);
      await chmod(credentialPath, 0o644);
      await expect(resumePinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      await chmod(credentialPath, 0o600);
      const originalCredentialPath = `${credentialPath}.original`;
      await rename(credentialPath, originalCredentialPath);
      await writeFile(credentialPath, JSON.stringify({ accessKey: `otid${"a".repeat(36)}`, secretKey: "b".repeat(64) }), { flag: "wx", mode: 0o600 });
      await expect(resumePinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
      const endpoint = new URL(first.binding.targetEndpoint);
      await expect(fetch(`${endpoint}/minio/health/live`)).rejects.toThrow();
      await rm(credentialPath);
      await rename(originalCredentialPath, credentialPath);
      resumed = await resumePinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      });
      expect(resumed.binding.targetId).toBe(first.binding.targetId);
      expect(resumed.binding.manifestSha256).toBe(first.binding.manifestSha256);
      expect(resumed.readiness.kind).toBe("TARGET_READY_EVIDENCE");
      const credentials = JSON.parse(await readFile(credentialPath, "utf8")) as { accessKey: string; secretKey: string };
      const client = new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port), useSSL: false,
        region: "us-east-1", accessKey: credentials.accessKey, secretKey: credentials.secretKey, pathStyle: true });
      await client.putObject("otid-pm", "synthetic-contamination", Buffer.from("synthetic"));
      await resumed.stop();
      resumed = undefined;
      await expect(resumePinnedOperationalBackupTarget({
        backupId, ...source, operationStateDirectory: stateDirectory, privateRoot,
        repositoryRoot: process.cwd(), minioBinary: pinnedBinary!
      })).rejects.toThrow("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    } finally {
      await resumed?.stop().catch(() => undefined);
      await first?.stop().catch(() => undefined);
    }
  });
});
