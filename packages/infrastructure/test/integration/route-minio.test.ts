import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "node:http";
import { Client } from "minio";
import { createRouteObjectStore } from "../../src";

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
try { endpoint = new URL(required(endpointValue)); }
catch { throw new Error("Isolerad MinIO-testkonfiguration krävs"); }
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port ||
  endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
  throw new Error("Isolerad MinIO-testkonfiguration krävs");
}

const bucket = `otid-route-spec-${randomUUID()}`;
const storeId = randomUUID();
const agent = new Agent({ keepAlive: false });
const client = new Client({
  endPoint: endpoint.hostname, port: Number(endpoint.port), useSSL: false, region: "us-east-1",
  accessKey: required(accessKey), secretKey: required(secretKey), pathStyle: true, transportAgent: agent
});
const original = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.1" lon="18.1"/><trkpt lat="59.2" lon="18.2"/></trkseg></trk></gpx>', "utf8");
const replacement = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="60.1" lon="19.1"/><trkpt lat="60.2" lon="19.2"/></trkseg></trk></gpx>', "utf8");
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const raceId = randomUUID();
const objectStore = createRouteObjectStore({
  storeId, endpoint: endpoint.toString(), bucket, region: "us-east-1", accessKey: required(accessKey), secretKey: required(secretKey),
  mode: "loopback-development", deadlineMs: 2_000
});

beforeAll(async () => {
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
});
afterAll(() => { agent.destroy(); });

describe("TASK113 actual isolated MinIO route object store", () => {
  it("stores and re-reads a versioned private GPX original while anonymous object and bucket requests are denied", async () => {
    const attemptId = randomUUID();
    const manifest = await objectStore.put({ raceId, attemptId, mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length }, original);
    expect(manifest).toMatchObject({
      formatVersion: 1, storeId, key: `route/${raceId}/${attemptId}`, mediaType: "application/gpx+xml",
      sha256: digest(original), byteLength: original.length
    });
    expect(manifest.versionId).not.toBe("null");
    await expect(objectStore.read(manifest)).resolves.toEqual(original);
    expect((await fetch(new URL(`/${bucket}/${manifest.key}`, endpoint))).status).toBe(403);
    expect((await fetch(new URL(`/${bucket}?list-type=2`, endpoint))).status).toBe(403);
  });

  it("keeps the original route manifest readable after a direct later overwrite", async () => {
    const attemptId = randomUUID();
    const manifest = await objectStore.put({ raceId, attemptId, mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length }, original);
    const newer = await client.putObject(bucket, manifest.key, replacement, replacement.length, { "Content-Type": "application/gpx+xml" });
    expect(newer.versionId).toBeTruthy();
    expect(newer.versionId).not.toBe(manifest.versionId);
    await expect(objectStore.read(manifest)).resolves.toEqual(original);
  });

  it("fails closed for invalid content, missing versions, public buckets and suspended versioning", async () => {
    const attemptId = randomUUID();
    await expect(objectStore.put({ raceId, attemptId, mediaType: "application/gpx+xml", sha256: digest(replacement), byteLength: original.length }, original))
      .rejects.toThrow("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID");
    await expect(objectStore.put({ raceId, attemptId, mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length + 1 }, original))
      .rejects.toThrow("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID");
    await expect(objectStore.read({ formatVersion: 1, storeId, key: `route/${raceId}/${attemptId}`, versionId: "missing-version", mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length }))
      .rejects.toThrow("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID");

    await client.setBucketVersioning(bucket, { Status: "Suspended" });
    await expect(objectStore.put({ raceId, attemptId: randomUUID(), mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length }, original))
      .rejects.toThrow("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID");

    const publicBucket = `otid-route-public-${randomUUID()}`;
    await client.makeBucket(publicBucket, "us-east-1");
    await client.setBucketVersioning(publicBucket, { Status: "Enabled" });
    await client.setBucketPolicy(publicBucket, JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${publicBucket}/*`] }] }));
    const publicStore = createRouteObjectStore({
      storeId: randomUUID(), endpoint: endpoint.toString(), bucket: publicBucket, region: "us-east-1", accessKey: required(accessKey), secretKey: required(secretKey),
      mode: "loopback-development", deadlineMs: 2_000
    });
    await expect(publicStore.put({ raceId, attemptId: randomUUID(), mediaType: "application/gpx+xml", sha256: digest(original), byteLength: original.length }, original))
      .rejects.toThrow("ROUTE_STORAGE_UNAVAILABLE_OR_INVALID");
  });
});
