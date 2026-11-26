import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  listPublicMapListings: vi.fn(),
  readPublicMapListing: vi.fn(),
  readPublicMapPreview: vi.fn(),
  downloadPublicMapSource: vi.fn(),
  streamMapContentParts: vi.fn(),
  createRaceFromPublicMapListing: vi.fn(),
  readClubMapCatalogStatus: vi.fn(),
  upsertClubMapCatalogListing: vi.fn(),
  removeClubMapCatalogListing: vi.fn(),
  readMapProjectCatalogStatus: vi.fn(),
  upsertMapProjectCatalogListing: vi.fn(),
  removeMapProjectCatalogListing: vi.fn(),
  attachClubMapVersionToRaceServerSide: vi.fn()
}));

vi.mock("@o-tid/application", () => mocks);
vi.mock("./public-load", () => ({
  publicLoad: () => ({ admit: async () => ({ kind: "admitted" as const, release: () => undefined }) }),
  publicBusyResponse: () => new Response("busy", { status: 503 })
}));

import {
  clubMapCatalogRoute,
  clubMapVersionAttachRaceRoute,
  mapProjectCatalogRoute,
  publicMapBankDetailRoute,
  publicMapBankDownloadRoute,
  publicMapBankListRoute,
  publicMapBankPreviewRoute,
  usePublicMapListingRoute
} from "./public-map-bank-route-handlers";

const fakeDb = {} as Database;
const validUuid = "11111111-1111-4111-8111-111111111111";
const validUuid2 = "22222222-2222-4222-8222-222222222222";
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.se" } as const;
const sessionTok = `otid_user_session_v1.${validUuid}.${"a".repeat(43)}`;
const csrfTok = "b".repeat(43);

function authHeaders(origin = "https://otid.se"): Record<string, string> {
  return {
    origin,
    cookie: `__Host-otid-organizer-session=${sessionTok}; __Host-otid-organizer-csrf=${csrfTok}`,
    "x-otid-csrf": csrfTok,
    "content-type": "application/json"
  };
}

