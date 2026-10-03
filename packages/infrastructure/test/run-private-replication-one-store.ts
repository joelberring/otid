import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, readFile, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Client } from "minio";
import {
  buildOperationalBackupManifest,
  createOperationalBackupOperationStateRecorder,
  createPmObjectStore,
  OperationalBackupPinnedTargetError,
  OperationalBackupReplicationError,
  readOperationalBackupPmObject,
  provisionPinnedOperationalBackupTarget,
  readOperationalBackupOperationState,
  readOperationalBackupTargetBinding,
  replicateOperationalBackupStore,
  recoverOperationalBackupOperationState,
  cleanupOperationalBackupStore,
} from "../src";
import type { OperationalBackupOperationState } from "@o-tid/contracts";
import { withPinnedMinioSource } from "./pinned-minio-replication-fixture";

const confirmation = "synthetic-one-store-replication";
const crashConfirmation = "synthetic-crash-recovery";
const mode = process.env.OTID_TASK175_MODE ?? "replication";
const minioBinary = process.argv[2];
const mcBinary = process.argv[3];
const mcSha256 = "f72ab39389f6b8ac7369fa1894b62f34a9eca230c339c0b3128a7e45ecfcf139";

function requireConfiguration(): void {
  const expectedConfirmation = mode === "crash-recovery" ? crashConfirmation : confirmation;
  if (!(["replication", "crash-recovery"] as const).includes(mode as "replication" | "crash-recovery") ||
      process.env.OTID_TASK175_CONFIRM !== expectedConfirmation || !minioBinary || !mcBinary ||
      !resolve(minioBinary) || !resolve(mcBinary)) {
    throw new Error("TASK175_CONFIGURATION_INVALID");
  }
}

async function writePrivatePayload(directory: string, value: unknown): Promise<string> {
  const path = join(directory, "crash-worker-payload.json");
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.chmod(0o600);
  } finally { await handle.close(); }
  return path;
}

async function verifyNoSourceRules(endpoint: string, bucket: string, credentials: { accessKey: string; secretKey: string }): Promise<void> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error("TASK175_SOURCE_RULE_CHECK_INVALID");
  const client = new Client({ endPoint: url.hostname, port: Number(url.port), useSSL: false, region: "us-east-1",
    ...credentials, retryOptions: { disableRetry: true } });
  try {
    const getReplication = client.getBucketReplication.bind(client) as unknown as (name: string) => Promise<unknown>;
    const response = await getReplication(bucket);
    const outer = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const config = outer["ReplicationConfiguration"];
    const rules = config && typeof config === "object" ? (config as Record<string, unknown>)["rules"] : undefined;
    if (!Array.isArray(rules) || rules.length !== 0) throw new Error("TASK175_SOURCE_RULES_NOT_EMPTY");
  } catch (error) {
    if (error instanceof Error && error.message === "TASK175_SOURCE_RULES_NOT_EMPTY") throw error;
    if (!error || typeof error !== "object" || !("code" in error) ||
        (error as { code?: unknown }).code !== "ReplicationConfigurationNotFoundError") {
      throw new Error("TASK175_SOURCE_RULE_CHECK_FAILED");
    }
  }
}

async function runCrashWorker(input: { payloadPath: string; stateDirectory: string; repositoryRoot: string;
  backupId: string; recorder: ReturnType<typeof createOperationalBackupOperationStateRecorder> }): Promise<void> {
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), "task175-crash-worker.ts");
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, input.payloadPath], {
    cwd: input.repositoryRoot, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const closed = new Promise<NodeJS.Signals | null>(resolvePromise => {
    child.once("close", (_code, signal) => resolvePromise(signal));
  });
  let persistedMayExist = false;
  let killRequested = false;
  const timer = setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 90_000);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object" || Array.isArray(message)) { reject(new Error("TASK175_CRASH_WORKER_PROTOCOL_INVALID")); return; }
        const record = message as Record<string, unknown>;
        if (record.kind === "state" && typeof record.id === "number" && record.state && typeof record.state === "object") {
          const state = record.state as OperationalBackupOperationState;
          void input.recorder.record(state).then(() => {
            if (state.phase === "REPLICATION_MAY_EXIST") persistedMayExist = true;
            child.send?.({ kind: "state-ack", id: record.id, accepted: true });
          }).catch(() => { child.send?.({ kind: "state-ack", id: record.id, accepted: false }); reject(new Error("TASK175_CRASH_STATE_WRITE_FAILED")); });
          return;
        }
        if (record.kind === "add-succeeded" && persistedMayExist && !killRequested) {
          killRequested = true;
          child.kill("SIGKILL");
          resolvePromise();
          return;
        }
        reject(new Error(record.kind === "worker-failed" ? "TASK175_CRASH_WORKER_FAILED" : "TASK175_CRASH_WORKER_PROTOCOL_INVALID"));
      });
      child.once("error", () => reject(new Error("TASK175_CRASH_WORKER_START_FAILED")));
      child.once("exit", (code, signal) => {
        if (!killRequested) reject(new Error("TASK175_CRASH_WORKER_EXITED_EARLY"));
        else if (signal !== "SIGKILL") reject(new Error("TASK175_CRASH_WORKER_SIGNAL_INVALID"));
      });
    });
    const signal = await closed;
    if (!killRequested || signal !== "SIGKILL" || !persistedMayExist) throw new Error("TASK175_CRASH_WORKER_SIGNAL_INVALID");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function privateDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), prefix));
  await chmod(path, 0o700);
  return path;
}

