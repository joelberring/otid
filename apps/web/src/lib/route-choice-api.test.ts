import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMapSource, mapSourceUrl } from "./route-choice-api";

const race = "11111111-1111-4111-8111-111111111111";
const sha = "ab".repeat(32);

describe("kartfilens adress och cache (ADR-0218)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bär filens sha256 som nyckel för webbläsarens cache; utan giltig sha256 den gamla adressen", () => {
    expect(mapSourceUrl(race, sha)).toBe(`/api/admin/races/${race}/administrator/map/source/${sha}`);
    expect(mapSourceUrl(race)).toBe(`/api/admin/races/${race}/administrator/map/source`);
    expect(mapSourceUrl(race, "AB".repeat(32))).toBe(`/api/admin/races/${race}/administrator/map/source`);
    expect(mapSourceUrl(race, "../x")).toBe(`/api/admin/races/${race}/administrator/map/source`);
  });

  it("hämtar med sha256 via webbläsarens cache och utan den som förut (no-store), med förlopp", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0xad, 0x0c, 1, 2]), { headers: { "content-length": "4",
      "content-disposition": "attachment; filename=\"karta.ocd\"" } }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: number[] = [];
    const file = await fetchMapSource(race, undefined, { sha256: sha, onProgress: fraction => seen.push(fraction) });
    expect(file.fileName).toBe("karta.ocd");
    expect([...new Uint8Array(file.bytes)]).toEqual([0xad, 0x0c, 1, 2]);
    expect(seen).toEqual([1]);
    expect(fetchMock.mock.calls[0]).toMatchObject([`/api/admin/races/${race}/administrator/map/source/${sha}`, { cache: "default" }]);
    await fetchMapSource(race);
    expect(fetchMock.mock.calls[1]).toMatchObject([`/api/admin/races/${race}/administrator/map/source`, { cache: "no-store" }]);
  });
});
