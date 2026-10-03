import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  readState: vi.fn(), bindContext: vi.fn(), readOverlay: vi.fn(), resolveMap: vi.fn(), readBytes: vi.fn()
}));
vi.mock("@o-tid/application", () => ({
  readPrivateRouteContextStateAsAdmin: mocks.readState,
  bindPrivateRouteContextAsAdmin: mocks.bindContext,
  readMyPrivateRouteOverlay: mocks.readOverlay,
  resolveMyPrivateRouteMap: mocks.resolveMap
}));
vi.mock("./map-store", () => ({ createConfiguredMapStore: () => ({ read: mocks.readBytes }) }));

import { bindPrivateRouteContextRoute, participantPrivateRouteMapRoute, participantPrivateRouteOverlayRoute, privateRouteContextStateRoute } from "./private-route-context-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const routeUploadId = "10000000-0000-4000-8000-000000000002";
const mapManifestId = "10000000-0000-4000-8000-000000000003";
const georeferenceId = "10000000-0000-4000-8000-000000000004";
const geometryRevisionId = "10000000-0000-4000-8000-000000000005";
const requestId = "10000000-0000-4000-8000-000000000006";
const csrf = "c".repeat(43);
const environment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" } as const;
const mapRow = { uploadId: mapManifestId, storeId: "10000000-0000-4000-8000-000000000007", objectKey: `map/${raceId}/${mapManifestId}`, versionId: "v1", mediaType: "image/png", sha256: "a".repeat(64), byteLength: 10 };

function participantRequest(path: string) {
  return new Request(`http://127.0.0.1:3000${path}`, { headers: { cookie: "otid_organizer_session=session" } });
}

describe("TASK155 private route context HTTP handlers", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("keeps missing or stale participant context neutral with a no-store 404", async () => {
    mocks.readOverlay.mockResolvedValue({ status: "not-found" });
    const response = await participantPrivateRouteOverlayRoute(db, participantRequest(`/api/participant/me/routes/${routeUploadId}/overlay`), routeUploadId, environment);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.readOverlay).toHaveBeenCalledOnce();
  });

  it("pins both map resolution checks to the overlay context revision", async () => {
    mocks.resolveMap.mockResolvedValue({ status: "ok", response: mapRow });
    mocks.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const response = await participantPrivateRouteMapRoute(db, participantRequest(`/api/participant/me/routes/${routeUploadId}/map?contextRevision=4`), routeUploadId, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.resolveMap).toHaveBeenNthCalledWith(1, db, expect.objectContaining({ sessionToken: "session" }), routeUploadId, 4);
    expect(mocks.resolveMap).toHaveBeenNthCalledWith(2, db, expect.objectContaining({ sessionToken: "session" }), routeUploadId, 4);
    expect(mocks.readBytes).toHaveBeenCalledWith(expect.objectContaining({ versionId: "v1", sha256: "a".repeat(64) }), expect.any(AbortSignal));
  });

  it("requires a valid context revision and confirms admin bind as its own POST", async () => {
    const missingRevision = await participantPrivateRouteMapRoute(db, participantRequest(`/api/participant/me/routes/${routeUploadId}/map`), routeUploadId, environment);
    expect(missingRevision.status).toBe(400);
    expect(mocks.resolveMap).not.toHaveBeenCalled();

    const body = { formatVersion: 1, routeUploadId, mapManifestId, georeferenceId, geometryRevisionId, expectedContextRevision: 0 };
    mocks.bindContext.mockResolvedValue({ status: "bound", response: { formatVersion: 1, contextId: requestId, requestId, raceId, routeUploadId, revision: 1, mapManifestId, georeferenceId, geometryRevisionId, courseVersionId: "10000000-0000-4000-8000-000000000008", boundAt: "2026-09-23T10:00:00.000Z", replayed: false } });
    const response = await bindPrivateRouteContextRoute(db, new Request(`http://127.0.0.1:3000/api/admin/races/${raceId}/route-context`, { method: "POST", headers: { origin: environment.O_TID_PUBLIC_ORIGIN, cookie: `otid_race_administrator_session=session; otid_race_administrator_csrf=${csrf}`, "x-otid-csrf": csrf, "content-type": "application/json", "idempotency-key": `private-route-context-bind:${requestId}` }, body: JSON.stringify(body) }), raceId, environment);
    expect(response.status).toBe(201);
    expect(mocks.bindContext).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, idempotencyKey: `private-route-context-bind:${requestId}`, request: body, requireCsrf: true }));
  });

  it("returns a neutral 404 for an absent admin route context", async () => {
    mocks.readState.mockResolvedValue({ status: "not-found" });
    const response = await privateRouteContextStateRoute(db, new Request(`http://127.0.0.1:3000/api/admin/races/${raceId}/route-context?routeUploadId=${routeUploadId}`, { headers: { cookie: "otid_race_administrator_session=session" } }), raceId, environment);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
