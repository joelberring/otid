import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as http from "node:http";
import * as https from "node:https";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import { readOperationalBackupPmObject, type PmObjectReader } from "./operational-backup-object";
import {
  canonicalOperationalBackupManifestBytes,
  normalizeOperationalBackupOperationState,
  operationalBackupManifestSchema,
  type OperationalBackupOperationState
} from "@o-tid/contracts";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const bucket = z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const endpointSchema = z.string().url();
const credentialsSchema = z.object({ accessKey: z.string().min(1).max(256), secretKey: z.string().min(1).max(1024) }).strict();
const storeSchema = z.object({
  storeId: uuid,
  sourceEndpoint: endpointSchema,
  sourceBucket: bucket,
  targetBucket: bucket
}).strict();
const bindingSchema = z.object({
  formatVersion: z.literal(2), backupId: uuid, manifestSha256: sha256, targetId: uuid,
  targetEndpoint: endpointSchema, targetMode: z.enum(["production", "loopback-development"]),
  stores: z.array(storeSchema).min(1)
}).passthrough();
const captureSchema = z.object({
  kind: z.literal("SOURCE_CAPTURE_EVIDENCE"), manifest: operationalBackupManifestSchema,
  manifestSha256: sha256, verifiedPmObjectCount: z.number().int().nonnegative()
}).strict();
const readinessSchema = z.object({
  kind: z.literal("TARGET_READY_EVIDENCE"), backupId: uuid, manifestSha256: sha256, targetId: uuid,
  storeIds: z.array(uuid)
}).strict();
const targetSchema = z.object({
  endpoint: endpointSchema, region: z.string().regex(/^[a-z0-9-]{1,64}$/), mode: z.enum(["production", "loopback-development"]),
  accessKey: z.string().min(1).max(256), secretKey: z.string().min(1).max(1024)
}).strict();

const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Errors contain only a stable code; command output and private configuration are discarded. */
export class OperationalBackupReplicationError extends Error {
  readonly code: OperationalBackupReplicationFailureCode;
  constructor(code: OperationalBackupReplicationFailureCode = "OPERATIONAL_BACKUP_REPLICATION_FAILED") {
    super("OPERATIONAL_BACKUP_REPLICATION_FAILED");
    this.name = "OperationalBackupReplicationError";
    this.code = code;
  }
}

export type OperationalBackupReplicationFailureCode =
  | "OPERATIONAL_BACKUP_REPLICATION_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_ADD_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_RULE_VERIFICATION_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_RESYNC_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_TARGET_VERIFICATION_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_STATE_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULE_READ_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_REMOVE_COMMAND_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_REMOVE_FAILED"
  | "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN";

type Store = z.infer<typeof storeSchema>;
type Credentials = z.infer<typeof credentialsSchema>;
type Target = z.infer<typeof targetSchema>;
type McResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string };
type McRunner = (binary: string, args: string[], environment: NodeJS.ProcessEnv, timeoutMs: number) => Promise<McResult>;
export type OperationalBackupRuleReader = (endpoint: string, credentials: Credentials, bucketName: string, timeoutMs: number) => Promise<unknown[]>;
type RuleReader = OperationalBackupRuleReader;

export type OperationalBackupReplicationInput = {
  backupId: string;
  sourceCapture: unknown;
  operationState: unknown;
  readinessEvidence: unknown;
  targetBinding: unknown;
  store: unknown;
  sourceCredentials: Credentials;
  target: Target;
  targetPmReader: PmObjectReader;
  mcBinary: string;
  recordOperationState(state: OperationalBackupOperationState): Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Deterministic process seam for focused tests. Do not supply in operations. */
  runMc?: McRunner;
  /** Deterministic read seam for focused tests. Do not supply in operations. */
  readRules?: RuleReader;
};

export type OperationalBackupReplicationCleanupInput = {
  backupId: string;
  operationState: unknown;
  targetBinding: unknown;
  store: unknown;
  sourceCredentials: Credentials;
  mcBinary: string;
  timeoutMs?: number;
  /** Deterministic process seam for focused tests. Do not supply in operations. */
  runMc?: McRunner;
  /** Deterministic read seam for focused tests. Do not supply in operations. */
  readRules?: RuleReader;
};

type ParsedInput = Omit<OperationalBackupReplicationInput, "runMc"> & {
  capture: z.infer<typeof captureSchema>;
  state: OperationalBackupOperationState;
  readiness: z.infer<typeof readinessSchema>;
  binding: z.infer<typeof bindingSchema>;
  parsedStore: Store;
  source: Credentials;
  parsedTarget: Target;
  timeout: number;
  interval: number;
  manifestHash: string;
};

