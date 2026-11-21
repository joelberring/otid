import { mkdtemp, readFile, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cachePath, pickCacheEvictions, scanMapCache, sweepMapCache } from "../src/map-cache";
import { memoryArchiveStore } from "../src/map-archive-store";
import { storeModeProblems, uploadToStore } from "../src/map-store";
import { cacheSettingProblems, defaultCacheMaxMb } from "../src/installation-settings";

/** ADR-0229 (PLAN.md steg M1): mellanlagrets utträngning, städning och förrådets läge. */
const MB = 1024 * 1024;
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");

describe("mellanlagrets utträngning", () => {
  const entry = (name: string, mb: number, usedAtMs: number) => ({ path: name, bytes: mb * MB, usedAtMs });

  it("tar ingenting under taket", () => {
    expect(pickCacheEvictions([entry("a", 4, 1), entry("b", 5, 2)], 10 * MB)).toEqual([]);
  });

  it("över taket: minst nyligen använda först, tills det är under 90 %", () => {
    const picked = pickCacheEvictions([entry("ny", 3, 30), entry("gammal", 3, 10), entry("mitten", 3, 20), entry("äldst", 3, 5)], 10 * MB);
    // 12 MB mot taket 10 MB: när den äldsta är borta återstår 9 MB, alltså 90 % av taket.
    expect(picked.map(e => e.path)).toEqual(["äldst"]);
    const more = pickCacheEvictions([entry("a", 4, 1), entry("b", 4, 2), entry("c", 4, 3), entry("d", 4, 4)], 10 * MB);
    expect(more.map(e => e.path)).toEqual(["a", "b"]);
  });

  it("räknar övriga filer (uppladdningar under arbete) men tar dem aldrig", () => {
    expect(pickCacheEvictions([entry("a", 2, 1), entry("b", 2, 2)], 10 * MB, 9 * MB).map(e => e.path)).toEqual(["a", "b"]);
  });

  it("städar katalogen: gamla bort, kvarglömda temporära filer bort, färska temporära kvar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-cache-test-"));
    dirs.push(dir);
    const now = new Date("2026-11-21T12:00:00Z");
    const files = [sha("1"), sha("2"), sha("3")];
    for (const [index, name] of files.entries()) {
      const path = cachePath(dir, name);
      await mkdir(join(dir, name.slice(0, 2)), { recursive: true });
      await writeFile(path, Buffer.alloc(MB));
      const when = new Date(now.getTime() - (3 - index) * 3600_000);
      await utimes(path, when, when);
    }
    const oldTemp = join(dir, files[0]!.slice(0, 2), `.${files[0]}.x.tmp`), freshTemp = join(dir, files[1]!.slice(0, 2), `.${files[1]}.y.tmp`);
    await writeFile(oldTemp, "x"); await writeFile(freshTemp, "y");
    await utimes(oldTemp, new Date(now.getTime() - 2 * 3600_000), new Date(now.getTime() - 2 * 3600_000));
    await utimes(freshTemp, now, now);
    expect((await scanMapCache(dir, now)).files).toBe(3);
    const result = await sweepMapCache(dir, 2.5 * MB, now);
    expect(result.removed).toBe(2);
    await expect(readFile(cachePath(dir, files[0]!))).rejects.toThrow();
    await expect(readFile(oldTemp)).rejects.toThrow();
    expect((await readFile(cachePath(dir, files[2]!))).byteLength).toBe(MB);
    expect(await readFile(freshTemp, "utf8")).toBe("y");
  });
});

describe("förrådets läge och uppladdning", () => {
  it("varnar för på utan uppgifter och för fel värden", () => {
    expect(storeModeProblems({})).toEqual([]);
    expect(storeModeProblems({ OTID_STORE_MODE: "on" })[0]).toContain("OTID_ARCHIVE_ENDPOINT");
    expect(storeModeProblems({ OTID_STORE_MODE: "ja" })[0]).toContain("off eller on");
    expect(storeModeProblems({ OTID_STORE_MODE: "on", OTID_ARCHIVE_ENDPOINT: "e.test", OTID_ARCHIVE_BUCKET: "b-b", OTID_ARCHIVE_ACCESS_KEY: "a",
      OTID_ARCHIVE_SECRET_KEY: "s" })).toEqual([]);
    expect(defaultCacheMaxMb({})).toBe(10_240);
    expect(defaultCacheMaxMb({ OTID_CACHE_MAX_MB: "2048" })).toBe(2048);
    expect(cacheSettingProblems({ OTID_CACHE_MAX_MB: "1" })).toHaveLength(1);
  });

  it("räknar innehållet som uppladdat först när kopian stämmer", async () => {
    const store = memoryArchiveStore();
    const bytes = Buffer.from("kartfil");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await uploadToStore(store, hash, bytes.byteLength, { bytes });
    expect(store.objects.get(hash)?.equals(bytes)).toBe(true);
    const broken = { ...store, digest: async () => ({ byteLength: 1, sha256: hash }) };
    await expect(uploadToStore(broken, hash, bytes.byteLength, { bytes })).rejects.toThrow("stämmer inte");
  });
});
