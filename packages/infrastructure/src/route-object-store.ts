import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import { z } from "zod";
import { ROUTE_UPLOAD_MAX_BYTES, routeObjectManifestSchema, type RouteObjectManifest } from "@o-tid/contracts";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const configSchema = z.object({
  storeId: uuid, endpoint: z.string().url(), bucket: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
  region: z.string().regex(/^[a-z0-9-]{1,64}$/), accessKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(1024), mode: z.enum(["production", "loopback-development"]),
  deadlineMs: z.number().int().min(10).max(60_000).default(30_000)
}).strict();
const putSchema = z.object({
  raceId: uuid, attemptId: uuid, mediaType: z.literal("application/gpx+xml"), sha256: hash,
  byteLength: z.number().int().min(1).max(ROUTE_UPLOAD_MAX_BYTES)
}).strict();

export type { RouteObjectManifest } from "@o-tid/contracts";
export class RouteObjectStorageError extends Error {
  constructor() { super("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID"); this.name = "RouteObjectStorageError"; }
}
type Config = z.infer<typeof configSchema>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function clientFor(config: Config, endpoint: URL, signal: AbortSignal): Client {
  const request: typeof http.request = (
    input: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void
  ) => {
    const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
    const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
    const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    return (endpoint.protocol === "https:" ? https : http).request({ ...options, signal }, listener);
  };
  return new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:", region: config.region, accessKey: config.accessKey, secretKey: config.secretKey,
    pathStyle: true, partSize: 64 * 1024 * 1024, retryOptions: { disableRetry: true }, transport: { request } });
}

async function checkPrivateVersionedBucket(client: Client, bucket: string): Promise<void> {
  if ((await client.getBucketVersioning(bucket)).Status !== "Enabled") throw new RouteObjectStorageError();
  try { await client.getBucketPolicy(bucket); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "NoSuchBucketPolicy") return;
    throw new RouteObjectStorageError();
  }
  throw new RouteObjectStorageError();
}

async function verifiedRead(client: Client, bucket: string, manifest: RouteObjectManifest): Promise<Buffer> {
  const body = await client.getObject(bucket, manifest.key, { versionId: manifest.versionId });
  try {
    if (!(body instanceof http.IncomingMessage) || body.headers["x-amz-version-id"] !== manifest.versionId) throw new RouteObjectStorageError();
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array) || size + chunk.byteLength > manifest.byteLength) throw new RouteObjectStorageError();
      parts.push(Buffer.from(chunk)); size += chunk.byteLength;
    }
    const bytes = Buffer.concat(parts, size);
    if (size !== manifest.byteLength || digest(bytes) !== manifest.sha256) throw new RouteObjectStorageError();
    return bytes;
  } finally { body.destroy(); }
}

/** Trusted, server-only private object store for exact GPX originals. */
export function createRouteObjectStore(input: unknown) {
  let config: Config; let endpoint: URL;
  try {
    config = configSchema.parse(input); endpoint = new URL(config.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new RouteObjectStorageError();
    const loopback = config.mode === "loopback-development" && process.env.NODE_ENV !== "production" && endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1";
    if (endpoint.protocol !== "https:" && !loopback) throw new RouteObjectStorageError();
    if (config.mode === "loopback-development" && !loopback) throw new RouteObjectStorageError();
  } catch { throw new RouteObjectStorageError(); }

  async function execute<T>(operation: (client: Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), config.deadlineMs);
    try {
      if (controller.signal.aborted) throw new RouteObjectStorageError();
      const client = clientFor(config, endpoint, controller.signal);
      await checkPrivateVersionedBucket(client, config.bucket);
      const result = await operation(client);
      if (controller.signal.aborted) throw new RouteObjectStorageError();
      return result;
    } catch { throw new RouteObjectStorageError(); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
  }

  return {
    async put(input: unknown, source: Uint8Array): Promise<RouteObjectManifest> {
      const parsed = putSchema.safeParse(input);
      if (!parsed.success || !(source instanceof Uint8Array) || source.byteLength !== parsed.data.byteLength) throw new RouteObjectStorageError();
      const bytes = Buffer.from(source);
      if (digest(bytes) !== parsed.data.sha256) throw new RouteObjectStorageError();
      const key = `route/${parsed.data.raceId}/${parsed.data.attemptId}`;
      return execute(async client => {
        const stored = await client.putObject(config.bucket, key, bytes, bytes.length, { "Content-Type": parsed.data.mediaType });
        const manifest = routeObjectManifestSchema.safeParse({ formatVersion: 1, storeId: config.storeId, key, versionId: stored.versionId,
          mediaType: parsed.data.mediaType, sha256: parsed.data.sha256, byteLength: bytes.length });
        if (!manifest.success) throw new RouteObjectStorageError();
        await verifiedRead(client, config.bucket, manifest.data);
        return manifest.data;
      });
    },
    async read(input: unknown, signal?: AbortSignal): Promise<Buffer> {
      const manifest = routeObjectManifestSchema.safeParse(input);
      if (!manifest.success || manifest.data.storeId !== config.storeId) throw new RouteObjectStorageError();
      return execute(client => verifiedRead(client, config.bucket, manifest.data), signal);
    }
  };
}
