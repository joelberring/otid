import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { link, mkdir, open, readdir, rename, rm, stat, utimes, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";
import { cacheMaxBytes, readInstallationSettings } from "./installation-settings";
import { mapArchiveStore, type ArchiveStore } from "./map-archive-store";

/**
 * ADR-0229 (PLAN.md steg M1): mellanlagret på serverns disk för innehåll som ligger i förrådet (`map_content.stored_in =
 * 'STORE'`). Katalogen är `OTID_CACHE_DIR` (i drift /cache, volymen ./map-cache, delad av web, web-public, web-public2 och
 * print-worker). Filerna heter `<sha256[0..2]>/<sha256>`; uppladdningar under arbete ligger i `.staging/` och hämtningar
 * under arbete som `.<sha256>.<slump>.tmp` bredvid sin slutliga plats.
 *
 * - **Läsning:** filen i mellanlagret, annars hämtas den ur förrådet till en temporär fil, kontrolleras (längd och sha256)
 *   och byter namn (atomiskt på samma filsystem). Två processer som hämtar samtidigt skriver var sin temporära fil och den
 *   sista namnbytet vinner; innehållet är detsamma, så det är ofarligt.
 * - **Användning:** filens mtime sätts när den läses (högst var 10:e minut) och `map_content.last_used_at` likaså.
 * - **Utträngning:** när mellanlagret passerar taket tas de minst nyligen använda filerna bort tills det ligger under 90 %.
 *   En fil som någon läser just nu förstörs inte: på Linux lever en öppen fil kvar tills den stängs, också efter unlink.
 *   Därför öppnas en hämtad fil innan den byter namn, och läsningen sker alltid ur en öppen fil.
 * - **Fastspikat** (PLAN.md steg M2, `map-pin.ts`): en tom fil `.pinned/<sha256>` för varje innehåll som en tävling eller
 *   träning behöver från dagen före till dagen efter. Utträngningen tar aldrig ett fastspikat innehåll och räknar det utanför
 *   taket. Markeringarna är filer, så att alla processer som delar katalogen (web, publikens instanser, utskriftsarbetaren)
 *   ser dem utan att fråga databasen. Städningen läser markeringarna efter genomgången av filerna, så att en fil som spikats
 *   före läsningen alltid skyddas.
 */
const MINUTE = 60_000;
const TOUCH_MS = 10 * MINUTE;
const SHA = /^[0-9a-f]{64}$/;
const PINNED = ".pinned";
type Env = Partial<Record<string, string | undefined>>;

interface CacheState {
  usable: Map<string, boolean>;
  touchedFiles: Map<string, number>;
  touchedRows: Map<string, number>;
  privileges?: { touch: boolean; count: boolean; settings: boolean };
  capBytes: number | null;
  capReadAt: number;
  estimateBytes: number | null;
  sweeping: boolean;
  lastSweepAt: number;
}
const globalCache = globalThis as typeof globalThis & { oTidMapCache?: CacheState; oTidMapCacheDir?: string };
const state = (): CacheState => globalCache.oTidMapCache ??= { usable: new Map(), touchedFiles: new Map(), touchedRows: new Map(),
  capBytes: null, capReadAt: 0, estimateBytes: null, sweeping: false, lastSweepAt: 0 };

/** Mellanlagrets katalog: det som satts (tester), `OTID_CACHE_DIR` eller en katalog under tmp. */
export function mapCacheDir(env: Env = process.env): string {
  return globalCache.oTidMapCacheDir ?? (env.OTID_CACHE_DIR?.trim() || join(tmpdir(), "otid-cache"));
}

/** Sätter katalogen (tester); undefined = miljön igen. */
export function setMapCacheDir(dir: string | undefined): void {
  if (dir === undefined) delete globalCache.oTidMapCacheDir; else globalCache.oTidMapCacheDir = dir;
  state().usable.clear();
  state().estimateBytes = null;
}

/**
 * Katalogen om den går att skriva i (skapas vid behov; prövas en gång per process och katalog), annars null. Utan
 * skrivbart mellanlager skrivs nytt innehåll som förut i databasen och innehåll i förrådet läses direkt därifrån.
 */
export function usableMapCacheDir(env: Env = process.env): string | null {
  const dir = mapCacheDir(env);
  const known = state().usable.get(dir);
  if (known !== undefined) return known ? dir : null;
  let ok = true;
  try {
    mkdirSync(join(dir, ".staging"), { recursive: true });
    accessSync(dir, constants.W_OK);
    accessSync(join(dir, ".staging"), constants.W_OK);
  } catch (error) {
    ok = false;
    console.warn(`Mellanlagret ${dir} går inte att skriva i (${error instanceof Error ? error.message : String(error)}); ` +
      "nytt kartinnehåll sparas i databasen och innehåll i förrådet läses direkt därifrån");
  }
  state().usable.set(dir, ok);
  return ok ? dir : null;
}

export const cachePath = (dir: string, sha256: string) => {
  if (!SHA.test(sha256)) throw new Error("Ogiltig kontrollsumma för mellanlagret");
  return join(dir, sha256.slice(0, 2), sha256);
};
export const stagingPath = (dir: string, contentId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(contentId)) throw new Error("Ogiltigt id för uppladdningen");
  return join(dir, ".staging", contentId);
};