describe("public-map-bank-route-handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists public maps with municipality counts", async () => {
    mocks.listPublicMapListings.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      municipalityCounts: { "0180": 3 }
    });
    const res = await publicMapBankListRoute(fakeDb, new Request("https://otid.se/api/public/map-bank?municipality=0180"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({ formatVersion: 1, items: [], total: 0, municipalityCounts: { "0180": 3 } });
  });

  it("rejects invalid UUID on detail, preview, and download routes with 404", async () => {
    expect((await publicMapBankDetailRoute(fakeDb, "not-a-uuid")).status).toBe(404);
    expect((await publicMapBankPreviewRoute(fakeDb, "not-a-uuid")).status).toBe(404);
    expect((await publicMapBankDownloadRoute(fakeDb, "not-a-uuid")).status).toBe(404);
  });

  it("serves PNG preview with nosniff and public cache headers when allowed", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const sha = "a".repeat(64);
    mocks.readPublicMapPreview.mockResolvedValue({ status: "ok", png, sha256: sha });
    const res = await publicMapBankPreviewRoute(fakeDb, validUuid);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    // Versionerad förhandsvisning (?v=<16-teckens previewSha>) får 1 års immutable cache.
    const versioned = await publicMapBankPreviewRoute(
      fakeDb,
      validUuid,
      new Request(`https://otid.se/api/public/map-bank/${validUuid}/preview?v=${sha.slice(0, 16)}`)
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(versioned.headers.get("etag")).toBe(`"${sha}"`);

    // 304 på svag W/-ETag före byte-läsning.
    mocks.readPublicMapPreview.mockResolvedValueOnce({ status: "not-modified", sha256: sha });
    const notMod = await publicMapBankPreviewRoute(
      fakeDb,
      validUuid,
      new Request(`https://otid.se/api/public/map-bank/${validUuid}/preview?v=${sha.slice(0, 16)}`, {
        headers: { "if-none-match": `W/"${sha}"` }
      })
    );
    expect(notMod.status).toBe(304);
    expect(notMod.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(notMod.headers.get("etag")).toBe(`"${sha}"`);
    expect(mocks.readPublicMapPreview).toHaveBeenLastCalledWith(fakeDb, validUuid, { ifNoneMatch: `W/"${sha}"` });
  });

  it("returns 403 on download when accessMode is not OPEN_DOWNLOAD", async () => {
    mocks.downloadPublicMapSource.mockResolvedValue({ status: "forbidden" });
    const res = await publicMapBankDownloadRoute(fakeDb, validUuid);
    expect(res.status).toBe(403);
  });

  it("streams attachment on download when OPEN_DOWNLOAD and returns 304 before streaming on If-None-Match", async () => {
    const sha = "b".repeat(64);
    mocks.downloadPublicMapSource.mockResolvedValue({
      status: "ok",
      fileName: "Nackareservatet.omap",
      format: "OMAP",
      byteLength: 4,
      contentId: validUuid2,
      sha256: sha
    });
    mocks.streamMapContentParts.mockImplementation(async function* () {
      yield new Uint8Array([1, 2, 3, 4]);
    });
    const res = await publicMapBankDownloadRoute(fakeDb, validUuid);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    const notMod = await publicMapBankDownloadRoute(
      fakeDb,
      validUuid,
      new Request(`https://otid.se/api/public/map-bank/${validUuid}/download`, {
        headers: { "if-none-match": `W/"${sha}"` }
      })
    );
    expect(notMod.status).toBe(304);
    expect(notMod.headers.get("etag")).toBe(`"${sha}"`);
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);
  });

  it("enforces Origin and auth on usePublicMapListingRoute and returns 201 on success", async () => {
    const badOrigin = await usePublicMapListingRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/map-bank/${validUuid}/use`, { method: "POST", headers: authHeaders("https://evil.example") }),
      validUuid,
      env
    );
    expect(badOrigin.status).toBe(403);

    const noAuth = await usePublicMapListingRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/map-bank/${validUuid}/use`, { method: "POST", headers: { origin: "https://otid.se" } }),
      validUuid,
      env
    );
    expect(noAuth.status).toBe(401);

    mocks.createRaceFromPublicMapListing.mockResolvedValue({
      status: "created",
      eventId: validUuid,
      raceId: validUuid2,
      georeferenced: true,
      sourceDownloadLocked: true
    });
    const ok = await usePublicMapListingRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/map-bank/${validUuid}/use`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ formatVersion: 1, name: "Tisdagsträning" })
      }),
      validUuid,
      env
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({
      formatVersion: 1,
      eventId: validUuid,
      raceId: validUuid2,
      georeferenced: true,
      sourceDownloadLocked: true
    });
  });

  it("returns 403 CLUB_ACTIVITIES_ONLY with Swedish message on attach-race when scope blocks", async () => {
    mocks.attachClubMapVersionToRaceServerSide.mockResolvedValue({ status: "club-activity-only" });
    const res = await clubMapVersionAttachRaceRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/clubs/${validUuid}/map-versions/${validUuid2}/attach-race`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ formatVersion: 1, raceId: validUuid })
      }),
      validUuid,
      validUuid2,
      env
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe("CLUB_ACTIVITIES_ONLY");
    expect(body.message).toContain("klubbens egna aktiviteter");
  });

  it("handles clubMapCatalogRoute and mapProjectCatalogRoute DELETE", async () => {
    const deleteHeaders = {
      origin: "https://otid.se",
      cookie: `__Host-otid-organizer-session=${sessionTok}; __Host-otid-organizer-csrf=${csrfTok}`,
      "x-otid-csrf": csrfTok
    };
    mocks.removeClubMapCatalogListing.mockResolvedValue({ status: "removed" });
    const clubRes = await clubMapCatalogRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/clubs/${validUuid}/maps/${validUuid2}/catalog`, {
        method: "DELETE",
        headers: deleteHeaders
      }),
      validUuid,
      validUuid2,
      env
    );
    expect(clubRes.status).toBe(200);

    mocks.removeMapProjectCatalogListing.mockResolvedValue({ status: "removed" });
    const projRes = await mapProjectCatalogRoute(
      fakeDb,
      new Request(`https://otid.se/api/organizer/map-projects/${validUuid}/catalog`, {
        method: "DELETE",
        headers: deleteHeaders
      }),
      validUuid,
      env
    );
    expect(projRes.status).toBe(200);
  });
});
