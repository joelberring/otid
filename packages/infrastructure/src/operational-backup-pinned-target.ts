import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import * as http from "node:http";
import { urlToHttpOptions } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "minio";
import {
  canonicalOperationalBackupManifestBytes,
  normalizeOperationalBackupOperationState,
  operationalBackupManifestSchema
} from "@o-tid/contracts";
import { z } from "zod";
import { readOperationalBackupTargetBinding, writeOperationalBackupTargetBinding } from "./operational-backup-target-binding";
import { verifyOperationalBackupTargetReadiness } from "./operational-backup-target-readiness";
import { readOperationalBackupOperationState } from "./operational-backup-operation-state";
import type { PmObjectReader } from "./operational-backup-object";
import { createPmObjectStore } from "./pm-object-store";

const PINNED_MINIO_SHA256 = "0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641";
const S3_READINESS_DEADLINE_MS = 10_000;
const S3_READINESS_REQUEST_TIMEOUT_MS = 1_000;
const S3_READINESS_RETRY_DELAY_MS = 100;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const bucket = z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/);
const storeInput = z.object({
  storeId: uuid, sourceEndpoint: z.string().url(), sourceBucket: bucket, targetBucket: bucket
}).strict();

export type PinnedOperationalBackupTargetInput = {
  backupId: string;
  sourceCapture: unknown;
  operationStateDirectory: string;
  stores: unknown;
  privateRoot: string;
  repositoryRoot: string;
  minioBinary: string;
  requestTimeoutMs?: number;
  /** Internal deterministic fault-injection seam; never use for operational calls. */
  testCheckpoint?: (checkpoint: "reservation-created" | "binding-synced") => Promise<void>;
};

export type PinnedOperationalBackupTargetHandle = {
  binding: Awaited<ReturnType<typeof readOperationalBackupTargetBinding>>;
  readiness: Awaited<ReturnType<typeof verifyOperationalBackupTargetReadiness>>;
  stop(): Promise<void>;
};

export type CompletedPinnedOperationalBackupTargetInput = {
  backupId: string;
  completion: {
    backupId: string;
    manifestSha256: string;
    verifiedPmObjectCount: number;
    manifest: unknown;
    targetId: string;
    targetBindingSha256: string;
  };
  operationStateDirectory: string;
  privateRoot: string;
  repositoryRoot: string;
  minioBinary: string;
};

export type CompletedPinnedOperationalBackupTargetHandle = {
  binding: TargetBinding;
  targetPmReader: PmObjectReader;
  stop(): Promise<void>;
};

export type OperationalBackupPinnedTargetFailureStage =
  | "VALIDATION"
  | "PRIVATE_ROOT_CHECK"
  | "PINNED_BINARY_CHECK"
  | "RESERVATION"
  | "TARGET_BINDING"
  | "FIRST_START_MARKER"
  | "MINIO_START"
  | "S3_READINESS"
  | "BUCKET_CREATION"
  | "BUCKET_VERSIONING"
  | "TASK173_READINESS"
  | "READY_MARKER";

export class OperationalBackupPinnedTargetError extends Error {
  readonly stage: OperationalBackupPinnedTargetFailureStage;
  constructor(stage: OperationalBackupPinnedTargetFailureStage = "VALIDATION") {
    super("OPERATIONAL_BACKUP_PINNED_TARGET_FAILED");
    this.name = "OperationalBackupPinnedTargetError";
    this.stage = stage;
  }
}

function fail(): never { throw new OperationalBackupPinnedTargetError(); }
function uid(): number { const value = process.getuid?.(); return value === undefined ? fail() : value; }