function parseCleanupInput(input: OperationalBackupReplicationCleanupInput) {
  try {
    const binding = bindingSchema.parse(input.targetBinding);
    const parsedStore = storeSchema.parse(input.store);
    const source = credentialsSchema.parse(input.sourceCredentials);
    const state = normalizeOperationalBackupOperationState(input.operationState);
    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (input.backupId !== binding.backupId || input.backupId !== state.backupId ||
        binding.manifestSha256 !== state.manifestSha256 || state.phase !== "CLEANUP_REQUIRED" ||
        state.storeIds.length !== 1 || state.storeIds[0] !== parsedStore.storeId ||
        binding.stores.length !== 1 || !sameStore(binding.stores[0]!, parsedStore) ||
        parsedStore.sourceBucket !== parsedStore.targetBucket || !Number.isInteger(timeout) || timeout < 100 || timeout > 60_000 ||
        resolve(input.mcBinary) !== input.mcBinary) return fail();
    normalizedEndpoint(parsedStore.sourceEndpoint, binding.targetMode);
    return { ...input, binding, parsedStore, source, state, timeout };
  } catch { return fail(); }
}

function fail(code?: OperationalBackupReplicationFailureCode): never { throw new OperationalBackupReplicationError(code); }

function sameStore(left: Store, right: Store): boolean {
  return left.storeId === right.storeId && left.sourceEndpoint === right.sourceEndpoint &&
    left.sourceBucket === right.sourceBucket && left.targetBucket === right.targetBucket;
}

function normalizedEndpoint(value: string, mode: Target["mode"]): string {
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1" && process.env.NODE_ENV !== "production";
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/") ||
      (url.protocol !== "https:" && !loopback) || (mode === "loopback-development" && !loopback)) return fail();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

function parseInput(input: OperationalBackupReplicationInput): ParsedInput {
  try {
    const capture = captureSchema.parse(input.sourceCapture);
    const readiness = readinessSchema.parse(input.readinessEvidence);
    const binding = bindingSchema.parse(input.targetBinding);
    const parsedStore = storeSchema.parse(input.store);
    const source = credentialsSchema.parse(input.sourceCredentials);
    const parsedTarget = targetSchema.parse(input.target);
    const state = normalizeOperationalBackupOperationState(input.operationState);
    const manifestHash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(capture.manifest)).digest("hex");
    const storeIds = [...new Set(capture.manifest.pmObjects.map(object => object.storeId))].sort();
    const manifestStores = capture.manifest.pmObjects.filter(object => object.storeId === parsedStore.storeId);
    if (input.backupId !== capture.manifest.backupId || capture.manifestSha256 !== manifestHash ||
        capture.verifiedPmObjectCount !== capture.manifest.pmObjects.length || state.backupId !== input.backupId ||
        state.phase !== "TARGET_PREPARATION_PENDING" || state.manifestSha256 !== manifestHash ||
        JSON.stringify([...state.storeIds].sort()) !== JSON.stringify(storeIds) || storeIds.length !== 1 ||
        storeIds[0] !== parsedStore.storeId || manifestStores.length !== capture.manifest.pmObjects.length ||
        readiness.backupId !== input.backupId || readiness.manifestSha256 !== manifestHash ||
        readiness.targetId !== binding.targetId || JSON.stringify([...readiness.storeIds].sort()) !== JSON.stringify(storeIds) ||
        binding.backupId !== input.backupId || binding.manifestSha256 !== manifestHash ||
        binding.stores.length !== 1 || !sameStore(binding.stores[0]!, parsedStore) ||
        parsedStore.sourceBucket !== parsedStore.targetBucket ||
        normalizedEndpoint(parsedStore.sourceEndpoint, parsedTarget.mode) === normalizedEndpoint(parsedTarget.endpoint, parsedTarget.mode) ||
        normalizedEndpoint(binding.targetEndpoint, binding.targetMode) !== normalizedEndpoint(parsedTarget.endpoint, parsedTarget.mode) ||
        binding.targetMode !== parsedTarget.mode || !resolve(input.mcBinary) || resolve(input.mcBinary) !== input.mcBinary ||
        !Number.isInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (input.timeoutMs ?? DEFAULT_TIMEOUT_MS) < 100 || (input.timeoutMs ?? DEFAULT_TIMEOUT_MS) > 60_000 ||
        !Number.isInteger(input.pollIntervalMs ?? 250) || (input.pollIntervalMs ?? 250) < 10 || (input.pollIntervalMs ?? 250) > 5_000 ||
        !input.targetPmReader || typeof input.targetPmReader.read !== "function" || typeof input.recordOperationState !== "function") return fail();
    return {
      ...input, capture, state, readiness, binding, parsedStore, source, parsedTarget,
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS, interval: input.pollIntervalMs ?? 250, manifestHash
    };
  } catch { return fail(); }
}

