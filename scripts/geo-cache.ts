import { copyFile, link, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";

/** Hårdlänkar när samma filsystem används (0 s disk-I/O på 200 MB .laz), faller annars tillbaka på copyFile (t.ex. EXDEV). */
async function linkOrCopy(source: string, target: string): Promise<void> {
  try {
    await link(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await rm(target, { force: true });
      try { await link(source, target); return; } catch { /* faller tillbaka nedan */ }
    }
    await copyFile(source, target);
  }
}

/**
 * Ägaren 2026-11-12 («om typ de senaste 20 laserkörningarna kan sparas på geoservern … så att man kan göra ändringar
 * lättare»): laserrutorna som hämtats sparas på geo-serverns disk så länge servern lever (den är uppe en timme efter senaste
 * jobbet). En omkörning med andra inställningar hämtar då inget från Lantmäteriet igen. Högst `MAX_BYTES` sparas; de som
 * använts längst sedan tas bort först.
 */
export const CACHE_MAX_BYTES = 20 * 2 ** 30;

/** Filnamnet för en ruta: bara tecken som är ofarliga i ett filnamn (rutans id kommer från Lantmäteriets katalog). */
export const cacheName = (tileId: string) => `${tileId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 150) || "ruta"}.laz`;

/** Länkar eller kopierar rutan ur förrådet till `target` och märker den som nyss använd. Ger false om den inte finns. */
export async function fromCache(cacheDir: string, tileId: string, target: string): Promise<boolean> {
  const file = join(cacheDir, cacheName(tileId));
  try {
    if ((await stat(file)).size === 0) return false;
    await linkOrCopy(file, target);
    const now = new Date();
    await utimes(file, now, now);
    return true;
  } catch { return false; }
}

/** Lägger en hämtad ruta i förrådet (via en tillfällig fil, så att en halv fil aldrig ligger där) och rensar det äldsta. */
export async function toCache(cacheDir: string, tileId: string, source: string, maxBytes = CACHE_MAX_BYTES): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const file = join(cacheDir, cacheName(tileId)), part = `${file}.del`;
    await linkOrCopy(source, part);
    await rename(part, file);
    await prune(cacheDir, maxBytes);
  } catch { /* Förrådet är en bekvämlighet: ett fullt eller trasigt förråd får inte fälla jobbet. */ }
}

/** En tillfällig `.del`-fil yngre än så är en kopiering som pågår (rutor hämtas parallellt) och får inte röras. */
const STALE_PART_MS = 10 * 60_000;

/**
 * Tar bort de längst oanvända filerna tills förrådet ryms i `maxBytes`, och övergivna `.del`-filer (äldre än tio minuter).
 * Pågående kopieringar från parallella rutor lämnas orörda, och en fil som försvinner under genomgången hoppas över.
 * Ger antalet borttagna.
 */
export async function prune(cacheDir: string, maxBytes = CACHE_MAX_BYTES): Promise<number> {
  const now = Date.now();
  const found = await Promise.all((await readdir(cacheDir)).map(async name => {
    try {
      const info = await stat(join(cacheDir, name));
      return { name, size: info.size, used: info.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; // en parallell kopiering döptes om
      throw error;
    }
  }));
  const rows = found.filter((row): row is NonNullable<typeof row> => row !== undefined);
  rows.sort((a, b) => b.used - a.used);
  let total = 0, removed = 0;
  for (const row of rows) {
    if (row.name.endsWith(".del")) {
      if (now - row.used > STALE_PART_MS) { await rm(join(cacheDir, row.name), { force: true }); removed += 1; }
      continue;
    }
    total += row.size;
    if (total > maxBytes) { await rm(join(cacheDir, row.name), { force: true }); removed += 1; }
  }
  return removed;
}

/**
 * PLAN.md M6: ingen laserdata ligger kvar på geo-servern efter en körning. Arbetskatalogen rensas efter varje jobb, och vid
 * start (behållaren startas om efter en krasch, och då hann `finally` inte köras); rutornas förråd (`geo-cache.ts`) töms vid
 * start och när arbetaren slutar.
 */
export async function clearLeftovers(work: string, cache: string): Promise<number> {
  let removed = 0;
  // Bara jobbens kataloger (jobbets id) och rutornas filer, så att en felinställd katalog (t.ex. /tmp) inte töms.
  for (const name of await readdir(work).catch(() => [] as string[])) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) continue;
    await rm(join(work, name), { recursive: true, force: true }); removed += 1;
  }
  for (const name of await readdir(cache).catch(() => [] as string[])) {
    if (!/\.la[sz](\.del)?$/i.test(name)) continue;
    await rm(join(cache, name), { force: true }); removed += 1;
  }
  return removed;
}