/** Vad databasrollen får göra (utskriftsrollen får bara läsa om `deploy/db-roles.sh setup` inte körts om). Prövas en gång. */
async function privileges(tx: DbExecutor): Promise<NonNullable<CacheState["privileges"]>> {
  const known = state().privileges;
  if (known) return known;
  const [row] = (await tx.execute<{ touch: boolean; count: boolean; settings: boolean }>(sql`select
    has_column_privilege('map_content', 'last_used_at', 'UPDATE') as touch,
    has_table_privilege('map_store_fetch_day', 'INSERT,UPDATE') as count,
    has_table_privilege('installation_setting', 'SELECT') as settings`)).rows;
  const result = { touch: row?.touch === true, count: row?.count === true, settings: row?.settings === true };
  state().privileges = result;
  return result;
}

const throttled = (map: Map<string, number>, key: string, now: number) => {
  const last = map.get(key);
  if (last !== undefined && now - last < TOUCH_MS) return true;
  if (map.size > 20_000) map.clear();
  map.set(key, now);
  return false;
};

/** Sätter `last_used_at` (högst var 10:e minut per innehåll och process, och bara om den är äldre än 10 minuter). */
export async function touchMapContent(tx: DbExecutor, sha256: string, now: Date): Promise<void> {
  if (throttled(state().touchedRows, sha256, now.getTime()) || !(await privileges(tx)).touch) return;
  await tx.execute(sql`update map_content set last_used_at = ${now} where sha256 = ${sha256}
    and (last_used_at is null or last_used_at < ${new Date(now.getTime() - TOUCH_MS)})`);
}

/** En hämtning ur förrådet, räknad per dygn (svensk tid) för superadminsidan. */
export async function countFetch(tx: DbExecutor, byteLength: number, now: Date): Promise<void> {
  if (!(await privileges(tx)).count) return;
  await tx.execute(sql`insert into map_store_fetch_day (day, fetches, bytes)
    values ((${now}::timestamptz at time zone 'Europe/Stockholm')::date, 1, ${byteLength})
    on conflict (day) do update set fetches = map_store_fetch_day.fetches + 1, bytes = map_store_fetch_day.bytes + excluded.bytes`);
}