function aliasUrl(endpoint: string, credentials: Credentials): string {
  const url = new URL(endpoint);
  url.username = credentials.accessKey;
  url.password = credentials.secretKey;
  return url.toString();
}

function asRule(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}

function ruleFrom(record: Record<string, unknown>): Record<string, unknown> {
  return record;
}

function validateOwnedRule(records: Record<string, unknown>[], ruleId: string, targetBucket: string): string {
  if (records.length !== 1) return fail();
  const rule = ruleFrom(records[0]!);
  const destination = rule?.Destination;
  const existing = rule?.ExistingObjectReplication;
  const id = rule?.ID ?? rule?.Id ?? rule?.id;
  const arn = destination && typeof destination === "object" ? (destination as Record<string, unknown>).Bucket : undefined;
  const status = existing && typeof existing === "object" ? (existing as Record<string, unknown>).Status : undefined;
  if (id !== ruleId || status !== "Enabled" || typeof arn !== "string" ||
      !arn.startsWith("arn:minio:replication::") || !arn.endsWith(`:${targetBucket}`)) return fail();
  return arn;
}

async function runProcess(binary: string, args: string[], environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<McResult> {
  return await new Promise<McResult>((resolvePromise, reject) => {
    let child;
    try { child = spawn(binary, args, { env: environment, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { reject(new OperationalBackupReplicationError()); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: unknown) => {
      if (!(chunk instanceof Uint8Array)) { exceeded = true; child.kill("SIGTERM"); return; }
      size += chunk.byteLength;
      if (size > OUTPUT_LIMIT) { exceeded = true; child.kill("SIGTERM"); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      reject(new OperationalBackupReplicationError());
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (exceeded) { reject(new OperationalBackupReplicationError()); return; }
      resolvePromise({ code, signal, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

async function command(input: ParsedInput, runner: McRunner, env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const result = await runner(input.mcBinary, args, env, input.timeout);
  if (result.code !== 0 || result.signal !== null || Buffer.byteLength(result.stdout, "utf8") > OUTPUT_LIMIT) return fail();
  return result.stdout;
}

async function listRules(input: ParsedInput): Promise<Record<string, unknown>[]> {
  if (input.readRules) return (await input.readRules(input.parsedStore.sourceEndpoint, input.source,
    input.parsedStore.sourceBucket, input.timeout)).map(asRule);
  return readReplicationRules(input.parsedStore.sourceEndpoint, input.source, input.parsedStore.sourceBucket, input.timeout);
}

async function readReplicationRules(endpoint: string, credentials: Credentials, bucketName: string, timeoutMs: number): Promise<Record<string, unknown>[]> {
  try {
    const url = new URL(endpoint);
    const signal = AbortSignal.timeout(timeoutMs);
    const request: typeof http.request = (
      input: string | URL | http.RequestOptions,
      optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
      callback?: (response: http.IncomingMessage) => void
    ) => {
      const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
      const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
      const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
      const req = (url.protocol === "https:" ? https : http).request({ ...options, signal }, listener);
      req.setTimeout(timeoutMs, () => req.destroy(new Error("request timeout")));
      return req;
    };
    const client = new Client({ endPoint: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      useSSL: url.protocol === "https:", region: "us-east-1", accessKey: credentials.accessKey,
      secretKey: credentials.secretKey, pathStyle: true, retryOptions: { disableRetry: true }, transport: { request } });
    const getReplication = client.getBucketReplication.bind(client) as unknown as (name: string) => Promise<unknown>;
    const result = await getReplication(bucketName);
    if (!result || typeof result !== "object") return fail();
    const configuration = (result as Record<string, unknown>).ReplicationConfiguration;
    if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return fail();
    const rules = (configuration as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) return fail();
    return rules.map(asRule);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ReplicationConfigurationNotFoundError") return [];
    return fail();
  }
}

/** Independently reads a source bucket's rule configuration and requires zero rules. */
export async function assertOperationalBackupSourceHasNoReplicationRules(input: {
  store: unknown;
  sourceCredentials: unknown;
  timeoutMs?: number;
  /** Deterministic read seam for focused tests. Do not supply in operations. */
  readRules?: OperationalBackupRuleReader;
}): Promise<void> {
  try {
    const parsedStore = storeSchema.parse(input.store);
    const credentials = credentialsSchema.parse(input.sourceCredentials);
    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60_000) return fail();
    const rules = input.readRules
      ? await input.readRules(parsedStore.sourceEndpoint, credentials, parsedStore.sourceBucket, timeout)
      : await readReplicationRules(parsedStore.sourceEndpoint, credentials, parsedStore.sourceBucket, timeout);
    if (!Array.isArray(rules) || rules.length !== 0) return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN");
  } catch {
    return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULE_READ_FAILED");
  }
}

async function removeOwnedRuleAndConfirmZero(input: {
  backupId: string;
  sourceEndpoint: string;
  sourceCredentials: Credentials;
  sourceBucket: string;
  targetBucket: string;
  readRules?: RuleReader;
  mcBinary: string;
  timeout: number;
}, runner: McRunner, env: NodeJS.ProcessEnv): Promise<void> {
  const sourcePath = `source/${input.sourceBucket}`;
  const read = async () => {
    try {
      const rules = input.readRules
        ? await input.readRules(input.sourceEndpoint, input.sourceCredentials, input.sourceBucket, input.timeout)
        : await readReplicationRules(input.sourceEndpoint, input.sourceCredentials, input.sourceBucket, input.timeout);
      return rules.map(asRule);
    } catch { return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULE_READ_FAILED"); }
  };
  const current = await read();
  const owned = current.filter(record => {
    const rule = ruleFrom(record);
    return rule?.ID === input.backupId || rule?.Id === input.backupId || rule?.id === input.backupId;
  });
  if (current.length > 0 && (current.length !== 1 || owned.length !== 1)) {
    return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN");
  }
  if (owned.length === 1) {
    const rule = ruleFrom(owned[0]!);
    const destination = rule?.Destination;
    const existing = rule?.ExistingObjectReplication;
    const arn = destination && typeof destination === "object" ? (destination as Record<string, unknown>).Bucket : undefined;
    const enabled = existing && typeof existing === "object" && (existing as Record<string, unknown>).Status === "Enabled";
    if (typeof arn !== "string" || !arn.startsWith("arn:minio:replication::") ||
        !arn.endsWith(`:${input.targetBucket}`) || !enabled) return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN");
    let removeErrored = false;
    try {
      const result = await runner(input.mcBinary,
        ["replicate", "remove", "--all", "--force", sourcePath], env, input.timeout);
      if (result.code !== 0 || result.signal !== null) removeErrored = true;
    } catch { removeErrored = true; }
    const after = await read();
    if (removeErrored) return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_REMOVE_COMMAND_FAILED");
    if (after.length !== 0) return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN");
  } else if (current.length !== 0) {
    return fail("OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULES_REMAIN");
  }
}

async function verifyTargetObjects(input: ParsedInput, timeoutSignal: AbortSignal): Promise<void> {
  for (const object of input.capture.manifest.pmObjects) {
    if (timeoutSignal.aborted) return fail();
    await readOperationalBackupPmObject(input.targetPmReader, object, timeoutSignal);
  }
}

/**
 * Replicates one verified private PM store into its bound target, verifies every exact
 * manifest version through the normal PM reader, and removes only its owned rule.
 * State is persisted before add and around cleanup. A process crash can still require
 * a separate recovery invocation; this function does not claim crash recovery.
 */
export async function replicateOperationalBackupStore(input: OperationalBackupReplicationInput): Promise<void> {
  const parsed = parseInput(input);
  const runner = input.runMc ?? runProcess;
  const configDirectory = await mkdtemp(join(tmpdir(), "otid-replication-mc-"));
  let ruleMayExist = false;
  let cleanupStateWritten = false;
  let primaryFailed = false;
  let primaryFailureCode: OperationalBackupReplicationFailureCode = "OPERATIONAL_BACKUP_REPLICATION_FAILED";
  let activeStage: OperationalBackupReplicationFailureCode = "OPERATIONAL_BACKUP_REPLICATION_FAILED";
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    MC_CONFIG_DIR: configDirectory,
    MC_HOST_source: aliasUrl(parsed.parsedStore.sourceEndpoint, parsed.source),
    MC_HOST_target: aliasUrl(parsed.parsedTarget.endpoint, parsed.parsedTarget)
  };
  const controller = new AbortController();
  const operationDeadline = setTimeout(() => controller.abort(), parsed.timeout);
  const ruleId = parsed.backupId;
  const sourcePath = `source/${parsed.parsedStore.sourceBucket}`;
  try {
    await chmod(configDirectory, 0o700);
    const before = await listRules(parsed);
    if (before.length !== 0) return fail();
    await parsed.recordOperationState({
      formatVersion: 1, backupId: parsed.backupId, phase: "REPLICATION_MAY_EXIST",
      manifestSha256: parsed.manifestHash, storeIds: [parsed.parsedStore.storeId]
    });
    ruleMayExist = true;
    activeStage = "OPERATIONAL_BACKUP_REPLICATION_ADD_FAILED";
    await command(parsed, runner, environment, ["replicate", "add", "--id", ruleId,
      "--remote-bucket", `target/${parsed.parsedStore.targetBucket}`, "--replicate", "existing-objects", sourcePath]);
    activeStage = "OPERATIONAL_BACKUP_REPLICATION_RULE_VERIFICATION_FAILED";
    const listed = await listRules(parsed);
    const targetArn = validateOwnedRule(listed, ruleId, parsed.parsedStore.targetBucket);
    activeStage = "OPERATIONAL_BACKUP_REPLICATION_RESYNC_FAILED";
    await command(parsed, runner, environment, ["replicate", "resync", "start", "--remote-bucket", targetArn, sourcePath]);

    activeStage = "OPERATIONAL_BACKUP_REPLICATION_TARGET_VERIFICATION_FAILED";
    let verified = false;
    while (!controller.signal.aborted) {
      try {
        await verifyTargetObjects(parsed, controller.signal);
        verified = true;
        break;
      } catch {
        if (controller.signal.aborted) break;
        await delay(parsed.interval, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    }
    if (!verified) return fail();
  } catch {
    primaryFailed = true;
    primaryFailureCode = activeStage;
  } finally {
    clearTimeout(operationDeadline);
    if (ruleMayExist) {
      try {
        await parsed.recordOperationState({
          formatVersion: 1, backupId: parsed.backupId, phase: "CLEANUP_REQUIRED",
          manifestSha256: parsed.manifestHash, storeIds: [parsed.parsedStore.storeId]
        });
        cleanupStateWritten = true;
      } catch {
        primaryFailed = true;
        primaryFailureCode = "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_STATE_FAILED";
      }
      try {
        await removeOwnedRuleAndConfirmZero({ backupId: ruleId, sourceEndpoint: parsed.parsedStore.sourceEndpoint,
          sourceCredentials: parsed.source, sourceBucket: parsed.parsedStore.sourceBucket,
          targetBucket: parsed.parsedStore.targetBucket, ...(input.readRules ? { readRules: input.readRules } : {}),
          mcBinary: parsed.mcBinary, timeout: parsed.timeout }, runner, environment);
        if (cleanupStateWritten) {
          await parsed.recordOperationState({
            formatVersion: 1, backupId: parsed.backupId, phase: "CLEANUP_VERIFIED",
            manifestSha256: parsed.manifestHash, storeIds: [parsed.parsedStore.storeId]
          });
        }
      } catch (error) {
        primaryFailed = true;
        primaryFailureCode = error instanceof OperationalBackupReplicationError
          ? error.code : "OPERATIONAL_BACKUP_REPLICATION_CLEANUP_RULE_READ_FAILED";
      }
    }
    await rm(configDirectory, { recursive: true, force: true }).catch(() => { primaryFailed = true; });
  }
  if (primaryFailed) return fail(primaryFailureCode);
}

/** Recovery-only cleanup. It never adds or resyncs rules and never advances private state. */
export async function cleanupOperationalBackupStore(input: OperationalBackupReplicationCleanupInput): Promise<void> {
  const parsed = parseCleanupInput(input);
  const runner = input.runMc ?? runProcess;
  const configDirectory = await mkdtemp(join(tmpdir(), "otid-replication-cleanup-"));
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    MC_CONFIG_DIR: configDirectory,
    MC_HOST_source: aliasUrl(parsed.parsedStore.sourceEndpoint, parsed.source)
  };
  let failed = false;
  try {
    await chmod(configDirectory, 0o700);
    await removeOwnedRuleAndConfirmZero({ backupId: parsed.backupId,
      sourceEndpoint: parsed.parsedStore.sourceEndpoint, sourceCredentials: parsed.source,
      sourceBucket: parsed.parsedStore.sourceBucket, targetBucket: parsed.parsedStore.targetBucket,
      ...(input.readRules ? { readRules: input.readRules } : {}),
      mcBinary: parsed.mcBinary, timeout: parsed.timeout }, runner, environment);
  } catch {
    failed = true;
  } finally {
    await rm(configDirectory, { recursive: true, force: true }).catch(() => { failed = true; });
  }
  if (failed) return fail();
}
