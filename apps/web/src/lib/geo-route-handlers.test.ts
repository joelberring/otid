import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  readGeoOutput: vi.fn(),
  readGeoStageOutput: vi.fn(),
  authenticateGeoWorker: vi.fn(),
  streamMapContentParts: vi.fn()
}));

vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(),
  readGeoOutput: mocks.readGeoOutput,
  readGeoStageOutput: mocks.readGeoStageOutput,
  authenticateGeoWorker: mocks.authenticateGeoWorker,
  streamMapContentParts: mocks.streamMapContentParts
}));

import { geoOutputRoute, geoWorkerStageRoute } from "./geo-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const projectId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const stageId = "10000000-0000-4000-8000-000000000003";
const contentId = "10000000-0000-4000-8000-000000000004";
const session = `otid_user_session_v1.${projectId}.${"s".repeat(43)}`;
const sha = "d".repeat(64);

async function* chunks(...parts: Uint8Array[]) {
  for (const part of parts) yield part;
}

describe("geo-route-handlers: streaming och 304 före läsning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("geoOutputRoute strömmar i delar med immutable + Vary: Cookie för klart jobb och svarar 304 på svag ETag utan strömning", async () => {
    mocks.readGeoOutput.mockResolvedValue({
      status: "ok", contentId, sha256: sha, byteLength: 6, mediaType: "application/dxf", immutable: true
    });
    mocks.streamMapContentParts.mockReturnValueOnce(chunks(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])));

    const ok = await geoOutputRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${projectId}/geo-jobs/${jobId}/outputs/kurvor.dxf`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      projectId, jobId, "kurvor.dxf", env
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/dxf");
    expect(ok.headers.get("content-length")).toBe("6");
    expect(ok.headers.get("etag")).toBe(`"${sha}"`);
    expect(ok.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(ok.headers.get("vary")).toBe("Cookie");
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    // Svag ETag (Caddy zstd/gzip) → 304 utan att anropa streamMapContentParts.
    const cached = await geoOutputRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${projectId}/geo-jobs/${jobId}/outputs/kurvor.dxf`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}`, "if-none-match": `W/"${sha}"` }
      }),
      projectId, jobId, "kurvor.dxf", env
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(`"${sha}"`);
    expect(cached.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(cached.headers.get("vary")).toBe("Cookie");
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    // Ej klart jobb får private, no-cache.
    mocks.readGeoOutput.mockResolvedValueOnce({
      status: "ok", contentId, sha256: sha, byteLength: 2, mediaType: "image/png", immutable: false
    });
    mocks.streamMapContentParts.mockReturnValueOnce(chunks(new Uint8Array([9, 8])));
    const running = await geoOutputRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${projectId}/geo-jobs/${jobId}/outputs/karta.png`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      projectId, jobId, "karta.png", env
    );
    expect(running.status).toBe(200);
    expect(running.headers.get("cache-control")).toBe("private, no-cache");
    expect(running.headers.get("vary")).toBe("Cookie");
  });

  it("geoWorkerStageRoute strömmar etappfil via streamMapContentParts och ger 304 på If-None-Match", async () => {
    mocks.authenticateGeoWorker.mockResolvedValue("geo-1");
    mocks.readGeoStageOutput.mockResolvedValue({ contentId, sha256: sha, byteLength: 5 });
    mocks.streamMapContentParts.mockReturnValueOnce(chunks(new Uint8Array([65, 66]), new Uint8Array([67, 68, 69])));

    const ok = await geoWorkerStageRoute(
      db,
      new Request(`https://tid.klubb.se/api/geo-worker/jobs/${jobId}/stages/${stageId}/kurvor.dxf`, {
        headers: { authorization: `Bearer ${"k".repeat(40)}`, "x-otid-geo-worker": "geo-1" }
      }),
      jobId, stageId, "kurvor.dxf", env
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/octet-stream");
    expect(ok.headers.get("content-length")).toBe("5");
    expect(ok.headers.get("etag")).toBe(`"${sha}"`);
    expect(ok.headers.get("vary")).toBe("Authorization");
    expect(await ok.text()).toBe("ABCDE");
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    const cached = await geoWorkerStageRoute(
      db,
      new Request(`https://tid.klubb.se/api/geo-worker/jobs/${jobId}/stages/${stageId}/kurvor.dxf`, {
        headers: { authorization: `Bearer ${"k".repeat(40)}`, "x-otid-geo-worker": "geo-1", "if-none-match": `W/"${sha}"` }
      }),
      jobId, stageId, "kurvor.dxf", env
    );
    expect(cached.status).toBe(304);
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);
  });
});