function validate(input: PinnedOperationalBackupTargetInput, operationState: unknown) {
  const capture = z.object({
    kind: z.literal("SOURCE_CAPTURE_EVIDENCE"),
    manifest: operationalBackupManifestSchema,
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    verifiedPmObjectCount: z.number().int().nonnegative()
  }).strict().parse(input.sourceCapture);
  const state = normalizeOperationalBackupOperationState(operationState);
  const stores = z.array(storeInput).min(1).max(100_000).parse(input.stores).sort((a, b) => a.storeId.localeCompare(b.storeId));
  const manifestHash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(capture.manifest)).digest("hex");
  const storeIds = [...new Set(capture.manifest.pmObjects.map(item => item.storeId))].sort();
  if (input.backupId !== capture.manifest.backupId || capture.manifestSha256 !== manifestHash ||
      capture.verifiedPmObjectCount !== capture.manifest.pmObjects.length || state.backupId !== input.backupId ||
      state.phase !== "TARGET_PREPARATION_PENDING" || state.manifestSha256 !== manifestHash ||
      JSON.stringify([...state.storeIds].sort()) !== JSON.stringify(storeIds) ||
      JSON.stringify(stores.map(s => s.storeId)) !== JSON.stringify(storeIds) ||
      stores.some(s => s.sourceBucket !== s.targetBucket) ||
      stores.some(s => !capture.manifest.pmObjects.some(o => o.storeId === s.storeId))) return fail();
  for (const store of stores) {
    let source: URL;
    try { source = new URL(store.sourceEndpoint); } catch { return fail(); }
    const loopback = source.protocol === "http:" && source.hostname === "127.0.0.1" && process.env.NODE_ENV !== "production";
    if (source.username || source.password || source.search || source.hash || (source.protocol !== "https:" && !loopback) ||
        (source.pathname !== "" && source.pathname !== "/")) return fail();
  }
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.env.NODE_ENV === "production" ||
      !resolve(input.privateRoot) || resolve(input.privateRoot) !== input.privateRoot ||
      !resolve(input.repositoryRoot) || !resolve(input.minioBinary) || resolve(input.minioBinary) !== input.minioBinary) return fail();
  return { capture, state, stores, manifestHash };
}

async function verifyRoot(root: string, repo: string): Promise<void> {
  const [canonicalRoot, canonicalRepo] = await Promise.all([realpath(root), realpath(repo)]);
  const details = await lstat(root);
  if (canonicalRoot !== root || (root === canonicalRepo || root.startsWith(`${canonicalRepo}/`)) ||
      !details.isDirectory() || details.uid !== uid() || (details.mode & 0o777) !== 0o700) return fail();
}

async function verifyBinary(path: string): Promise<void> {
  const canonical = await realpath(path);
  const details = await stat(canonical);
  if (canonical !== path || !details.isFile() || (details.mode & 0o111) === 0 ||
      createHash("sha256").update(await readFile(path)).digest("hex") !== PINNED_MINIO_SHA256) return fail();
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") return fail();
  await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function assertPortFree(port: number): Promise<void> {
  const server = createServer();
  try {
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolvePromise);
    });
    await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  } catch {
    try { server.close(); } catch { /* A failed listen has nothing to close. */ }
    return fail();
  }
}

async function writePrivateNew(path: string, value: Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(value); await handle.sync(); await handle.chmod(0o600); }
  finally { await handle.close(); }
}

type TargetBinding = Awaited<ReturnType<typeof readOperationalBackupTargetBinding>>;
type TargetLifecycleMarker = {
  formatVersion: 1;
  backupId: string;
  targetId: string;
  manifestSha256: string;
  bindingSha256: string;
};

function lifecycleMarker(binding: TargetBinding): TargetLifecycleMarker {
  return {
    formatVersion: 1,
    backupId: binding.backupId,
    targetId: binding.targetId,
    manifestSha256: binding.manifestSha256,
    bindingSha256: createHash("sha256").update(JSON.stringify(binding)).digest("hex")
  };
}

function lifecyclePath(root: string, backupId: string, kind: "started" | "ready"): string {
  return join(root, `${backupId}.target-${kind}.json`);
}

