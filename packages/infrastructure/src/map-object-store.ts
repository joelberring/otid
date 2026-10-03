import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import { z } from "zod";
import { MAP_ASSET_MAX_BYTES, mapObjectManifestSchema, type MapObjectManifest } from "@o-tid/contracts";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const mediaType = z.enum(["image/png", "image/jpeg"]);
const configSchema = z.object({
  storeId: uuid, endpoint: z.string().url(), bucket: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
  region: z.string().regex(/^[a-z0-9-]{1,64}$/), accessKey: z.string().min(1).max(256),
  secretKey: z.string().min(1).max(1024), mode: z.enum(["production", "loopback-development"]),
  deadlineMs: z.number().int().min(10).max(60_000).default(30_000)
}).strict();
const putSchema = z.object({ raceId: uuid, attemptId: uuid, mediaType, sha256,
  byteLength: z.number().int().min(1).max(MAP_ASSET_MAX_BYTES) }).strict();

export type { MapObjectManifest } from "@o-tid/contracts";
export class MapObjectStorageError extends Error { constructor() { super("MAP_STORAGE_UNAVAILABLE_OR_INVALID"); this.name = "MapObjectStorageError"; } }
type Config = z.infer<typeof configSchema>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function clientFor(config: Config, endpoint: URL, signal: AbortSignal): Client {
  const request: typeof http.request = (input: string | URL | http.RequestOptions, optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void), callback?: (response: http.IncomingMessage) => void) => {
    const base = typeof input === "string" || input instanceof URL ? urlToHttpOptions(new URL(input)) : input;
    const options = typeof optionsOrCallback === "object" ? { ...base, ...optionsOrCallback } : base;
    const listener = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    return (endpoint.protocol === "https:" ? https : http).request({ ...options, signal }, listener);
  };
  return new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)), useSSL: endpoint.protocol === "https:", region: config.region, accessKey: config.accessKey, secretKey: config.secretKey, pathStyle: true, partSize: 64 * 1024 * 1024, retryOptions: { disableRetry: true }, transport: { request } });
}

async function checkPrivateBucket(client: Client, bucket: string): Promise<void> {
  if ((await client.getBucketVersioning(bucket)).Status !== "Enabled") throw new MapObjectStorageError();
  try { await client.getBucketPolicy(bucket); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "NoSuchBucketPolicy") return;
    throw new MapObjectStorageError();
  }
  throw new MapObjectStorageError();
}

function matchesType(bytes: Buffer, type: string): boolean {
  return type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
}

async function verifiedRead(client: Client, bucket: string, manifest: MapObjectManifest): Promise<Buffer> {
  const body = await client.getObject(bucket, manifest.key, { versionId: manifest.versionId });
  try {
    if (!(body instanceof http.IncomingMessage) || body.headers["x-amz-version-id"] !== manifest.versionId) throw new MapObjectStorageError();
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) throw new MapObjectStorageError();
      size += chunk.byteLength; if (size > manifest.byteLength) throw new MapObjectStorageError(); parts.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(parts, size);
    if (size !== manifest.byteLength || digest(bytes) !== manifest.sha256 || !matchesType(bytes, manifest.mediaType)) throw new MapObjectStorageError();
    return bytes;
  } finally { body.destroy(); }
}

export function createMapObjectStore(input: unknown) {
  let config: Config; let endpoint: URL;
  try {
    config = configSchema.parse(input); endpoint = new URL(config.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new MapObjectStorageError();
    const local = config.mode === "loopback-development" && process.env.NODE_ENV !== "production" && endpoint.hostname === "127.0.0.1" && endpoint.protocol === "http:";
    if (endpoint.protocol !== "https:" && !local) throw new MapObjectStorageError();
    if (config.mode === "loopback-development" && !local) throw new MapObjectStorageError();
  } catch { throw new MapObjectStorageError(); }
  async function execute<T>(operation: (client: Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), config.deadlineMs);
    try { if (controller.signal.aborted) throw new MapObjectStorageError(); const client = clientFor(config, endpoint, controller.signal); await checkPrivateBucket(client, config.bucket); const result = await operation(client); if (controller.signal.aborted) throw new MapObjectStorageError(); return result; }
    catch { throw new MapObjectStorageError(); } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
  }
  return {
    async put(input: unknown, source: Uint8Array): Promise<MapObjectManifest> {
      const parsed = putSchema.safeParse(input); if (!parsed.success || !(source instanceof Uint8Array) || source.byteLength !== parsed.data.byteLength) throw new MapObjectStorageError();
      const bytes = Buffer.from(source); if (digest(bytes) !== parsed.data.sha256 || !matchesType(bytes, parsed.data.mediaType)) throw new MapObjectStorageError();
      const key = `map/${parsed.data.raceId}/${parsed.data.attemptId}`;
      return execute(async client => { const stored = await client.putObject(config.bucket, key, bytes, bytes.length, { "Content-Type": parsed.data.mediaType }); const manifest = mapObjectManifestSchema.safeParse({ formatVersion: 1, storeId: config.storeId, key, versionId: stored.versionId, mediaType: parsed.data.mediaType, sha256: parsed.data.sha256, byteLength: bytes.length }); if (!manifest.success) throw new MapObjectStorageError(); await verifiedRead(client, config.bucket, manifest.data); return manifest.data; });
    },
    async read(input: unknown, signal?: AbortSignal): Promise<Buffer> {
      const parsed = mapObjectManifestSchema.safeParse(input);
      if (!parsed.success || parsed.data.storeId !== config.storeId) throw new MapObjectStorageError();
      return execute(client => verifiedRead(client, config.bucket, parsed.data), signal);
    }
  };
}
