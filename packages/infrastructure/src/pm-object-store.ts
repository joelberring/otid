import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import { z } from "zod";
import { pmObjectManifestSchema, type PmObjectManifest } from "@o-tid/contracts";

const maximumBytes = 10 * 1024 * 1024;
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const byteLength = z.number().int().min(1).max(maximumBytes);
const putSchema = z.object({ raceId: uuid, attemptId: uuid, sha256, byteLength }).strict();
const configSchema = z.object({
  storeId: uuid,
  endpoint: z.string().url(),
  bucket: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
  region: z.string().regex(/^[a-z0-9-]{1,64}$/),
  accessKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(1024),
  mode: z.enum(["production", "loopback-development"]),
  deadlineMs: z.number().int().min(10).max(60_000).default(30_000)
}).strict();

export type { PmObjectManifest } from "@o-tid/contracts";
type Config = z.infer<typeof configSchema>;

export class PmObjectStorageError extends Error {
  constructor() { super("PM_STORAGE_UNAVAILABLE_OR_INVALID"); this.name = "PmObjectStorageError"; }
}

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

// A new client/transport per operation avoids cancellation leaking between callers.
function clientFor(config: Config, endpoint: URL, signal: AbortSignal): Client {
  let putRequests = 0;
  const request: typeof http.request = (
    input: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void
  ) => {
    const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
    const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
    if (options.method === "PUT" && ++putRequests > 1) throw new PmObjectStorageError();
    const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    return (endpoint.protocol === "https:" ? https : http).request({ ...options, signal }, listener);
  };
  return new Client({
    endPoint: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:", region: config.region,
    accessKey: config.accessKey, secretKey: config.secretKey,
    pathStyle: true, partSize: 64 * 1024 * 1024,
    retryOptions: { disableRetry: true }, transport: { request }
  });
}

async function checkBucket(client: Client, bucket: string): Promise<void> {
  const versioning = await client.getBucketVersioning(bucket);
  if (versioning.Status !== "Enabled") throw new PmObjectStorageError();
  // Accept only the SDK's explicit missing-policy error, not arbitrary JSON,
  // empty success bodies or generic permission/network failures.
  try {
    await client.getBucketPolicy(bucket);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "NoSuchBucketPolicy") return;
    throw new PmObjectStorageError();
  }
  throw new PmObjectStorageError();
}

async function verifiedRead(client: Client, bucket: string, manifest: PmObjectManifest): Promise<Buffer> {
  const body = await client.getObject(bucket, manifest.key, { versionId: manifest.versionId });
  try {
    if (!(body instanceof http.IncomingMessage) || body.headers["x-amz-version-id"] !== manifest.versionId) {
      throw new PmObjectStorageError();
    }
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) throw new PmObjectStorageError();
      size += chunk.byteLength;
      if (size > manifest.byteLength) throw new PmObjectStorageError();
      parts.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(parts, size);
    if (size !== manifest.byteLength || digest(bytes) !== manifest.sha256) throw new PmObjectStorageError();
    return bytes;
  } finally {
    body.destroy();
  }
}

/** Trusted server configuration only; not an authorization or PDF-scanning API. */
export function createPmObjectStore(input: unknown) {
  let config: Config;
  let endpoint: URL;
  try {
    config = configSchema.parse(input);
    endpoint = new URL(config.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
      throw new PmObjectStorageError();
    }
    const local = config.mode === "loopback-development" && process.env.NODE_ENV !== "production" &&
      endpoint.hostname === "127.0.0.1" && endpoint.protocol === "http:";
    if (endpoint.protocol !== "https:" && !local) throw new PmObjectStorageError();
    if (config.mode === "loopback-development" && !local) throw new PmObjectStorageError();
  } catch {
    throw new PmObjectStorageError();
  }

  async function execute<T>(operation: (client: Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const deadline = performance.now() + config.deadlineMs;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), config.deadlineMs);
    try {
      if (controller.signal.aborted) throw new PmObjectStorageError();
      const client = clientFor(config, endpoint, controller.signal);
      await checkBucket(client, config.bucket);
      const result = await operation(client);
      if (controller.signal.aborted || performance.now() >= deadline) throw new PmObjectStorageError();
      return result;
    } catch {
      // Do not propagate SDK errors: they may include credentials, keys or bodies.
      throw new PmObjectStorageError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }

  return {
    async put(input: unknown, source: Uint8Array): Promise<PmObjectManifest> {
      const intent = putSchema.safeParse(input);
      if (!intent.success || !(source instanceof Uint8Array) || source.byteLength !== intent.data.byteLength) {
        throw new PmObjectStorageError();
      }
      // Own the bytes before yielding; callers cannot mutate the upload mid-flight.
      const bytes = Buffer.from(source);
      if (digest(bytes) !== intent.data.sha256) throw new PmObjectStorageError();
      const key = `pm/${intent.data.raceId}/${intent.data.attemptId}`;
      return execute(async client => {
        const stored = await client.putObject(config.bucket, key, bytes, bytes.length, { "Content-Type": "application/pdf" });
        const parsed = pmObjectManifestSchema.safeParse({
          formatVersion: 1, storeId: config.storeId, key, versionId: stored.versionId,
          sha256: intent.data.sha256, byteLength: bytes.length
        });
        if (!parsed.success) throw new PmObjectStorageError();
        await verifiedRead(client, config.bucket, parsed.data);
        return parsed.data;
      });
    },
    async read(input: unknown, signal?: AbortSignal): Promise<Buffer> {
      const manifest = pmObjectManifestSchema.safeParse(input);
      if (!manifest.success || manifest.data.storeId !== config.storeId) throw new PmObjectStorageError();
      return execute(client => verifiedRead(client, config.bucket, manifest.data), signal);
    }
  };
}