async function syncPrivateRoot(root: string): Promise<void> {
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function hasLifecycleMarker(root: string, binding: TargetBinding, kind: "started" | "ready"): Promise<boolean> {
  const path = lifecyclePath(root, binding.backupId, kind);
  try {
    const named = await lstat(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.uid !== uid() || (actual.mode & 0o777) !== 0o600 ||
          actual.dev !== named.dev || actual.ino !== named.ino || actual.size > 4096) return fail();
      const marker = JSON.parse((await handle.readFile()).toString("utf8")) as unknown;
      if (JSON.stringify(marker) !== JSON.stringify(lifecycleMarker(binding))) return fail();
      return true;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof OperationalBackupPinnedTargetError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    return fail();
  }
}

async function writeLifecycleMarker(root: string, binding: TargetBinding, kind: "started" | "ready"): Promise<void> {
  await writePrivateNew(lifecyclePath(root, binding.backupId, kind), new TextEncoder().encode(`${JSON.stringify(lifecycleMarker(binding))}\n`));
  await syncPrivateRoot(root);
}

async function beginFirstTargetStart(root: string, binding: TargetBinding): Promise<void> {
  const [started, ready] = await Promise.all([
    hasLifecycleMarker(root, binding, "started"),
    hasLifecycleMarker(root, binding, "ready")
  ]);
  if (started || ready || (await readdir(binding.dataAreaPath)).length !== 0) return fail();
  // Once this marker is durable, any interrupted/partial MinIO initialization is fail-closed.
  await writeLifecycleMarker(root, binding, "started");
}

async function finishFirstTargetStart(root: string, binding: TargetBinding): Promise<void> {
  const started = await hasLifecycleMarker(root, binding, "started");
  const ready = await hasLifecycleMarker(root, binding, "ready");
  if (!started || ready) return fail();
  await writeLifecycleMarker(root, binding, "ready");
}

type Credentials = { accessKey: string; secretKey: string };
type PrivateCredentials = { credentials: Credentials; identity: { dev: number; ino: number }; sha256: string };
async function readCredentials(path: string, expected?: { identity: { dev: number; ino: number }; sha256: string }): Promise<PrivateCredentials> {
  try {
    const named = await lstat(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.uid !== uid() || (actual.mode & 0o777) !== 0o600 ||
          actual.dev !== named.dev || actual.ino !== named.ino || actual.size > 4096) return fail();
      const bytes = await handle.readFile();
      const identity = { dev: actual.dev, ino: actual.ino };
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (expected && (identity.dev !== expected.identity.dev || identity.ino !== expected.identity.ino || sha256 !== expected.sha256)) return fail();
      const credentials = z.object({ accessKey: z.string().min(10).max(128), secretKey: z.string().min(32).max(128) }).strict()
        .parse(JSON.parse(bytes.toString("utf8")));
      return { credentials, identity, sha256 };
    } finally { await handle.close(); }
  } catch { return fail(); }
}

async function startMinio(binary: string, data: string, endpoint: string, credentials: Credentials): Promise<{ child: ChildProcess; stop(): Promise<void> }> {
  const port = Number(new URL(endpoint).port);
  // Never adopt a surviving or unrelated process already serving this endpoint.
  await assertPortFree(port);
  let consolePort = await freePort();
  while (consolePort === port) consolePort = await freePort();
  let child: ChildProcess;
  try {
    child = spawn(binary, ["server", data, "--address", `127.0.0.1:${port}`, "--console-address", `127.0.0.1:${consolePort}`, "--quiet"], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", MINIO_ROOT_USER: credentials.accessKey,
        MINIO_ROOT_PASSWORD: credentials.secretKey, MINIO_BROWSER: "off", MINIO_UPDATE: "off" },
      // The pinned local probe persists no child output, so no credential can reach a log.
      stdio: ["ignore", "ignore", "ignore"]
    });
  } catch {
    return fail();
  }
  let exited = false;
  const exitPromise = new Promise<void>(resolvePromise => {
    child.once("error", () => { exited = true; resolvePromise(); });
    child.once("exit", () => { exited = true; resolvePromise(); });
  });
  const stop = async () => {
    if (!exited) {
      child.kill("SIGTERM");
      const outcome = await Promise.race([exitPromise.then(() => "exit" as const), delay(10_000).then(() => "timeout" as const)]);
      if (outcome === "timeout") { child.kill("SIGKILL"); await exitPromise; }
    }
  };
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (exited || child.exitCode !== null || child.signalCode !== null) return fail();
      try {
        const response = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(500) });
        await response.arrayBuffer();
        if (response.status === 200 && !exited) return { child, stop };
      } catch { /* readiness retry */ }
      await delay(100);
    }
    return fail();
  } catch (error) { await stop().catch(() => undefined); throw error; }
}

