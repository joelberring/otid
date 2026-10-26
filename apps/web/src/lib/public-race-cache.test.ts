import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cachedJsonResponse, createPublicRaceCache, isRetryableReadConflict } from "./public-race-cache";

const race = "10000000-0000-4000-8000-000000000001";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("steg 51: publika listor en gång per tävlingsversion", () => {
  it("räknar en gång per version, delar en pågående uträkning och räknar om när versionen ändras", async () => {
    let version = "v1", computed = 0;
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 0 });
    const compute = async () => { computed += 1; await delay(20); return { version, rows: [computed] }; };
    const first = await Promise.all(Array.from({ length: 50 }, () => cache.read(race, "results", compute)));
    expect(computed).toBe(1);
    expect(new Set(first.map((entry) => entry.etag)).size).toBe(1);
    expect((await cache.read(race, "results", compute)).value).toEqual({ version: "v1", rows: [1] });
    expect(computed).toBe(1);
    // En annan lista för samma tävling har en egen plats.
    await cache.read(race, "live", compute);
    expect(computed).toBe(2);
    version = "v2";
    const next = await cache.read(race, "results", compute);
    expect(next.value).toEqual({ version: "v2", rows: [3] });
    expect(next.etag).not.toBe(first[0]!.etag);
  });

  it("ger den senaste färdiga listan medan en långsam uträkning pågår, och den nya när den är klar", async () => {
    let version = "v1", slow = false;
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, waitMs: 30, versionTtlMs: 0 });
    const compute = async () => { if (slow) await delay(200); return version; };
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    version = "v2"; slow = true;
    const started = Date.now();
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    expect(Date.now() - started).toBeLessThan(150);
    await delay(250);
    expect((await cache.read(race, "results", compute)).value).toBe("v2");
  });

  it("räknar om högst en gång per minIntervalMs och efter maxAgeMs även utan ny version", async () => {
    let version = 1, computed = 0, clock = 0;
    const cache = createPublicRaceCache({ version: async () => `v${version}`, now: () => clock, minIntervalMs: 0, maxAgeMs: 1_000, versionTtlMs: 0, serveStaleMs: 0 });
    const compute = async () => { computed += 1; return computed; };
    await cache.read(race, "radio", compute);
    clock = 999;
    await cache.read(race, "radio", compute);
    expect(computed).toBe(1);
    clock = 1_000;
    await cache.read(race, "radio", compute);
    expect(computed).toBe(2);

    const paced = createPublicRaceCache({ version: async () => `v${version}`, minIntervalMs: 100, waitMs: 1_000, versionTtlMs: 0, serveStaleMs: 0 });
    const started = Date.now();
    await paced.read(race, "results", compute);
    version += 1;
    await paced.read(race, "results", compute);
    expect(Date.now() - started).toBeGreaterThanOrEqual(95);
  });

  it("ett fel i uträkningen sparas inte och ger fel bara när ingen tidigare lista finns", async () => {
    let fail = true, version = "v1";
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 0 });
    const compute = async () => { if (fail) throw new Error("databasen svarar inte"); return version; };
    await expect(cache.read(race, "results", compute)).rejects.toThrow("databasen svarar inte");
    fail = false;
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    fail = true; version = "v2";
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
  });

  it("svarar med gzip och ETag, 304 när innehållet är oförändrat och vanlig JSON utan gzip", async () => {
    const cache = createPublicRaceCache({ version: async () => "v1" });
    const entry = await cache.read(race, "results", async () => ({ formatVersion: 7, results: [{ givenName: "Alva" }] }));
    const packed = cachedJsonResponse(new Request("http://127.0.0.1/", { headers: { "accept-encoding": "gzip, br" } }), entry, "public, max-age=2");
    expect(packed.headers.get("content-encoding")).toBe("gzip");
    expect(packed.headers.get("vary")).toBe("accept-encoding");
    expect(JSON.parse(gunzipSync(Buffer.from(await packed.arrayBuffer())).toString("utf8"))).toEqual(entry.value);
    const plain = cachedJsonResponse(new Request("http://127.0.0.1/", { headers: { "accept-encoding": "gzip;q=0, br" } }), entry, "no-store");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("cache-control")).toBe("no-store");
    expect(await plain.json()).toEqual(entry.value);
    const same = cachedJsonResponse(new Request("http://127.0.0.1/", { headers: { "if-none-match": entry.etag } }), entry, "no-store");
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");
  });

  it("läser versionen högst en gång per versionTtlMs och tävling", async () => {
    let clock = 0, lookups = 0;
    const cache = createPublicRaceCache({ version: async () => { lookups += 1; return "v1"; }, now: () => clock, versionTtlMs: 500 });
    await cache.read(race, "results", async () => 1);
    const before = lookups;
    await Promise.all(Array.from({ length: 20 }, () => cache.read(race, "results", async () => 1)));
    await cache.read(race, "radio", async () => 2);
    expect(lookups).toBe(before + 1);
    clock = 600;
    await cache.read(race, "results", async () => 1);
    expect(lookups).toBe(before + 2);
  });

  it("ger en nyss räknad lista direkt medan nästa räknas, och fresh väntar på den nya versionen", async () => {
    let version = "v1";
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 1_000, waitMs: 5_000 });
    const compute = async () => { await delay(100); return version; };
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    version = "v2";
    const started = Date.now();
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    expect(Date.now() - started).toBeLessThan(50);
    expect((await cache.read(race, "results", compute, { fresh: true })).value).toBe("v2");
    expect((await cache.read(race, "results", compute)).value).toBe("v2");
  });

  it("en långsam uträkning glesar ut nästa (högst en tredjedel av tiden), så att avläsningarna får plats", async () => {
    let version = 1;
    const cache = createPublicRaceCache({ version: async () => `v${version}`, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 0, waitMs: 5_000 });
    const compute = async () => { await delay(60); return version; };
    await cache.read(race, "results", compute);
    version = 2;
    const started = Date.now();
    expect((await cache.read(race, "results", compute)).value).toBe(2);
    // Förra uträkningen tog ~60 ms: nästa börjar tidigast ~180 ms efter förra starten.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("gör om en läsning som PostgreSQL avbröt för en samtidig ändring (40001), men inte andra fel", async () => {
    let attempts = 0;
    const cache = createPublicRaceCache({ version: async () => "v1" });
    const conflict = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("could not serialize access"), { code: "40001" }) });
    const value = await cache.read(race, "results", async () => { attempts += 1; if (attempts < 3) throw conflict; return "klar"; });
    expect([value.value, attempts]).toEqual(["klar", 3]);
    expect(isRetryableReadConflict(new Error("annat"))).toBe(false);
    expect(isRetryableReadConflict({ code: "40P01" })).toBe(true);
  });
});
