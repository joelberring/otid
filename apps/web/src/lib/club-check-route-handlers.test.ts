import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  readClubMapVersionThumbnail: vi.fn(),
  readClubEntryThumbnail: vi.fn()
}));

vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(),
  readClubMapVersionThumbnail: mocks.readClubMapVersionThumbnail,
  readClubEntryThumbnail: mocks.readClubEntryThumbnail
}));

import { clubEntryThumbnailRoute, clubMapVersionCheckRoute } from "./club-check-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const clubId = "10000000-0000-4000-8000-000000000001";
const versionId = "10000000-0000-4000-8000-000000000002";
const entryId = "10000000-0000-4000-8000-000000000003";
const session = `otid_user_session_v1.${clubId}.${"s".repeat(43)}`;
const stamp = "2026-11-26T10:00:00.000Z";
const stampMs = Date.parse(stamp);

describe("club-check-route-handlers: tumnagelcache och 304 före byte-läsning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ger private, max-age=86400, immutable + Vary: Cookie när ?v= matchar tidsstämpeln och private, no-cache annars", async () => {
    const etag = `"${versionId}-${stampMs}"`;
    mocks.readClubMapVersionThumbnail.mockResolvedValue({ status: "ok", png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), etag, stamp });

    // Matchande ISO-stämpel i ?v= (som club-archive-thumbnails.ts skickar)
    const versioned = await clubMapVersionCheckRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${clubId}/map-versions/${versionId}/check?v=${encodeURIComponent(stamp)}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      clubId, versionId, env
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(versioned.headers.get("vary")).toBe("Cookie");
    expect(versioned.headers.get("etag")).toBe(etag);

    // Matchande epok-ms i ?v=
    const versionedMs = await clubMapVersionCheckRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${clubId}/map-versions/${versionId}/check?v=${stampMs}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      clubId, versionId, env
    );
    expect(versionedMs.headers.get("cache-control")).toBe("private, max-age=86400, immutable");

    // Utan ?v= eller fel ?v= → private, no-cache + Vary: Cookie
    const unversioned = await clubMapVersionCheckRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${clubId}/map-versions/${versionId}/check`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      clubId, versionId, env
    );
    expect(unversioned.status).toBe(200);
    expect(unversioned.headers.get("cache-control")).toBe("private, no-cache");
    expect(unversioned.headers.get("vary")).toBe("Cookie");
  });

  it("skickar ifNoneMatch till tjänsten och svarar 304 på not-modified samt svag W/-ETag", async () => {
    const etag = `"${entryId}-${stampMs}"`;
    mocks.readClubEntryThumbnail.mockResolvedValueOnce({ status: "not-modified", etag, stamp });

    const notMod = await clubEntryThumbnailRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${clubId}/archive/${entryId}/thumbnail?v=${encodeURIComponent(stamp)}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}`, "if-none-match": `W/${etag}` }
      }),
      clubId, entryId, env
    );
    expect(notMod.status).toBe(304);
    expect(notMod.headers.get("etag")).toBe(etag);
    expect(notMod.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(notMod.headers.get("vary")).toBe("Cookie");
    expect(mocks.readClubEntryThumbnail).toHaveBeenCalledWith(db, expect.objectContaining({
      clubId, entryId, ifNoneMatch: `W/${etag}`
    }));
  });
});