function createTargetClient(endpoint: string, credentials: Credentials, timeoutMs: number): Client {
  const url = new URL(endpoint);
  const request: typeof http.request = (input: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void) => {
    const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
    const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
    const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const req = http.request({ ...options, timeout: timeoutMs }, listener);
    const timeout = setTimeout(() => req.destroy(new Error("request timeout")), timeoutMs);
    req.once("close", () => clearTimeout(timeout));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request timeout")));
    return req;
  };
  return new Client({ endPoint: url.hostname, port: Number(url.port), useSSL: false, region: "us-east-1",
    accessKey: credentials.accessKey, secretKey: credentials.secretKey, pathStyle: true, retryOptions: { disableRetry: true }, transport: { request } });
}

async function waitForS3Readiness(endpoint: string, credentials: Credentials): Promise<void> {
  const client = createTargetClient(endpoint, credentials, S3_READINESS_REQUEST_TIMEOUT_MS);
  const deadline = Date.now() + S3_READINESS_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      await client.listBuckets();
      return;
    } catch {
      // A healthy process can still be initializing its authenticated S3 API.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(S3_READINESS_RETRY_DELAY_MS, remaining));
  }
  throw new OperationalBackupPinnedTargetError("S3_READINESS");
}

async function configureBuckets(
  endpoint: string,
  credentials: Credentials,
  names: string[],
  setStage: (stage: OperationalBackupPinnedTargetFailureStage) => void
): Promise<void> {
  const client = createTargetClient(endpoint, credentials, 10_000);
  for (const name of names) {
    setStage("BUCKET_CREATION");
    await client.makeBucket(name, "us-east-1");
    setStage("BUCKET_VERSIONING");
    await client.setBucketVersioning(name, { Status: "Enabled" });
  }
}

async function verifyBuckets(
  endpoint: string,
  credentials: Credentials,
  expected: string[],
  setStage: (stage: OperationalBackupPinnedTargetFailureStage) => void
): Promise<void> {
  const client = createTargetClient(endpoint, credentials, 10_000);
  setStage("BUCKET_CREATION");
  const actual = (await client.listBuckets()).map(item => item.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) return fail();
  for (const name of expected) {
    setStage("BUCKET_VERSIONING");
    const versioning = await client.getBucketVersioning(name);
    if (versioning?.Status !== "Enabled") return fail();
  }
}