async function verifyMc(path: string): Promise<string> {
  const canonical = await realpath(path);
  const details = await stat(canonical);
  if (canonical !== path || !details.isFile() || (details.mode & 0o111) === 0 ||
      createHash("sha256").update(await readFile(canonical)).digest("hex") !== mcSha256) {
    throw new Error("TASK175_PINNED_MC_INVALID");
  }
  return canonical;
}

async function readBoundTargetCredentials(input: {
  privateRoot: string;
  backupId: string;
  binding: Awaited<ReturnType<typeof readOperationalBackupTargetBinding>>;
}): Promise<{ accessKey: string; secretKey: string }> {
  const expectedPath = join(input.privateRoot, `${input.backupId}.credentials.json`);
  if (input.binding.credentialRef !== `file:${expectedPath}` || dirname(expectedPath) !== input.privateRoot) {
    throw new Error("TASK175_TARGET_CREDENTIAL_BINDING_INVALID");
  }
  const named = await lstat(expectedPath);
  const handle = await open(expectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.() ||
        (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino ||
        opened.dev !== input.binding.credentialFileIdentity.dev ||
        opened.ino !== input.binding.credentialFileIdentity.ino || opened.size > 4096) {
      throw new Error("TASK175_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== input.binding.credentialFileSha256) {
      throw new Error("TASK175_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("TASK175_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "accessKey,secretKey" ||
        typeof record.accessKey !== "string" || record.accessKey.length < 10 || record.accessKey.length > 128 ||
        typeof record.secretKey !== "string" || record.secretKey.length < 32 || record.secretKey.length > 128) {
      throw new Error("TASK175_TARGET_CREDENTIAL_BINDING_INVALID");
    }
    return { accessKey: record.accessKey, secretKey: record.secretKey };
  } finally {
    await handle.close();
  }
}

async function verifySourceRecoveryMetadata(input: {
  path: string;
  endpoint: string;
  bucket: string;
  dataAreaPath: string;
  credentials: { accessKey: string; secretKey: string };
}): Promise<void> {
  const root = dirname(input.dataAreaPath);
  if (dirname(input.path) !== root || resolve(input.dataAreaPath) !== input.dataAreaPath) {
    throw new Error("TASK175_SOURCE_RECOVERY_METADATA_INVALID");
  }
  const [named, rootDetails] = await Promise.all([lstat(input.path), lstat(root)]);
  const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!rootDetails.isDirectory() || rootDetails.uid !== process.getuid?.() || (rootDetails.mode & 0o777) !== 0o700 ||
        !opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.() ||
        (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino || opened.size > 4096) {
      throw new Error("TASK175_SOURCE_RECOVERY_METADATA_INVALID");
    }
    const value = JSON.parse((await handle.readFile()).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("TASK175_SOURCE_RECOVERY_METADATA_INVALID");
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "bucket,credentials,dataAreaPath,endpoint" ||
        record.endpoint !== input.endpoint || record.bucket !== input.bucket || record.dataAreaPath !== input.dataAreaPath ||
        !record.credentials || typeof record.credentials !== "object" || Array.isArray(record.credentials)) {
      throw new Error("TASK175_SOURCE_RECOVERY_METADATA_INVALID");
    }
    const credentials = record.credentials as Record<string, unknown>;
    if (Object.keys(credentials).sort().join(",") !== "accessKey,secretKey" ||
        credentials.accessKey !== input.credentials.accessKey || credentials.secretKey !== input.credentials.secretKey) {
      throw new Error("TASK175_SOURCE_RECOVERY_METADATA_INVALID");
    }
  } finally {
    await handle.close();
  }
}

async function run(): Promise<void> {
  requireConfiguration();
  const pinnedMc = await verifyMc(resolve(mcBinary!));
  const backupId = randomUUID();
  const stateDirectory = await privateDirectory("otid-task175-state-");
  const privateRoot = await privateDirectory("otid-task175-target-");
  const repositoryRoot = await realpath(process.cwd());
  const recorder = createOperationalBackupOperationStateRecorder({ directory: stateDirectory, repositoryRoot });
  await withPinnedMinioSource({ minioBinary: resolve(minioBinary!), async onSourceReady({
    first, second, sourceStore, sourceEndpoint, bucket, sourceCredentials, sourceDataAreaPath, sourceRecoveryMetadataPath,
  }) {
    await verifySourceRecoveryMetadata({ path: sourceRecoveryMetadataPath, endpoint: sourceEndpoint, bucket,
      dataAreaPath: sourceDataAreaPath, credentials: sourceCredentials });
    if (first.versionId === second.versionId || first.storeId !== second.storeId || first.key !== second.key) {
      throw new Error("TASK175_SOURCE_FIXTURE_INVALID");
    }
    const sourceFirst = await sourceStore.read(first);
    const sourceSecond = await sourceStore.read(second);
    if (sourceFirst.byteLength !== first.byteLength || sourceSecond.byteLength !== second.byteLength) {
      throw new Error("TASK175_SOURCE_PM_READ_INVALID");
    }
    const built = buildOperationalBackupManifest({
      backupId,
      createdAt: new Date().toISOString(),
      writeStopConfirmed: true,
      postgresDump: {
        identity: "synthetic-no-postgres-capture",
        sha256: createHash("sha256").update("synthetic-no-postgres-capture").digest("hex"),
        byteLength: 1,
      },
      migrationIdentity: "synthetic-no-postgres-capture",
      pmObjects: [first, second].map(object => ({ storeId: object.storeId, key: object.key,
        versionId: object.versionId, sha256: object.sha256, byteLength: object.byteLength })),
    });
    const sourceCapture = {
      kind: "SOURCE_CAPTURE_EVIDENCE" as const,
      manifest: built.manifest,
      manifestSha256: built.sha256,
      verifiedPmObjectCount: 2,
    };
    const store = { storeId: first.storeId, sourceEndpoint, sourceBucket: bucket, targetBucket: bucket };
    const stateBase = { formatVersion: 1 as const, backupId, manifestSha256: built.sha256, storeIds: [first.storeId] };
    await recorder.record({ formatVersion: 1, backupId, phase: "DUMP_PENDING", manifestSha256: null, storeIds: [] });
    await recorder.record({ ...stateBase, phase: "TARGET_PREPARATION_PENDING" });

    let target: Awaited<ReturnType<typeof provisionPinnedOperationalBackupTarget>>;
    try {
      target = await provisionPinnedOperationalBackupTarget({
        backupId, sourceCapture, operationStateDirectory: stateDirectory, stores: [store],
        privateRoot, repositoryRoot, minioBinary: resolve(minioBinary!),
      });
    } catch (error) {
      if (error instanceof OperationalBackupPinnedTargetError) {
        console.error(`TASK175_TARGET_FAILURE ${error.stage}`);
      }
      throw error;
    }
    try {
      const binding = await readOperationalBackupTargetBinding({ directory: privateRoot, repositoryRoot, backupId });
      if (JSON.stringify(binding) !== JSON.stringify(target.binding) ||
          target.readiness.kind !== "TARGET_READY_EVIDENCE" || target.readiness.backupId !== backupId ||
          target.readiness.manifestSha256 !== built.sha256 || target.readiness.targetId !== binding.targetId ||
          target.readiness.storeIds.length !== 1 || target.readiness.storeIds[0] !== first.storeId ||
          binding.stores.length !== 1 || JSON.stringify(binding.stores[0]) !== JSON.stringify(store)) {
        throw new Error("TASK175_TARGET_BINDING_INVALID");
      }
      const targetCredentials = await readBoundTargetCredentials({ privateRoot, backupId, binding });
      const operationState = await readOperationalBackupOperationState({ directory: stateDirectory, repositoryRoot, backupId });
      if (!operationState || operationState.phase !== "TARGET_PREPARATION_PENDING") {
        throw new Error("TASK175_OPERATION_STATE_INVALID");
      }
      const targetPmReader = createPmObjectStore({ storeId: first.storeId, endpoint: binding.targetEndpoint,
        bucket: bucket, region: "us-east-1", ...targetCredentials, mode: "loopback-development", deadlineMs: 5_000 });
      if (mode === "crash-recovery") {
        const payloadPath = await writePrivatePayload(stateDirectory, {
          backupId, sourceCapture, operationState, readinessEvidence: target.readiness, targetBinding: binding,
          store, sourceCredentials, target: { endpoint: binding.targetEndpoint, region: "us-east-1",
            mode: "loopback-development", ...targetCredentials }, mcBinary: pinnedMc,
        });
        await runCrashWorker({ payloadPath, stateDirectory, repositoryRoot, backupId, recorder });
        const afterCrash = await readOperationalBackupOperationState({ directory: stateDirectory, repositoryRoot, backupId });
        if (afterCrash?.phase !== "REPLICATION_MAY_EXIST" || afterCrash.manifestSha256 !== built.sha256 ||
            afterCrash.storeIds.length !== 1 || afterCrash.storeIds[0] !== first.storeId) {
          throw new Error("TASK175_CRASH_STATE_INVALID");
        }
        await recoverOperationalBackupOperationState({ directory: stateDirectory, repositoryRoot, backupId,
          manifestSha256: built.sha256, storeIds: [first.storeId], originalWorkerStopped: true,
          cleanup: state => cleanupOperationalBackupStore({ backupId, operationState: state,
            targetBinding: binding, store, sourceCredentials, mcBinary: pinnedMc, timeoutMs: 60_000 }) });
        const recovered = await readOperationalBackupOperationState({ directory: stateDirectory, repositoryRoot, backupId });
        if (recovered?.phase !== "CLEANUP_VERIFIED" || recovered.manifestSha256 !== built.sha256 ||
            recovered.storeIds.length !== 1 || recovered.storeIds[0] !== first.storeId) {
          throw new Error("TASK175_CRASH_RECOVERY_STATE_INVALID");
        }
        await verifyNoSourceRules(sourceEndpoint, bucket, sourceCredentials);
        return;
      }
      try {
        await replicateOperationalBackupStore({
          backupId, sourceCapture, operationState, readinessEvidence: target.readiness,
          targetBinding: binding, store, sourceCredentials, target: {
            endpoint: binding.targetEndpoint, region: "us-east-1", mode: "loopback-development", ...targetCredentials,
          }, targetPmReader, mcBinary: pinnedMc, recordOperationState: state => recorder.record(state),
          timeoutMs: 60_000, pollIntervalMs: 250,
        });
      } catch (error) {
        if (error instanceof OperationalBackupReplicationError) {
          console.error(`TASK175_REPLICATION_FAILURE ${error.code}`);
        }
        throw error;
      }
      const finalState = await readOperationalBackupOperationState({ directory: stateDirectory, repositoryRoot, backupId });
      if (finalState?.phase !== "CLEANUP_VERIFIED" || finalState.backupId !== backupId ||
          finalState.manifestSha256 !== built.sha256 || finalState.storeIds.length !== 1 ||
          finalState.storeIds[0] !== first.storeId) {
        throw new Error("TASK175_CLEANUP_EVIDENCE_INVALID");
      }
      await readOperationalBackupPmObject(targetPmReader, built.manifest.pmObjects[0]!);
      await readOperationalBackupPmObject(targetPmReader, built.manifest.pmObjects[1]!);
    } finally {
      await target.stop();
    }
  } });
  if (mode === "crash-recovery") {
    console.log("TASK175 synthetic abrupt-worker recovery passed; SIGKILL followed the persisted replication-risk phase and independent cleanup verified zero source rules. Resync did not start; no target-object/version claim or PostgreSQL capture was made.");
  } else {
    console.log("TASK175 private one-store synthetic replication passed; two exact PM versions verified and the source rule list was empty after cleanup. No PostgreSQL capture or backup/restore proof was performed.");
  }
}

await run();
