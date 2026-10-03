import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";

const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59" lon="18"/><trkpt lat="60" lon="19"/></trkseg></trk></gpx>');
const sha256 = createHash("sha256").update(gpx).digest("hex");
const raceId = "10000000-0000-4000-8000-000000000001";
const attemptId = "10000000-0000-4000-8000-000000000002";
const storeId = "10000000-0000-4000-8000-000000000003";

vi.mock("minio", () => ({ Client: class {
  async getBucketVersioning() { return { Status: "Enabled" }; }
  async getBucketPolicy() { const error = Object.assign(new Error("private"), { code: "NoSuchBucketPolicy" }); throw error; }
  async putObject() { return { versionId: "version-1" }; }
  async getObject() {
    const body = new IncomingMessage({ readable: true } as never);
    body.destroy = () => body; body.headers["x-amz-version-id"] = "version-1";
    Object.defineProperty(body, Symbol.asyncIterator, { value: async function* () { yield gpx; } });
    return body;
  }
} }));

describe("route private object store", async () => {
  const { createRouteObjectStore, RouteObjectStorageError } = await import("../src/route-object-store");
  const store = createRouteObjectStore({ storeId, endpoint: "http://127.0.0.1", bucket: "routes-private", region: "us-east-1", accessKey: "synthetic", secretKey: "synthetic", mode: "loopback-development" });
  const input = { raceId, attemptId, mediaType: "application/gpx+xml" as const, sha256, byteLength: gpx.length };

  it("stores an exact race-scoped versioned GPX original", async () => {
    await expect(store.put(input, gpx)).resolves.toMatchObject({ key: `route/${raceId}/${attemptId}`, versionId: "version-1", mediaType: "application/gpx+xml" });
  });
  it("rejects changed bytes even when the declared metadata is valid", async () => {
    await expect(store.put(input, Buffer.from("changed"))).rejects.toBeInstanceOf(RouteObjectStorageError);
  });
});
