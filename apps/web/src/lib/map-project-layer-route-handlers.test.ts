import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  readMapProjectLayerImage: vi.fn(),
  readMapProjectNotePhoto: vi.fn(),
  readClubMapVersionHead: vi.fn(),
  streamMapContentParts: vi.fn()
}));

vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(),
  readMapProjectLayerImage: mocks.readMapProjectLayerImage,
  readMapProjectNotePhoto: mocks.readMapProjectNotePhoto,
  readClubMapVersionHead: mocks.readClubMapVersionHead,
  streamMapContentParts: mocks.streamMapContentParts
}));

import { mapProjectLayerImageRoute } from "./map-project-layer-route-handlers";
import { mapProjectNotePhotoRoute } from "./map-project-recon-route-handlers";
import { clubMapVersionRoute } from "./club-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const id1 = "10000000-0000-4000-8000-000000000001";
const id2 = "10000000-0000-4000-8000-000000000002";
const contentId = "10000000-0000-4000-8000-000000000003";
const session = `otid_user_session_v1.${id1}.${"s".repeat(43)}`;
const sha = "e".repeat(64);

async function* singleChunk(bytes: Uint8Array) { yield bytes; }

describe("privata kartfiler, underlag och notisfoton: 304 före läsning och cache-rubriker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapProjectLayerImageRoute ger 304 på svag ETag utan att anropa streamMapContentParts", async () => {
    mocks.readMapProjectLayerImage.mockResolvedValue({
      status: "ok", mediaType: "image/webp", byteLength: 4, contentId, sha256: sha
    });
    mocks.streamMapContentParts.mockReturnValueOnce(singleChunk(new Uint8Array([1, 2, 3, 4])));

    const ok = await mapProjectLayerImageRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${id1}/layers/${id2}/image?v=${sha}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      id1, id2, env
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(ok.headers.get("vary")).toBe("Cookie");
    expect(ok.headers.get("etag")).toBe(`"${sha}"`);
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    const cached = await mapProjectLayerImageRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${id1}/layers/${id2}/image`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}`, "if-none-match": `W/"${sha}"` }
      }),
      id1, id2, env
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("cache-control")).toBe("private, no-cache");
    expect(cached.headers.get("vary")).toBe("Cookie");
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);
  });

  it("clubMapVersionRoute ger 304 på svag ETag utan att anropa streamMapContentParts", async () => {
    mocks.readClubMapVersionHead.mockResolvedValue({
      status: "ok", fileName: "Skogen.omap", format: "OMAP", byteLength: 3, contentId, sha256: sha
    });
    mocks.streamMapContentParts.mockReturnValueOnce(singleChunk(new Uint8Array([7, 8, 9])));

    const ok = await clubMapVersionRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${id1}/map-versions/${id2}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      id1, id2, env
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-cache");
    expect(ok.headers.get("vary")).toBe("Cookie");
    expect(ok.headers.get("etag")).toBe(`"${sha}"`);
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);

    const cached = await clubMapVersionRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/clubs/${id1}/map-versions/${id2}?v=${sha.slice(0, 16)}`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}`, "if-none-match": `"other", W/"${sha}"` }
      }),
      id1, id2, env
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(cached.headers.get("vary")).toBe("Cookie");
    expect(mocks.streamMapContentParts).toHaveBeenCalledTimes(1);
  });

  it("mapProjectNotePhotoRoute ger ETag, private immutable + Vary: Cookie och 304 på svag ETag", async () => {
    mocks.readMapProjectNotePhoto.mockResolvedValue({
      status: "ok", mediaType: "image/jpeg", photo: Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    });

    const ok = await mapProjectNotePhotoRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${id1}/notes/${id2}/photo`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}` }
      }),
      id1, id2, env
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(ok.headers.get("vary")).toBe("Cookie");
    const etag = ok.headers.get("etag");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const cached = await mapProjectNotePhotoRoute(
      db,
      new Request(`https://tid.klubb.se/api/organizer/map-projects/${id1}/notes/${id2}/photo`, {
        headers: { cookie: `__Host-otid-organizer-session=${session}`, "if-none-match": `W/${etag}` }
      }),
      id1, id2, env
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(etag);
    expect(cached.headers.get("vary")).toBe("Cookie");
  });
});
