import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";

const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const sha256 = createHash("sha256").update(png).digest("hex");
const raceId = "10000000-0000-4000-8000-000000000001";
const attemptId = "10000000-0000-4000-8000-000000000002";
const storeId = "10000000-0000-4000-8000-000000000003";

vi.mock("minio", () => ({ Client: class {
  async getBucketVersioning() { return { Status: "Enabled" }; }
  async getBucketPolicy() { const error = Object.assign(new Error("private"), { code: "NoSuchBucketPolicy" }); throw error; }
  async putObject() { return { versionId: "version-1" }; }
  async getObject() { const body = new IncomingMessage({ readable: true } as never); body.destroy = () => body; body.headers["x-amz-version-id"] = "version-1"; Object.defineProperty(body, Symbol.asyncIterator, { value: async function* () { yield png; } }); return body; }
} }));

describe("map private object store", async () => {
  const { createMapObjectStore, MapObjectStorageError } = await import("../src/map-object-store");
  const store = createMapObjectStore({ storeId, endpoint: "http://127.0.0.1", bucket: "maps-private", region: "us-east-1", accessKey: "synthetic", secretKey: "synthetic", mode: "loopback-development" });
  it("stores a validated PNG at the exact race-scoped versioned key", async () => {
    await expect(store.put({ raceId, attemptId, mediaType: "image/png", sha256, byteLength: png.length }, png)).resolves.toMatchObject({ key: `map/${raceId}/${attemptId}`, versionId: "version-1", mediaType: "image/png" });
  });
  it("rejects a declared image whose magic bytes do not match", async () => {
    await expect(store.put({ raceId, attemptId, mediaType: "image/png", sha256, byteLength: png.length }, Buffer.from("not png"))).rejects.toBeInstanceOf(MapObjectStorageError);
  });
  it("rejects a read manifest from another store", async () => {
    await expect(store.read({ formatVersion: 1, storeId: "10000000-0000-4000-8000-000000000004", key: `map/${raceId}/${attemptId}`, versionId: "version-1", mediaType: "image/png", sha256, byteLength: png.length })).rejects.toBeInstanceOf(MapObjectStorageError);
  });
});