/** Hämtningar ur förrådet i dag och i går (svensk tid). */
export async function storeFetches(tx: DbExecutor, now: Date): Promise<{ today: number; todayBytes: number; yesterday: number }> {
  const rows = (await tx.execute<{ day: string; fetches: number; bytes: string }>(sql`select day::text, fetches, bytes::text
    from map_store_fetch_day where day >= (${now}::timestamptz at time zone 'Europe/Stockholm')::date - 1 order by day desc`)).rows;
  const today = (await tx.execute<{ day: string }>(sql`select ((${now}::timestamptz at time zone 'Europe/Stockholm')::date)::text as day`)).rows[0]!.day;
  const todayRow = rows.find(row => row.day === today);
  const yesterdayRow = rows.find(row => row.day !== today);
  return { today: todayRow?.fetches ?? 0, todayBytes: Number(todayRow?.bytes ?? 0), yesterday: yesterdayRow?.fetches ?? 0 };
}

async function touchFile(path: string, sha256: string, now: Date): Promise<void> {
  if (throttled(state().touchedFiles, sha256, now.getTime())) return;
  await utimes(path, now, now).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Öppnar filen i mellanlagret om den finns med rätt längd. */
async function openCached(path: string, byteLength: number): Promise<FileHandle | undefined> {
  let handle: FileHandle;
  try { handle = await open(path, "r"); } catch (error) { if (isMissing(error)) return undefined; throw error; }
  if ((await handle.stat()).size === byteLength) return handle;
  await handle.close();
  return undefined;
}

/** Hämtar ur förrådet till mellanlagret och ger filen öppnad (öppnad före namnbytet, så att utträngningen inte kan ta den). */
export async function fetchIntoCache(store: ArchiveStore, dir: string, sha256: string, byteLength: number): Promise<FileHandle> {
  const path = cachePath(dir, sha256);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${sha256}.${randomUUID()}.tmp`);
  try {
    const got = await store.download(sha256, temporary);
    if (!got) throw new Error("Kartinnehållet saknas i förrådet");
    if (got.byteLength !== byteLength || got.sha256 !== sha256) throw new Error("Kartinnehållet i förrådet stämmer inte med sin kontrollsumma");
    const handle = await open(temporary, "r");
    try { await rename(temporary, path); } catch (error) { await handle.close(); throw error; }
    return handle;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Den öppna filen för ett innehåll i förrådet: ur mellanlagret, annars hämtad dit. Anroparen stänger den. Undefined när
 * mellanlagret inte går att skriva i.
 */
async function openStored(tx: DbExecutor, sha256: string, byteLength: number, now: Date): Promise<FileHandle | undefined> {
  const dir = usableMapCacheDir();
  if (!dir) return undefined;
  const path = cachePath(dir, sha256);
  const cached = await openCached(path, byteLength);
  if (cached) {
    await touchFile(path, sha256, now);
    await touchMapContent(tx, sha256, now);
    return cached;
  }
  const handle = await fetchIntoCache(requireStore(), dir, sha256, byteLength);
  state().touchedFiles.set(sha256, now.getTime());
  await countFetch(tx, byteLength, now);
  await touchMapContent(tx, sha256, now);
  await noteCacheWrite(tx, byteLength);
  return handle;
}

function requireStore(): ArchiveStore {
  const store = mapArchiveStore();
  if (!store) throw new Error("Kartinnehållet ligger i förrådet, men förrådet är inte inställt (OTID_ARCHIVE_*)");
  return store;
}

/** Hela innehållet i minnet (som `readMapContent` för innehåll i databasen). */
export async function readStoredMapContent(tx: DbExecutor, sha256: string, byteLength: number, now = new Date()): Promise<Buffer> {
  const handle = await openStored(tx, sha256, byteLength, now);
  if (handle) {
    try {
      const bytes = await handle.readFile();
      if (bytes.byteLength !== byteLength) throw new Error("Kartinnehållet i mellanlagret är ofullständigt");
      return bytes;
    } finally { await handle.close(); }
  }
  const bytes = await requireStore().get(sha256);
  if (!bytes || bytes.byteLength !== byteLength || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Kartinnehållet i förrådet saknas eller stämmer inte med sin kontrollsumma");
  await countFetch(tx, byteLength, now);
  await touchMapContent(tx, sha256, now);
  return bytes;
}

/** Innehållet i delar om högst 1 MiB ur mellanlagret, utan att hela filen hålls i minnet. */
export async function* streamStoredMapContent(tx: DbExecutor, sha256: string, byteLength: number, now = new Date()): AsyncGenerator<Uint8Array> {
  const handle = await openStored(tx, sha256, byteLength, now);
  if (!handle) { yield await readStoredMapContent(tx, sha256, byteLength, now); return; }
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: 1024 * 1024, autoClose: false })) yield chunk as Buffer;
  } finally { await handle.close(); }
}

/**
 * Lägger en uppladdning (redan i förrådet) i mellanlagret: flyttar den strömmade filen, eller skriver bytes. Med
 * `keepSource` blir filen en hård länk i stället (samma filsystem), så att den strömmade filen finns kvar tills anroparen
 * tar bort den (`storeMapContent` kan behöva ladda upp den igen om transaktionen görs om).
 */
export async function placeInCache(tx: DbExecutor, sha256: string, source: { file: string } | { bytes: Uint8Array }, byteLength: number,
  options: { keepSource?: boolean } = {}): Promise<void> {
  const dir = usableMapCacheDir();
  if (!dir) return;
  const path = cachePath(dir, sha256);
  await mkdir(dirname(path), { recursive: true });
  if ("file" in source && !options.keepSource) {
    await rename(source.file, path);
  } else {
    const temporary = join(dirname(path), `.${sha256}.${randomUUID()}.tmp`);
    try {
      if ("file" in source) await link(source.file, temporary);
      else await writeFile(temporary, source.bytes, { flag: "wx" });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  await noteCacheWrite(tx, byteLength);
}

/**
 * Granskningen runda 2 (A): filens början (högst `maxBytes`) för ett innehåll i förrådet, utan att hela filen läses: ur
 * mellanlagret om den finns där, annars med en avgränsad hämtning (HTTP Range) ur förrådet. Hämtningen läggs inte i
 * mellanlagret.
 */
export async function readStoredMapContentHead(db: DbExecutor, sha256: string, byteLength: number, maxBytes: number, now = new Date())
  : Promise<Buffer> {
  const want = Math.min(maxBytes, byteLength);
  const dir = usableMapCacheDir();
  const handle = dir ? await openCached(cachePath(dir, sha256), byteLength) : undefined;
  if (handle) {
    try {
      const head = Buffer.alloc(want);
      let filled = 0;
      while (filled < want) {
        const { bytesRead } = await handle.read(head, filled, want - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled !== want) throw new Error("Kartinnehållet i mellanlagret är ofullständigt");
      await touchFile(cachePath(dir!, sha256), sha256, now);
      await touchMapContent(db, sha256, now);
      return head;
    } finally { await handle.close(); }
  }
  const head = await requireStore().readHead(sha256, want);
  if (!head || head.byteLength !== want) throw new Error("Kartinnehållet i förrådet saknas eller är kortare än väntat");
  await countFetch(db, head.byteLength, now);
  await touchMapContent(db, sha256, now);
  return head;
}

export interface CacheEntry { readonly path: string; readonly bytes: number; readonly usedAtMs: number }

/**
 * Utträngningen (ren funktion): över taket tas de minst nyligen använda bort tills det som är kvar är högst 90 % av taket.
 * Under taket tas ingenting bort. Lika gamla tas i namnordning, så att resultatet är stabilt. Fastspikade (`pinned`, filens
 * namn = sha256) tas aldrig och räknas inte mot taket (PLAN.md steg M2).
 */
export function pickCacheEvictions(entries: readonly CacheEntry[], capBytes: number, otherBytes = 0,
  pinned: ReadonlySet<string> = new Set()): CacheEntry[] {
  const free = entries.filter(entry => !pinned.has(basename(entry.path)));
  let total = otherBytes + free.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= capBytes) return [];
  const target = capBytes * 0.9;
  const picked: CacheEntry[] = [];
  for (const entry of [...free].sort((a, b) => a.usedAtMs - b.usedAtMs || a.path.localeCompare(b.path))) {
    if (total <= target) break;
    picked.push(entry);
    total -= entry.bytes;
  }
  return picked;
}

/** Markeringarnas katalog (PLAN.md steg M2). */
export const pinnedDir = (dir: string) => join(dir, PINNED);

/** De fastspikade innehållen enligt markeringarna (sha256), med markeringens mtime. */
export async function readPinMarkers(dir: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let names: string[];
  try { names = await readdir(pinnedDir(dir)); } catch (error) { if (isMissing(error)) return result; throw error; }
  for (const name of names) {
    if (!SHA.test(name)) continue;
    try { result.set(name, (await stat(join(pinnedDir(dir), name))).mtimeMs); } catch (error) { if (!isMissing(error)) throw error; }
  }
  return result;
}

/** Spikar fast (skapar eller förnyar markeringen). Innehållet behöver inte finnas i mellanlagret än. */
export async function markPinned(dir: string, sha256s: Iterable<string>, now = new Date()): Promise<void> {
  const folder = pinnedDir(dir);
  await mkdir(folder, { recursive: true });
  for (const sha256 of sha256s) {
    if (!SHA.test(sha256)) throw new Error("Ogiltig kontrollsumma för mellanlagret");
    const path = join(folder, sha256);
    await writeFile(path, "", { flag: "a" });
    await utimes(path, now, now);
  }
}

/** Släpper markeringar som inte ska vara kvar och är äldre än `graceMs` (en markering från en skrivning just nu får vara kvar). */
export async function releasePinMarkers(dir: string, keep: ReadonlySet<string>, graceMs: number, now = new Date()): Promise<number> {
  let released = 0;
  for (const [sha256, mtimeMs] of await readPinMarkers(dir)) {
    if (keep.has(sha256) || now.getTime() - mtimeMs < graceMs) continue;
    await rm(join(pinnedDir(dir), sha256), { force: true });
    released += 1;
  }
  return released;
}

/** Finns innehållet i mellanlagret med rätt längd? */
export async function cachedWithLength(dir: string, sha256: string, byteLength: number): Promise<boolean> {
  try { return (await stat(cachePath(dir, sha256))).size === byteLength; } catch (error) { if (isMissing(error)) return false; throw error; }
}

export interface CacheScan { entries: CacheEntry[]; otherBytes: number; stale: string[]; totalBytes: number; files: number }

/** Går igenom mellanlagret. Temporära filer äldre än en timme och uppladdningar äldre än ett dygn räknas som kvarglömda. */
export async function scanMapCache(dir: string, now = new Date()): Promise<CacheScan> {
  const entries: CacheEntry[] = [], stale: string[] = [];
  let otherBytes = 0;
  const list = async (path: string) => { try { return await readdir(path, { withFileTypes: true }); } catch (error) { if (isMissing(error)) return []; throw error; } };
  const info = async (path: string) => { try { return await stat(path); } catch (error) { if (isMissing(error)) return undefined; throw error; } };
  for (const top of await list(dir)) {
    if (!top.isDirectory() || top.name === PINNED) continue;
    const folder = join(dir, top.name);
    for (const file of await list(folder)) {
      if (!file.isFile()) continue;
      const path = join(folder, file.name), meta = await info(path);
      if (!meta) continue;
      const age = now.getTime() - meta.mtimeMs;
      if (top.name === ".staging") { otherBytes += meta.size; if (age > 24 * 60 * MINUTE) stale.push(path); continue; }
      if (SHA.test(file.name) && top.name === file.name.slice(0, 2)) entries.push({ path, bytes: meta.size, usedAtMs: meta.mtimeMs });
      else { otherBytes += meta.size; if (age > 60 * MINUTE) stale.push(path); }
    }
  }
  const totalBytes = otherBytes + entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { entries, otherBytes, stale, totalBytes, files: entries.length };
}

export interface CacheSweepResult { removed: number; freedBytes: number; totalBytes: number; files: number; capBytes: number;
  pinnedBytes: number; pinnedFiles: number }

/**
 * Städar mellanlagret: kvarglömda temporära filer och, över taket, de minst nyligen använda. Fastspikade rörs inte; de läses
 * efter genomgången (se överst).
 */
export async function sweepMapCache(dir: string, capBytes: number, now = new Date()): Promise<CacheSweepResult> {
  const scan = await scanMapCache(dir, now);
  const pinned = new Set((await readPinMarkers(dir)).keys());
  let freedBytes = 0, removed = 0;
  for (const path of scan.stale) { await rm(path, { force: true }); removed += 1; }
  for (const entry of pickCacheEvictions(scan.entries, capBytes, scan.otherBytes, pinned)) {
    await rm(entry.path, { force: true });
    removed += 1;
    freedBytes += entry.bytes;
  }
  const kept = scan.entries.filter(entry => pinned.has(basename(entry.path)));
  const totalBytes = scan.totalBytes - freedBytes;
  const current = state();
  current.estimateBytes = totalBytes - kept.reduce((sum, entry) => sum + entry.bytes, 0);
  current.lastSweepAt = now.getTime();
  return { removed, freedBytes, totalBytes, files: scan.files - (removed - scan.stale.length), capBytes,
    pinnedBytes: kept.reduce((sum, entry) => sum + entry.bytes, 0), pinnedFiles: kept.length };
}

/** Mellanlagrets gällande tak (inställningen på superadminsidan eller förvalet), läst högst var 5:e minut. */
export async function mapCacheCapBytes(tx: DbExecutor, now = Date.now()): Promise<number> {
  const current = state();
  if (current.capBytes !== null && now - current.capReadAt < 5 * MINUTE) return current.capBytes;
  const settings = (await privileges(tx)).settings ? await readInstallationSettings(tx) : { cacheMaxMb: null, mapQuotaTotalMb: null, pinMaxMb: null };
  current.capBytes = cacheMaxBytes(settings);
  current.capReadAt = now;
  return current.capBytes;
}

/** Glömmer det lästa taket (efter att superadmin ändrat det). */
export function forgetMapCacheCap(): void { state().capReadAt = 0; }

/** Kör en städning i bakgrunden om ingen pågår. Fel skrivs i loggen. */
export function startMapCacheSweep(dir: string, capBytes: number): void {
  const current = state();
  if (current.sweeping) return;
  current.sweeping = true;
  void sweepMapCache(dir, capBytes).then(result => {
    if (result.freedBytes > 0) console.info(`Mellanlagret: ${result.removed} filer borttagna (${Math.round(result.freedBytes / 1024 / 1024)} MB), ` +
      `${Math.round(result.totalBytes / 1024 / 1024)} av ${Math.round(capBytes / 1024 / 1024)} MB används`);
  }, error => console.error(`Mellanlagrets städning misslyckades: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => { current.sweeping = false; });
}

/** Efter en skrivning: passeras taket (eller är storleken okänd sedan mer än en halv minut) städas det direkt. */
async function noteCacheWrite(tx: DbExecutor, byteLength: number): Promise<void> {
  const dir = usableMapCacheDir();
  if (!dir) return;
  const current = state();
  const cap = await mapCacheCapBytes(tx);
  if (current.estimateBytes !== null) current.estimateBytes += byteLength;
  const unknown = current.estimateBytes === null && Date.now() - current.lastSweepAt > 30_000;
  if (unknown || (current.estimateBytes !== null && current.estimateBytes > cap)) startMapCacheSweep(dir, cap);
}

/** Hur fullt mellanlagret är (för superadminsidan), eller null när katalogen inte går att läsa. Skapar ingenting. */
export async function mapCacheUsage(now = new Date()): Promise<{ usedBytes: number; files: number } | null> {
  try {
    const scan = await scanMapCache(mapCacheDir(), now);
    return { usedBytes: scan.totalBytes, files: scan.files };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EACCES") return null;
    throw error;
  }
}
