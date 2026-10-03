import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), readManifest: vi.fn(), readBytes: vi.fn()
}));
vi.mock("@o-tid/application", () => ({
  authenticatePairingAdminSession: mocks.authenticate,
  readStoredMapManifestAsAdmin: mocks.readManifest
}));
vi.mock("./map-store", () => ({ createConfiguredMapStore: () => ({ read: mocks.readBytes }) }));

import { mapAssetPreviewRoute } from "./map-asset-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const storeId = "10000000-0000-4000-8000-000000000003";
const environment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" } as const;
const manifest = { raceId, uploadId, storeId, objectKey: `map/${raceId}/${uploadId}`,
  versionId: "synthetic-v1", mediaType: "image/png", sha256: "a".repeat(64), byteLength: 9 };
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function request() {
  return new Request(`http://127.0.0.1:3000/api/admin/races/${raceId}/map/previews/${uploadId}`, {
    headers: { cookie: "otid_race_administrator_session=synthetic-session" }
  });
}

describe("TASK244 private map preview HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ status: "authenticated", principal: { raceId, capability: "MANAGE_RACE" } });
    mocks.readManifest.mockResolvedValue({ status: "ok", manifest });
    mocks.readBytes.mockResolvedValue(Buffer.from(bytes));
  });

  it("returns only verified exact-version bytes under private browser headers", async () => {
    const response = await mapAssetPreviewRoute(db, request(), raceId, uploadId, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.readBytes).toHaveBeenCalledWith(expect.objectContaining({ storeId,
      key: manifest.objectKey, versionId: manifest.versionId, sha256: manifest.sha256 }), expect.any(AbortSignal));
    expect(mocks.readManifest).toHaveBeenCalledTimes(2);
    expect(mocks.readManifest).toHaveBeenNthCalledWith(1, db, expect.objectContaining({ raceId, uploadId, sessionToken: "synthetic-session" }));
  });

  it("does not read bytes for unauthorized or absent candidates", async () => {
    mocks.authenticate.mockResolvedValue({ status: "forbidden" });
    const denied = await mapAssetPreviewRoute(db, request(), raceId, uploadId, environment);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(mocks.readManifest).not.toHaveBeenCalled();
    expect(mocks.readBytes).not.toHaveBeenCalled();

    mocks.authenticate.mockResolvedValue({ status: "authenticated", principal: { raceId, capability: "MANAGE_RACE" } });
    mocks.readManifest.mockResolvedValue({ status: "not-found" });
    expect((await mapAssetPreviewRoute(db, request(), raceId, uploadId, environment)).status).toBe(404);
    expect(mocks.readBytes).not.toHaveBeenCalled();
  });

  it("discards read bytes when the post-read authorization or manifest check fails", async () => {
    mocks.readManifest.mockResolvedValueOnce({ status: "ok", manifest }).mockResolvedValueOnce({ status: "forbidden" });
    const revoked = await mapAssetPreviewRoute(db, request(), raceId, uploadId, environment);
    expect(revoked.status).toBe(403);
    expect(revoked.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.readBytes).toHaveBeenCalledOnce();
    expect(revoked.headers.get("content-type")).toContain("application/json");
    expect(new Uint8Array(await revoked.arrayBuffer())).not.toEqual(bytes);

    mocks.readManifest.mockReset().mockResolvedValueOnce({ status: "ok", manifest })
      .mockResolvedValueOnce({ status: "ok", manifest: { ...manifest, versionId: "synthetic-v2" } });
    const changed = await mapAssetPreviewRoute(db, request(), raceId, uploadId, environment);
    expect(changed.status).toBe(503);
    expect(changed.headers.get("content-type")).toContain("application/json");
  });
});
