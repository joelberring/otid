import * as http from "node:http";
import * as https from "node:https";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import {
  canonicalOperationalBackupManifestBytes,
  normalizeOperationalBackupOperationState,
  operationalBackupManifestSchema
} from "@o-tid/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const storeSchema = z.object({
  storeId: uuid,
  sourceEndpoint: z.string().url(),
  sourceBucket: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
  targetBucket: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/)
}).strict();
const targetSchema = z.object({
  endpoint: z.string().url(),
  region: z.string().regex(/^[a-z0-9-]{1,64}$/),
  accessKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(1024),
  mode: z.enum(["production", "loopback-development"]),
  requestTimeoutMs: z.number().int().min(100).max(60_000).default(5_000)
}).strict();
const inputSchema = z.object({
  sourceCapture: z.object({
    kind: z.literal("SOURCE_CAPTURE_EVIDENCE"),
    manifest: operationalBackupManifestSchema,
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    verifiedPmObjectCount: z.number().int().nonnegative()
  }).strict(),
  operationState: z.unknown(),
  backupId: uuid,
  targetFreshnessAttestation: z.object({
    backupId: uuid,
    targetId: uuid,
    freshlyProvisioned: z.literal(true),
    exclusive: z.literal(true)
  }).strict(),
  target: targetSchema,
  stores: z.array(storeSchema).min(1).max(100_000)
}).strict();

export type OperationalBackupTargetReadinessEvidence = {
  kind: "TARGET_READY_EVIDENCE";
  backupId: string;
  manifestSha256: string;
  targetId: string;
  storeIds: string[];
};

/** Errors intentionally contain no endpoint, bucket, key or credential data. */
export class OperationalBackupTargetReadinessError extends Error {
  constructor() {
    super("OPERATIONAL_BACKUP_TARGET_NOT_READY");
    this.name = "OperationalBackupTargetReadinessError";
  }
}

type ParsedInput = z.infer<typeof inputSchema>;
type Target = z.infer<typeof targetSchema>;

function fail(): never { throw new OperationalBackupTargetReadinessError(); }

function endpointIdentity(value: string, mode: Target["mode"]): { identity: string; url: URL } {
  let url: URL;
  try { url = new URL(value); } catch { return fail(); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) return fail();
  const loopback = url.hostname === "127.0.0.1" && url.protocol === "http:" && process.env.NODE_ENV !== "production";
  if (mode === "loopback-development" && !loopback) return fail();
  if (url.protocol !== "https:" && !loopback) return fail();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return { identity: `${url.protocol}//${url.hostname.toLowerCase()}:${port}`, url };
}

function validateBindings(input: ParsedInput): string[] {
  const capture = input.sourceCapture;
  const manifest = capture.manifest;
  const state = normalizeOperationalBackupOperationState(input.operationState);
  const calculatedHash = createHash("sha256").update(canonicalOperationalBackupManifestBytes(manifest)).digest("hex");
  if (manifest.backupId !== input.backupId || capture.manifestSha256 !== calculatedHash ||
    capture.verifiedPmObjectCount !== manifest.pmObjects.length || state.backupId !== input.backupId ||
    state.phase !== "TARGET_PREPARATION_PENDING" || state.manifestSha256 !== calculatedHash ||
    input.targetFreshnessAttestation.backupId !== input.backupId) return fail();

  const expectedStoreIds = [...new Set(manifest.pmObjects.map(object => object.storeId))].sort();
  const stateStoreIds = [...state.storeIds].sort();
  if (expectedStoreIds.length !== stateStoreIds.length || expectedStoreIds.some((id, index) => id !== stateStoreIds[index])) return fail();

  const configuredIds = input.stores.map(store => store.storeId);
  if (new Set(configuredIds).size !== configuredIds.length || configuredIds.length !== expectedStoreIds.length ||
    [...configuredIds].sort().some((id, index) => id !== expectedStoreIds[index])) return fail();

  const target = input.target;
  const targetEndpoint = endpointIdentity(target.endpoint, target.mode);
  const targetBuckets = new Set<string>();
  for (const store of input.stores) {
    if (store.sourceBucket !== store.targetBucket) return fail();
    const sourceEndpoint = endpointIdentity(store.sourceEndpoint, target.mode);
    if (sourceEndpoint.identity === targetEndpoint.identity) return fail();
    if (targetBuckets.has(store.targetBucket)) return fail();
    targetBuckets.add(store.targetBucket);
  }
  return [...targetBuckets].sort();
}