function validateCompletedTarget(input: CompletedPinnedOperationalBackupTargetInput, operationState: unknown) {
  const completion = z.object({
    formatVersion: z.literal(1),
    backupId: uuid,
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    verifiedPmObjectCount: z.number().int().positive(),
    manifest: operationalBackupManifestSchema,
    targetId: uuid,
    targetBindingSha256: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict().parse(input.completion);
  const manifest = completion.manifest;
  const state = normalizeOperationalBackupOperationState(operationState);
  const manifestHash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
  const storeIds = [...new Set(manifest.pmObjects.map(object => object.storeId))].sort();
  if (completion.backupId !== input.backupId || manifest.backupId !== input.backupId ||
      completion.manifestSha256 !== manifestHash || completion.verifiedPmObjectCount !== manifest.pmObjects.length ||
      state.backupId !== input.backupId || state.phase !== "CLEANUP_VERIFIED" || state.manifestSha256 !== manifestHash ||
      JSON.stringify([...state.storeIds].sort()) !== JSON.stringify(storeIds) || storeIds.length !== 1 ||
      process.platform !== "darwin" || process.arch !== "arm64" || process.env.NODE_ENV === "production" ||
      resolve(input.privateRoot) !== input.privateRoot || resolve(input.repositoryRoot) !== input.repositoryRoot ||
      resolve(input.minioBinary) !== input.minioBinary) return fail();
  return { completion, manifest, manifestHash, state, storeIds };
}

/** Creates a new private pinned MinIO target, persists its binding before start, then proves TASK173 readiness. */
export async function provisionPinnedOperationalBackupTarget(input: PinnedOperationalBackupTargetInput): Promise<PinnedOperationalBackupTargetHandle> {
  const state = await readOperationalBackupOperationState({ directory: input.operationStateDirectory, repositoryRoot: input.repositoryRoot, backupId: input.backupId });
  const parsed = validate(input, state);
  let child: Awaited<ReturnType<typeof startMinio>> | undefined;
  let stage: OperationalBackupPinnedTargetFailureStage = "PRIVATE_ROOT_CHECK";
  try {
    await verifyRoot(input.privateRoot, input.repositoryRoot);
    stage = "PINNED_BINARY_CHECK";
    await verifyBinary(input.minioBinary);
    stage = "RESERVATION";
    const reservation = join(input.privateRoot, `${input.backupId}.reservation`);
    await mkdir(reservation, { mode: 0o700 }); // exclusive reservation; retained after failures
    await chmod(reservation, 0o700);
    await input.testCheckpoint?.("reservation-created");
    stage = "TARGET_BINDING";
    const targetId = randomUUID();
    const dataAreaPath = join(input.privateRoot, `${input.backupId}.${targetId}.data`);
    await mkdir(dataAreaPath, { mode: 0o700 });
    await chmod(dataAreaPath, 0o700);
    const dataArea = await stat(dataAreaPath);
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    const credentialPath = join(input.privateRoot, `${input.backupId}.credentials.json`);
    const credentials = { accessKey: `otid${randomBytes(18).toString("hex")}`, secretKey: randomBytes(32).toString("hex") };
    await writePrivateNew(credentialPath, new TextEncoder().encode(`${JSON.stringify(credentials)}\n`));
    const credentialFile = await readCredentials(credentialPath);
    const binding = await writeOperationalBackupTargetBinding({ directory: input.privateRoot, repositoryRoot: input.repositoryRoot, binding: {
      formatVersion: 2, backupId: input.backupId, manifestSha256: parsed.manifestHash, targetId, targetEndpoint: endpoint,
      targetMode: "loopback-development", dataAreaPath, dataAreaIdentity: { dev: dataArea.dev, ino: dataArea.ino },
      credentialFileIdentity: credentialFile.identity, credentialFileSha256: credentialFile.sha256,
      credentialRef: `file:${credentialPath}`, stores: parsed.stores
    } });
    const persisted = await readOperationalBackupTargetBinding({ directory: input.privateRoot, repositoryRoot: input.repositoryRoot, backupId: input.backupId });
    if (JSON.stringify(binding) !== JSON.stringify(persisted)) return fail();
    await input.testCheckpoint?.("binding-synced");
    const reloadedCredentials = credentialFile.credentials;
    stage = "FIRST_START_MARKER";
    await beginFirstTargetStart(input.privateRoot, persisted);
    stage = "MINIO_START";
    child = await startMinio(input.minioBinary, dataAreaPath, persisted.targetEndpoint, reloadedCredentials);
    stage = "S3_READINESS";
    await waitForS3Readiness(persisted.targetEndpoint, reloadedCredentials);
    await configureBuckets(persisted.targetEndpoint, reloadedCredentials,
      [...new Set(persisted.stores.map(s => s.targetBucket))].sort(), value => { stage = value; });
    stage = "TASK173_READINESS";
    const readiness = await verifyOperationalBackupTargetReadiness({
      sourceCapture: parsed.capture, operationState: parsed.state, backupId: input.backupId,
      targetFreshnessAttestation: { backupId: input.backupId, targetId: persisted.targetId, freshlyProvisioned: true, exclusive: true },
      target: { endpoint: persisted.targetEndpoint, region: "us-east-1", ...reloadedCredentials, mode: "loopback-development", requestTimeoutMs: input.requestTimeoutMs },
      stores: persisted.stores
    });
    stage = "READY_MARKER";
    await finishFirstTargetStart(input.privateRoot, persisted);
    return { binding: persisted, readiness, stop: () => child!.stop() };
  } catch {
    if (child) await child.stop().catch(() => undefined);
    throw new OperationalBackupPinnedTargetError(stage);
  }
}

/** Restarts only the exact previously bound data area; busy endpoints fail closed. */
export async function resumePinnedOperationalBackupTarget(input: Omit<PinnedOperationalBackupTargetInput, "minioBinary"> & { minioBinary: string }): Promise<PinnedOperationalBackupTargetHandle> {
  const state = await readOperationalBackupOperationState({ directory: input.operationStateDirectory, repositoryRoot: input.repositoryRoot, backupId: input.backupId });
  const parsed = validate(input, state);
  let child: Awaited<ReturnType<typeof startMinio>> | undefined;
  let stage: OperationalBackupPinnedTargetFailureStage = "PRIVATE_ROOT_CHECK";
  try {
    await verifyRoot(input.privateRoot, input.repositoryRoot);
    stage = "PINNED_BINARY_CHECK";
    await verifyBinary(input.minioBinary);
    stage = "TARGET_BINDING";
    const binding = await readOperationalBackupTargetBinding({ directory: input.privateRoot, repositoryRoot: input.repositoryRoot, backupId: input.backupId });
    const reservationStat = await lstat(join(input.privateRoot, `${input.backupId}.reservation`));
    if (!reservationStat.isDirectory() || reservationStat.uid !== uid() || (reservationStat.mode & 0o777) !== 0o700 ||
        binding.manifestSha256 !== parsed.manifestHash || JSON.stringify(binding.stores) !== JSON.stringify(parsed.stores)) return fail();
    const credentialPath = binding.credentialRef.startsWith("file:") ? binding.credentialRef.slice(5) : fail();
    if (dirname(credentialPath) !== input.privateRoot || !credentialPath.endsWith(`${input.backupId}.credentials.json`)) return fail();
    const credentialFile = await readCredentials(credentialPath, { identity: binding.credentialFileIdentity, sha256: binding.credentialFileSha256 });
    const credentials = credentialFile.credentials;
    const [started, ready] = await Promise.all([
      hasLifecycleMarker(input.privateRoot, binding, "started"),
      hasLifecycleMarker(input.privateRoot, binding, "ready")
    ]);
    if (started !== ready) return fail();
    const bootstrap = !started && !ready;
    if (bootstrap) await beginFirstTargetStart(input.privateRoot, binding);
    stage = "MINIO_START";
    child = await startMinio(input.minioBinary, binding.dataAreaPath, binding.targetEndpoint, credentials);
    stage = "S3_READINESS";
    await waitForS3Readiness(binding.targetEndpoint, credentials);
    const bucketNames = [...new Set(binding.stores.map(s => s.targetBucket))].sort();
    if (bootstrap) {
      await configureBuckets(binding.targetEndpoint, credentials, bucketNames, value => { stage = value; });
    } else {
      await verifyBuckets(binding.targetEndpoint, credentials, bucketNames, value => { stage = value; });
    }
    const persisted = await readOperationalBackupTargetBinding({ directory: input.privateRoot, repositoryRoot: input.repositoryRoot, backupId: input.backupId });
    if (JSON.stringify(persisted) !== JSON.stringify(binding)) return fail();
    const readiness = await verifyOperationalBackupTargetReadiness({
      sourceCapture: parsed.capture, operationState: parsed.state, backupId: input.backupId,
      targetFreshnessAttestation: { backupId: input.backupId, targetId: persisted.targetId, freshlyProvisioned: true, exclusive: true },
      target: { endpoint: persisted.targetEndpoint, region: "us-east-1", ...credentials, mode: "loopback-development", requestTimeoutMs: input.requestTimeoutMs },
      stores: persisted.stores
    });
    if (bootstrap) await finishFirstTargetStart(input.privateRoot, persisted);
    return { binding: persisted, readiness, stop: () => child!.stop() };
  } catch (error) {
    if (child) await child.stop().catch(() => undefined);
    if (error instanceof OperationalBackupPinnedTargetError) throw error;
    throw new OperationalBackupPinnedTargetError(stage);
  }
}

/** Reopens only a completed, immutable target for exact-version PM reads. */
export async function openCompletedPinnedOperationalBackupTarget(
  input: CompletedPinnedOperationalBackupTargetInput
): Promise<CompletedPinnedOperationalBackupTargetHandle> {
  let child: Awaited<ReturnType<typeof startMinio>> | undefined;
  let stage: OperationalBackupPinnedTargetFailureStage = "VALIDATION";
  try {
    const state = await readOperationalBackupOperationState({
      directory: input.operationStateDirectory, repositoryRoot: input.repositoryRoot, backupId: input.backupId
    });
    const parsed = validateCompletedTarget(input, state);
    stage = "PRIVATE_ROOT_CHECK";
    await verifyRoot(input.privateRoot, input.repositoryRoot);
    stage = "PINNED_BINARY_CHECK";
    await verifyBinary(input.minioBinary);
    stage = "TARGET_BINDING";
    const binding = await readOperationalBackupTargetBinding({
      directory: input.privateRoot, repositoryRoot: input.repositoryRoot, backupId: input.backupId
    });
    const bindingHash = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    if (bindingHash !== parsed.completion.targetBindingSha256 || binding.backupId !== input.backupId ||
        binding.targetId !== parsed.completion.targetId || binding.manifestSha256 !== parsed.manifestHash ||
        binding.stores.length !== 1 || binding.stores[0]?.storeId !== parsed.storeIds[0] ||
        parsed.manifest.pmObjects.some(object => object.storeId !== binding.stores[0]?.storeId) ||
        binding.targetMode !== "loopback-development") return fail();
    const reservation = await lstat(join(input.privateRoot, `${input.backupId}.reservation`));
    if (!reservation.isDirectory() || reservation.uid !== uid() || (reservation.mode & 0o777) !== 0o700) return fail();
    const credentialPath = binding.credentialRef.startsWith("file:") ? binding.credentialRef.slice(5) : fail();
    if (dirname(credentialPath) !== input.privateRoot || !credentialPath.endsWith(`${input.backupId}.credentials.json`)) return fail();
    const credentialFile = await readCredentials(credentialPath, {
      identity: binding.credentialFileIdentity, sha256: binding.credentialFileSha256
    });
    const [started, ready] = await Promise.all([
      hasLifecycleMarker(input.privateRoot, binding, "started"),
      hasLifecycleMarker(input.privateRoot, binding, "ready")
    ]);
    if (!started || !ready) return fail();

    stage = "MINIO_START";
    child = await startMinio(input.minioBinary, binding.dataAreaPath, binding.targetEndpoint, credentialFile.credentials);
    stage = "S3_READINESS";
    await waitForS3Readiness(binding.targetEndpoint, credentialFile.credentials);
    await verifyBuckets(binding.targetEndpoint, credentialFile.credentials,
      [...new Set(binding.stores.map(store => store.targetBucket))].sort(), value => { stage = value; });

    const targetPmReader: PmObjectReader = createPmObjectStore({
      storeId: binding.stores[0]!.storeId,
      endpoint: binding.targetEndpoint,
      bucket: binding.stores[0]!.targetBucket,
      region: "us-east-1",
      ...credentialFile.credentials,
      mode: "loopback-development",
      deadlineMs: 5_000
    });
    const persisted = await readOperationalBackupTargetBinding({
      directory: input.privateRoot, repositoryRoot: input.repositoryRoot,
      backupId: input.backupId, expected: binding
    });
    if (createHash("sha256").update(JSON.stringify(persisted)).digest("hex") !== bindingHash) return fail();
    return { binding: persisted, targetPmReader, stop: () => child!.stop() };
  } catch (error) {
    if (child) await child.stop().catch(() => undefined);
    if (error instanceof OperationalBackupPinnedTargetError) throw error;
    throw new OperationalBackupPinnedTargetError(stage);
  }
}
