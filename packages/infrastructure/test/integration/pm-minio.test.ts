import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "node:http";
import { Client } from "minio";
import { createPmObjectStore } from "../../src";

const confirmation = process.env.OTID_MINIO_TEST_CONFIRM;
const endpointValue = process.env.OTID_MINIO_TEST_ENDPOINT;
const accessKey = process.env.OTID_MINIO_TEST_ACCESS_KEY;
const secretKey = process.env.OTID_MINIO_TEST_SECRET_KEY;

function required(value: string | undefined): string {
  if (!value) throw new Error("Isolerad MinIO-testkonfiguration krävs");
  return value;
}

if (confirmation !== "isolated-disposable-minio") throw new Error("Isolerad MinIO-testkonfiguration krävs");
let endpoint: URL;
try {
  endpoint = new URL(required(endpointValue));
} catch {
  throw new Error("Isolerad MinIO-testkonfiguration krävs");
}
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port ||
  endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
  throw new Error("Isolerad MinIO-testkonfiguration krävs");
}

const bucket = `otid-pm-spec-${randomUUID()}`;
const storeId = randomUUID();
const agent = new Agent({ keepAlive: false });
const client = new Client({
  endPoint: endpoint.hostname,
  port: Number(endpoint.port),
  useSSL: false,
  region: "us-east-1",
  accessKey: required(accessKey),
  secretKey: required(secretKey),
  pathStyle: true,
  transportAgent: agent
});

const original = Buffer.from("%PDF-1.4\nreal MinIO PM fixture\n%%EOF\n", "utf8");
const replacement = Buffer.from("%PDF-1.4\nnewer version\n%%EOF\n", "utf8");
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const raceId = randomUUID();
const attemptId = randomUUID();
const objectStore = createPmObjectStore({
  storeId,
  endpoint: endpoint.toString(),
  bucket,
  region: "us-east-1",
  accessKey: required(accessKey),
  secretKey: required(secretKey),
  mode: "loopback-development",
  deadlineMs: 2_000
});

beforeAll(async () => {
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
});

afterAll(() => { agent.destroy(); });

describe("TASK013 actual isolated MinIO PM object store", () => {
  it("stores and re-reads a versioned private PDF, while anonymous object and bucket listing requests are denied", async () => {
    const manifest = await objectStore.put({ raceId, attemptId, sha256: digest(original), byteLength: original.length }, original);
    expect(manifest).toMatchObject({
      formatVersion: 1,
      storeId,
      key: `pm/${raceId}/${attemptId}`,
      sha256: digest(original),
      byteLength: original.length
    });
    expect(manifest.versionId).not.toBe("null");
    await expect(objectStore.read(manifest)).resolves.toEqual(original);

    const anonymousObject = await fetch(new URL(`/${bucket}/${manifest.key}`, endpoint));
    const anonymousListing = await fetch(new URL(`/${bucket}?list-type=2`, endpoint));
    expect(anonymousObject.status).toBe(403);
    expect(anonymousListing.status).toBe(403);
  });

  it("reads the original manifest version after a direct newer PUT to the same key", async () => {
    const manifest = await objectStore.put({ raceId, attemptId: randomUUID(), sha256: digest(original), byteLength: original.length }, original);
    const newer = await client.putObject(bucket, manifest.key, replacement, replacement.length, { "Content-Type": "application/pdf" });
    expect(newer.versionId).toBeTruthy();
    expect(newer.versionId).not.toBe(manifest.versionId);
    await expect(objectStore.read(manifest)).resolves.toEqual(original);
  });

  it("rejects missing object versions and refuses new PUTs after versioning is suspended", async () => {
    await expect(objectStore.read({
      formatVersion: 1,
      storeId,
      key: `pm/${raceId}/${randomUUID()}`,
      versionId: "missing-version",
      sha256: digest(original),
      byteLength: original.length
    })).rejects.toThrow("PM_STORAGE_UNAVAILABLE_OR_INVALID");
    await client.setBucketVersioning(bucket, { Status: "Suspended" });
    await expect(objectStore.put({ raceId, attemptId: randomUUID(), sha256: digest(original), byteLength: original.length }, original))
      .rejects.toThrow("PM_STORAGE_UNAVAILABLE_OR_INVALID");
  });
});