function createTargetClient(target: Target, endpoint: URL, signal: AbortSignal): Client {
  const transportRequest: typeof http.request = (
    input: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void
  ) => {
    const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
    const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
    const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const req = (endpoint.protocol === "https:" ? https : http).request({ ...options, signal }, listener);
    req.setTimeout(target.requestTimeoutMs, () => req.destroy(new Error("request timeout")));
    return req;
  };
  return new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    region: target.region,
    accessKey: target.accessKey,
    secretKey: target.secretKey,
    pathStyle: true,
    retryOptions: { disableRetry: true },
    transport: { request: transportRequest }
  });
}

async function assertEmptyStream(stream: AsyncIterable<unknown>, validItem: (value: unknown) => boolean): Promise<void> {
  for await (const item of stream) {
    if (!validItem(item)) fail();
    fail();
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) fail();
}

function isNamedObject(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0;
}

function isVersion(value: unknown): boolean {
  if (!isNamedObject(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.versionId === "string" && record.versionId.length > 0 &&
    (record.isDeleteMarker === undefined || typeof record.isDeleteMarker === "boolean");
}

function isIncompleteUpload(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.key === "string" && record.key.length > 0 && typeof record.uploadId === "string" &&
    record.uploadId.length > 0 && typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0;
}

async function assertNoPolicy(client: Client, bucket: string): Promise<void> {
  try {
    await client.getBucketPolicy(bucket);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "NoSuchBucketPolicy") return;
    return fail();
  }
  fail();
}

async function assertNoReplication(client: Client, bucket: string): Promise<void> {
  try {
    // minio@8.0.7 declares the callback overload first, while runtime returns a Promise.
    const getReplication = client.getBucketReplication.bind(client) as unknown as (name: string) => Promise<unknown>;
    await getReplication(bucket);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ReplicationConfigurationNotFoundError") return;
    return fail();
  }
  fail();
}

/** Read-only point-in-time preflight. Freshness/exclusivity are operator assertions, not SDK proofs. */
export async function verifyOperationalBackupTargetReadiness(input: unknown): Promise<OperationalBackupTargetReadinessEvidence> {
  let parsed: ParsedInput;
  try { parsed = inputSchema.parse(input); } catch { return fail(); }
  let expectedBuckets: string[];
  try { expectedBuckets = validateBindings(parsed); } catch { return fail(); }

  try {
    const url = endpointIdentity(parsed.target.endpoint, parsed.target.mode).url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), parsed.target.requestTimeoutMs);
    const client = createTargetClient(parsed.target, url, controller.signal);
    try {
    const buckets = await client.listBuckets();
    assertActive(controller.signal);
    if (!Array.isArray(buckets)) return fail();
    const names = buckets.map(bucket => {
      if (!bucket || typeof bucket.name !== "string" || bucket.name.length === 0) return fail();
      return bucket.name;
    }).sort();
    if (new Set(names).size !== names.length || names.length !== expectedBuckets.length ||
      names.some((name, index) => name !== expectedBuckets[index])) return fail();

    for (const bucket of names) {
      const versioning = await client.getBucketVersioning(bucket);
      assertActive(controller.signal);
      if (!versioning || versioning.Status !== "Enabled") return fail();
      await assertNoPolicy(client, bucket);
      assertActive(controller.signal);
      await assertNoReplication(client, bucket);
      assertActive(controller.signal);
      await assertEmptyStream(client.listObjectsV2(bucket, "", true) as AsyncIterable<unknown>, isNamedObject);
      assertActive(controller.signal);
      await assertEmptyStream(client.listObjects(bucket, "", true, { IncludeVersion: true }) as AsyncIterable<unknown>, isVersion);
      assertActive(controller.signal);
      await assertEmptyStream(client.listIncompleteUploads(bucket, "", true) as AsyncIterable<unknown>, isIncompleteUpload);
      assertActive(controller.signal);
    }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  } catch {
    return fail();
  }

  return {
    kind: "TARGET_READY_EVIDENCE",
    backupId: parsed.backupId,
    manifestSha256: parsed.sourceCapture.manifestSha256,
    targetId: parsed.targetFreshnessAttestation.targetId,
    storeIds: [...new Set(parsed.stores.map(store => store.storeId))].sort()
  };
}
