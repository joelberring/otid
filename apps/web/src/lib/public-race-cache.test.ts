import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cachedJsonResponse, createPublicRaceCache, isRetryableReadConflict, onlyNewResults } from "./public-race-cache";

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
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, waitMs: 30, versionTtlMs: 0, staleAllowed: () => true });
    const compute = async () => { if (slow) await delay(200); return version; };
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    version = "v2"; slow = true;
    const started = Date.now();
    const stale = await cache.read(race, "results", compute);
    expect([stale.value, stale.stale]).toEqual(["v1", true]);
    expect(Date.now() - started).toBeLessThan(150);
    await delay(250);
    const fresh = await cache.read(race, "results", compute);
    expect([fresh.value, fresh.stale]).toEqual(["v2", undefined]);
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
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 1_000, waitMs: 5_000,
      staleAllowed: () => true });
    const compute = async () => { await delay(100); return version; };
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    version = "v2";
    const started = Date.now();
    expect((await cache.read(race, "results", compute)).value).toBe("v1");
    expect(Date.now() - started).toBeLessThan(50);
    expect((await cache.read(race, "results", compute, { fresh: true })).value).toBe("v2");
    expect((await cache.read(race, "results", compute)).value).toBe("v2");
  });

  it("väntar på den nya listan när något annat än nya resultat ändrats, även om en uträkning redan pågick", async () => {
    let version = "3:10:fast:pub:0:-";
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, serveStaleMs: 10_000,
      waitMs: 10, staleAllowed: onlyNewResults });
    const compute = async () => { const seen = version; await delay(80); return seen; };
    await cache.read(race, "results", compute);
    // Ett nytt resultat: den nyss räknade listan direkt, märkt som äldre.
    version = "3:11:fast:pub:0:-";
    const quick = await cache.read(race, "results", compute);
    expect([quick.value, quick.stale]).toEqual(["3:10:fast:pub:0:-", true]);
    // Fastställandet ångras medan listan för resultat 11 räknas: anropet väntar ut den och räknar en gång till.
    version = "3:11:-:pub:0:-";
    const undone = await cache.read(race, "results", compute);
    expect([undone.value, undone.stale]).toEqual(["3:11:-:pub:0:-", undefined]);
    // Svaret för en äldre version sparas inte i webbläsaren och märks.
    const response = cachedJsonResponse(new Request("http://localhost/"), quick, "public, max-age=2");
    expect([response.headers.get("x-otid-stale"), response.headers.get("cache-control")]).toEqual(["1", "no-store"]);
    expect(cachedJsonResponse(new Request("http://localhost/"), undone, "public, max-age=2").headers.get("x-otid-stale")).toBeNull();
  });

  it("väckningen (fresh) väntar ut en uträkning från före avläsningen och räknar om med den nya", async () => {
    let version = "3:10:-:pub:0:-";
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, staleAllowed: onlyNewResults });
    const compute = async () => { const seen = version; await delay(60); return seen; };
    await cache.read(race, "live", compute);
    version = "3:11:-:pub:0:-";
    const before = cache.read(race, "live", compute, { exact: true });
    await delay(10);
    version = "3:12:-:pub:0:-";
    const woken = await cache.read(race, "live", compute, { fresh: true });
    expect([woken.value, woken.stale]).toEqual(["3:12:-:pub:0:-", undefined]);
    await before;
  });

  it("minns vilka tävlingar instansen visat, men inte uppvärmningens egna läsningar", async () => {
    let clock = 0;
    const cache = createPublicRaceCache({ version: async () => "v1", now: () => clock, versionTtlMs: 0 });
    const other = "10000000-0000-4000-8000-000000000002";
    await cache.read(race, "live", async () => 1);
    await cache.read(other, "live", async () => 1, { fresh: true });
    clock = 60_000;
    expect([cache.recentlyRead(race, 120_000), cache.recentlyRead(other, 120_000)]).toEqual([true, false]);
    clock = 120_000;
    expect(cache.recentlyRead(race, 120_000)).toBe(false);
  });

  it("bara resultatströmmens markör får skilja versionerna åt för att visa den förra listan", () => {
    expect(onlyNewResults("3:10:-:pub:0:-", "3:12:-:pub:0:-")).toBe(true);
    expect(onlyNewResults("3:10:fast:pub:0:-", "3:10:-:pub:0:-")).toBe(false);
    expect(onlyNewResults("3:10:-:pub:0:-", "4:10:-:pub:0:-")).toBe(false);
    expect(onlyNewResults("3:10:-:pub:0:-", "3:10:-:pub:1:-")).toBe(false);
    expect(onlyNewResults("3:10:-:pub:0:-", "3:10:-:pub:0:kl")).toBe(false);
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

describe("steg 57: den senast räknade listan för avläsningens placering", () => {
  it("ger listan direkt efter nya resultat och räknar om i bakgrunden; väntar efter en annan ändring och utan lista", async () => {
    let version = "1:10:-", computed = 0, slow = 0;
    const cache = createPublicRaceCache({ version: async () => version, minIntervalMs: 0, versionTtlMs: 0, computeShare: 0 });
    const compute = async () => { computed += 1; if (slow) await delay(slow); return version; };
    // Ingen lista: väntar på uträkningen (högst waitMs).
    expect((await cache.latest(race, "results:staff", compute, 500))?.value).toBe("1:10:-");
    // Bara nya resultat (andra delen): den gamla listan direkt, ny uträkning i bakgrunden.
    version = "1:11:-"; slow = 100;
    const started = Date.now();
    const old = await cache.latest(race, "results:staff", compute, 500);
    expect(old?.value).toBe("1:10:-");
    expect(Date.now() - started).toBeLessThan(80);
    await delay(150);
    expect(computed).toBe(2);
    expect((await cache.latest(race, "results:staff", compute, 500))?.value).toBe("1:11:-");
    // Något annat ändrat (första delen): ingen gammal lista; för lång uträkning ger undefined.
    version = "2:11:-"; slow = 200;
    expect(await cache.latest(race, "results:staff", compute, 50)).toBeUndefined();
    await delay(250);
    const fresh = await cache.latest(race, "results:staff", compute, 50);
    expect(fresh?.value).toBe("2:11:-");
    expect(fresh!.startedAt).toBeLessThanOrEqual(fresh!.at);
  });
});
