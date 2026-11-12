import { mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheName, fromCache, prune, toCache } from "../../../scripts/geo-cache.ts";

describe("laserrutornas förråd på geo-servern", () => {
  it("ger ofarliga filnamn", () => {
    expect(cacheName("65_6_5025_2019")).toBe("65_6_5025_2019.laz");
    expect(cacheName("../../etc/passwd")).toBe(".._.._etc_passwd.laz");
    expect(cacheName("")).toBe("ruta.laz");
  });
  it("sparar en ruta och lämnar den igen, och säger nej till en som saknas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-cache-")), cache = join(dir, "cache");
    await writeFile(join(dir, "a.laz"), "laserdata");
    expect(await fromCache(cache, "ruta-a", join(dir, "ut.laz"))).toBe(false);
    await toCache(cache, "ruta-a", join(dir, "a.laz"));
    expect(await fromCache(cache, "ruta-a", join(dir, "ut.laz"))).toBe(true);
    expect(await readFile(join(dir, "ut.laz"), "utf8")).toBe("laserdata");
  });
  it("tar bort de längst oanvända när förrådet är fullt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-cache-"));
    for (const [name, age] of [["gammal.laz", 3000], ["mellan.laz", 2000], ["ny.laz", 1000]] as const) {
      await writeFile(join(dir, name), "x".repeat(100));
      const at = new Date(Date.now() - age * 1000);
      await utimes(join(dir, name), at, at);
    }
    expect(await prune(dir, 250)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(["mellan.laz", "ny.laz"]);
  });
});
