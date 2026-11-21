import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pinWindowDays, racePinnedNow, selectPinned } from "../src/map-pin";
import { cachePath, markPinned, pickCacheEvictions, pinnedDir, readPinMarkers, releasePinMarkers, scanMapCache, sweepMapCache } from "../src/map-cache";

/** PLAN.md steg M2: urvalet av det som spikas fast och utträngningen med fastspikat. */
const MB = 1024 * 1024;
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
const STHLM = "Europe/Stockholm";

describe("fastspikningens urval", () => {
  it("fönstret är dagen före till dagen efter", () => {
    expect(pinWindowDays()).toEqual({ before: 1, after: 1 });
  });

  it("räknar dagen i eventets tidszon, också runt midnatt", () => {
    // Stockholm by Night 9 december. 23:30 den 7:e i Stockholm är 22:30 UTC – två dagar före: inte spikad.
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-07T22:30:00Z"))).toBe(false);
    // 00:30 den 8:e i Stockholm (23:30 UTC den 7:e): dagen före, spikad fast UTC-datumet är två dagar före.
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-07T23:30:00Z"))).toBe(true);
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-09T12:00:00Z"))).toBe(true);
    // 23:59 den 10:e i Stockholm: dagen efter, spikad; 00:01 den 11:e: släppt.
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-10T22:59:00Z"))).toBe(true);
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-10T23:01:00Z"))).toBe(false);
    // Samma ögonblick i en annan tidszon ger en annan dag.
    expect(racePinnedNow("2026-12-09", "America/New_York", new Date("2026-12-11T03:00:00Z"))).toBe(true);
    expect(racePinnedNow("2026-12-09", STHLM, new Date("2026-12-11T03:00:00Z"))).toBe(false);
    // En okänd tidszon spikas hellre än inte.
    expect(racePinnedNow("2026-12-09", "Inte/EnZon", new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });

  it("ger varje innehåll en gång, med tävlingsdygnet om något lopp har det nu", () => {
    const now = new Date("2026-12-09T18:00:00Z");
    const pinned = selectPinned([
      { raceDate: "2026-12-09", timeZone: STHLM, sha256: sha("bild"), byteLength: 10 },
      { raceDate: "2026-12-09", timeZone: STHLM, sha256: sha("fil"), byteLength: 20 },
      { raceDate: "2026-12-10", timeZone: STHLM, sha256: sha("bild"), byteLength: 10 },
      { raceDate: "2026-12-10", timeZone: STHLM, sha256: sha("i-morgon"), byteLength: 30 },
      { raceDate: "2026-12-12", timeZone: STHLM, sha256: sha("senare"), byteLength: 40 },
      { raceDate: "2026-12-07", timeZone: STHLM, sha256: sha("förrförra"), byteLength: 50 }
    ], now);
    expect(pinned.map(content => content.sha256).sort()).toEqual([sha("bild"), sha("fil"), sha("i-morgon")].sort());
    expect(pinned.find(content => content.sha256 === sha("bild"))?.raceDay).toBe(true);
    expect(pinned.find(content => content.sha256 === sha("i-morgon"))?.raceDay).toBe(false);
    // Kl 11 dagen efter är det fortfarande tävlingsdygnet (ADR-0178).
    const night = selectPinned([{ raceDate: "2026-12-09", timeZone: STHLM, sha256: sha("natt"), byteLength: 1 }], new Date("2026-12-10T10:00:00Z"));
    expect(night).toEqual([{ sha256: sha("natt"), byteLength: 1, raceDay: true }]);
  });
});

describe("utträngningen med fastspikat", () => {
  const entry = (name: string, mb: number, usedAtMs: number) => ({ path: `/c/${name.slice(0, 2)}/${name}`, bytes: mb * MB, usedAtMs });

  it("tar aldrig ett fastspikat och räknar det utanför taket", () => {
    const old = sha("gammal"), pinnedOld = sha("spikad"), fresh = sha("ny");
    const entries = [entry(pinnedOld, 8, 1), entry(old, 3, 2), entry(fresh, 3, 3)];
    // Utan spikat: 14 MB mot 10 MB, den äldsta (8 MB) bort.
    expect(pickCacheEvictions(entries, 10 * MB).map(e => e.path)).toEqual([entries[0]!.path]);
    // Det spikade räknas inte: 6 MB under taket 10 MB, inget bort.
    expect(pickCacheEvictions(entries, 10 * MB, 0, new Set([pinnedOld]))).toEqual([]);
    // Över taket utan det spikade: bara ospikade tas, också när det spikade är äldst.
    expect(pickCacheEvictions(entries, 5 * MB, 0, new Set([pinnedOld])).map(e => e.path)).toEqual([entries[1]!.path]);
    // Allt spikat och långt över: ingenting tas.
    expect(pickCacheEvictions(entries, MB, 0, new Set([pinnedOld, old, fresh]))).toEqual([]);
  });

  it("städningen läser markeringarna, och markeringar som inte ska vara kvar släpps efter fristen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-pin-test-"));
    dirs.push(dir);
    const now = new Date("2026-12-09T12:00:00Z");
    const names = [sha("a"), sha("b"), sha("c")];
    for (const [index, name] of names.entries()) {
      const path = cachePath(dir, name);
      await mkdir(join(dir, name.slice(0, 2)), { recursive: true });
      await writeFile(path, Buffer.alloc(MB));
      const when = new Date(now.getTime() - (3 - index) * 3600_000);
      await utimes(path, when, when);
    }
    await markPinned(dir, [names[0]!], now);
    // Markeringarna räknas inte som filer i mellanlagret och städas inte som kvarglömda.
    expect((await scanMapCache(dir, new Date(now.getTime() + 48 * 3600_000))).stale).toEqual([]);
    const result = await sweepMapCache(dir, 1.5 * MB, now);
    expect(result).toMatchObject({ removed: 1, pinnedFiles: 1, pinnedBytes: MB });
    expect((await readFile(cachePath(dir, names[0]!))).byteLength).toBe(MB);
    await expect(readFile(cachePath(dir, names[1]!))).rejects.toThrow();
    expect((await readFile(cachePath(dir, names[2]!))).byteLength).toBe(MB);

    await markPinned(dir, [names[2]!], now);
    expect(await releasePinMarkers(dir, new Set(), 15 * 60_000, new Date(now.getTime() + 5 * 60_000))).toBe(0);
    expect(await releasePinMarkers(dir, new Set([names[0]!]), 15 * 60_000, new Date(now.getTime() + 20 * 60_000))).toBe(1);
    expect([...(await readPinMarkers(dir)).keys()]).toEqual([names[0]]);
    expect(await readdir(pinnedDir(dir))).toEqual([names[0]]);
    await expect(markPinned(dir, ["inte-en-summa"], now)).rejects.toThrow("Ogiltig");
  });
});
