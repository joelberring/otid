import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { publicRaceMapResponse } from "./public-race-map-route";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const sha = "a".repeat(64);
const contentId = "20000000-0000-4000-8000-000000000002";

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

describe("publik kartbild: metadata-304 före byte-läsning och strömning", () => {
  it("ger 304 på stark ETag, svag W/-ETag och * utan att strömma eller läsa kartbytes", async () => {
    const streamParts = vi.fn(() => chunks(new Uint8Array([1, 2, 3])));
    const readInline = vi.fn();
    const deps = {
      readHead: async () => ({ mediaType: "image/png", sha256: sha, byteLength: 3, contentId }),
      readInline,
      streamParts
    };
    for (const inm of [`"${sha}"`, `W/"${sha}"`, `"annat", W/"${sha}"`, "*"]) {
      const response = await publicRaceMapResponse(db,
        new Request(`http://127.0.0.1/api/public/races/${raceId}/map?v=${sha.slice(0, 16)}`, { headers: { "if-none-match": inm } }),
        raceId, deps);
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe(`"${sha}"`);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(await response.text()).toBe("");
    }
    expect(streamParts).not.toHaveBeenCalled();
    expect(readInline).not.toHaveBeenCalled();
  });

  it("strömmar kartbilden via streamMapContentParts när contentId finns", async () => {
    const readInline = vi.fn();
    const streamParts = vi.fn(() => chunks(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])));
    const response = await publicRaceMapResponse(db,
      new Request(`http://127.0.0.1/api/public/races/${raceId}/map`),
      raceId,
      {
        readHead: async () => ({ mediaType: "image/jpeg", sha256: sha, byteLength: 5, contentId }),
        readInline,
        streamParts
      });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("5");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(streamParts).toHaveBeenCalledWith(db, contentId);
    expect(readInline).not.toHaveBeenCalled();
  });

  it("använder zero-copy inline-fallback när contentId saknas (äldre rader)", async () => {
    const payload = Buffer.from([9, 8, 7, 6]);
    const streamParts = vi.fn(() => chunks());
    const response = await publicRaceMapResponse(db,
      new Request(`http://127.0.0.1/api/public/races/${raceId}/map?v=${sha.slice(0, 16)}`),
      raceId,
      {
        readHead: async () => ({ mediaType: "image/png", sha256: sha, byteLength: 4, contentId: null }),
        readInline: async () => ({ mediaType: "image/png", image: payload, sha256: sha }),
        streamParts
      });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(streamParts).not.toHaveBeenCalled();
  });

  it("ger 404 när kartan saknas eller är dold", async () => {
    const response = await publicRaceMapResponse(db,
      new Request(`http://127.0.0.1/api/public/races/${raceId}/map`),
      raceId,
      { readHead: async () => undefined, readInline: vi.fn(), streamParts: vi.fn() });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
