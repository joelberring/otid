/**
 * ADR-0218: kartfilen i webbläsaren per sha256 (IndexedDB `otid-map-cache`), så att banläggningen inte hämtar samma
 * karta igen. Webbläsarens egen HTTP-cache räcker inte: Chrome sparar inga svar över en åttondel av cachens storlek (en
 * kartfil på 10–60 MB kommer ofta inte med) och i privata fönster är cachen liten.
 *
 * - Nyckeln är filens sha256, som banläggningens tillstånd ger (servern har prövat behörigheten när den lämnade ut den).
 *   Innehållet är oföränderligt; sha256 kontrolleras när filen sparas, så en post kan inte ha fel innehåll.
 * - Högst `MAX_FILES` filer och `MAX_BYTES` sammanlagt; den som använts längst tillbaka tas bort först.
 * - Tolkade kartor sparas inte: att läsa en tolkad karta ur IndexedDB tog längre tid än att tolka filen (ADR-0218).
 * - Ett fel (ingen IndexedDB, full lagring, privat läge) gör bara att filen hämtas som förut; det skrivs i konsolen.
 * - Tas bort vid utloggning, med banläggningens övriga kopior (`forgetAllCourseSettingCopies`).
 */
import { inLanguage } from "./in-language";
export interface CachedMapFile { readonly bytes: ArrayBuffer; readonly fileName: string }
export interface MapCacheMeta { readonly sha256: string; readonly byteLength: number; readonly usedAt: number }

/** Lagret under cachen (IndexedDB i webbläsaren, minnet i testerna). */
export interface MapCacheBackend {
  get(sha256: string): Promise<CachedMapFile | undefined>;
  put(meta: MapCacheMeta, file: CachedMapFile): Promise<void>;
  touch(meta: MapCacheMeta): Promise<void>;
  list(): Promise<MapCacheMeta[]>;
  remove(sha256s: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

const MAX_FILES = 3;
const MAX_BYTES = 250 * 1024 * 1024;
export interface MapCacheLimits { readonly maxFiles: number; readonly maxBytes: number }
const SHA256 = /^[a-f0-9]{64}$/;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** Kastas när den som väntar på en delad hämtning har avbrutit (själva hämtningen fortsätter för de andra). */
function aborted(): DOMException { return new DOMException("Avbrutet", "AbortError"); }

export class MapFileCache {
  /** Hämtningar som pågår, per sha256, med de som vill veta förloppet. */
  private readonly pending = new Map<string, { readonly file: Promise<CachedMapFile>; readonly listeners: Set<(fraction: number) => void> }>();

  constructor(private readonly backend: () => MapCacheBackend | undefined, private readonly now: () => number = Date.now,
    private readonly limits: MapCacheLimits = { maxFiles: MAX_FILES, maxBytes: MAX_BYTES }) {}

  /**
   * Hämtar filen en gång även när flera ber om samma sha256 samtidigt (editorn, vägvalen, en ny rendering av editorn). Var
   * och en får en egen kopia, eftersom kopian går över till en Worker. När filen kommit sparas den i lagret. Den som avbryter
   * slutar vänta; hämtningen fortsätter för de andra (och för lagret).
   */
  async fetchOnce(sha256: string, fetchFile: (onProgress: (fraction: number) => void) => Promise<CachedMapFile>,
    options: { readonly signal?: AbortSignal | undefined; readonly onProgress?: ((fraction: number) => void) | undefined } = {}): Promise<CachedMapFile> {
    const { signal, onProgress } = options;
    if (signal?.aborted) throw aborted();
    let entry = this.pending.get(sha256);
    if (!entry) {
      const listeners = new Set<(fraction: number) => void>();
      const file = fetchFile(fraction => { for (const listener of listeners) listener(fraction); })
        .then(result => { void this.store(sha256, result); return result; })
        .finally(() => { this.pending.delete(sha256); });
      entry = { file, listeners };
      this.pending.set(sha256, entry);
    }
    if (onProgress) entry.listeners.add(onProgress);
    try {
      const file = await new Promise<CachedMapFile>((resolve, reject) => {
        const abort = () => reject(aborted());
        signal?.addEventListener("abort", abort, { once: true });
        entry.file.then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
      });
      return { bytes: file.bytes.slice(0), fileName: file.fileName };
    } finally {
      if (onProgress) entry.listeners.delete(onProgress);
    }
  }

  /** Filen med denna sha256, eller undefined (saknas eller lagret fungerar inte). */
  async read(sha256: string): Promise<CachedMapFile | undefined> {
    const backend = this.backend();
    if (!backend || !SHA256.test(sha256)) return undefined;
    try {
      const file = await backend.get(sha256);
      if (file) await backend.touch({ sha256, byteLength: file.bytes.byteLength, usedAt: this.now() });
      return file;
    } catch (error) {
      console.warn("Kartfilen kunde inte läsas ur webbläsarens lager", error);
      return undefined;
    }
  }

  /** Sparar filen om den har denna sha256 och får plats; ger om den sparades. */
  async store(sha256: string, file: CachedMapFile): Promise<boolean> {
    const backend = this.backend();
    const { maxFiles, maxBytes } = this.limits;
    if (!backend || !SHA256.test(sha256) || file.bytes.byteLength > maxBytes) return false;
    try {
      if (await sha256Hex(file.bytes) !== sha256) return false;
      const meta = { sha256, byteLength: file.bytes.byteLength, usedAt: this.now() };
      // Först plats (de som använts längst tillbaka bort), sedan filen.
      const kept = (await backend.list()).filter(item => item.sha256 !== sha256).sort((a, b) => b.usedAt - a.usedAt);
      const remove: string[] = [];
      let bytes = meta.byteLength, files = 1;
      for (const item of kept) {
        if (files + 1 > maxFiles || bytes + item.byteLength > maxBytes) { remove.push(item.sha256); continue; }
        files += 1; bytes += item.byteLength;
      }
      if (remove.length > 0) await backend.remove(remove);
      await backend.put(meta, file);
      return true;
    } catch (error) {
      console.warn("Kartfilen kunde inte sparas i webbläsarens lager", error);
      return false;
    }
  }

  /** Allt bort (utloggning). Ett fel kastas vidare. */
  async clear(): Promise<void> {
    await this.backend()?.clear();
  }
}

/**
 * Kartfilen för en sida som vet filens sha256 (ur banläggningens tillstånd): ur lagret, annars en hämtning per sha256 med
 * sha256 i adressen (`fetchFile(sha256)`, som webbläsarens HTTP-cache också får spara), som banläggningen gör. Utan känd
 * sha256 hämtas filen som förut, utan cache (städrundan 2026-11-07: Utskrift, Layout och Kartfel).
 */
export async function cachedMapFile(cache: MapFileCache, sha256: string | undefined,
  fetchFile: (sha256: string | undefined) => Promise<CachedMapFile>, signal?: AbortSignal): Promise<CachedMapFile> {
  if (!sha256 || !SHA256.test(sha256)) return fetchFile(undefined);
  const cached = await cache.read(sha256);
  if (cached) return cached;
  return cache.fetchOnce(sha256, () => fetchFile(sha256), { signal });
}

const DB_NAME = "otid-map-cache";
/** Underlagens bilder har ett eget lager, så att de inte tränger ut kartfilerna (och tvärtom). */
const LAYER_DB_NAME = "otid-layer-cache";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error(inLanguage("IndexedDB-fel", "Error in the browser's storage (IndexedDB)")));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("IndexedDB-fel", "Error in the browser's storage (IndexedDB)")));
    transaction.onabort = () => reject(transaction.error ?? new Error(inLanguage("IndexedDB avbröts", "The browser's storage (IndexedDB) was interrupted")));
  });
}

const openedByName = new Map<string, Promise<IDBDatabase>>();
function open(name: string): Promise<IDBDatabase> {
  let opened = openedByName.get(name);
  if (opened) return opened;
  opened = new Promise<IDBDatabase>((resolve, reject) => {
    const value = indexedDB.open(name, 1);
    value.onupgradeneeded = () => {
      // Filerna och uppgifterna om dem i var sin del, så att listan och "senast använd" inte läser filerna.
      value.result.createObjectStore("files");
      value.result.createObjectStore("meta", { keyPath: "sha256" });
    };
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error(inLanguage("IndexedDB kunde inte öppnas", "The browser's storage (IndexedDB) could not be opened")));
    value.onblocked = () => reject(new Error(inLanguage("IndexedDB är blockerad av en annan flik", "The browser's storage (IndexedDB) is blocked by another tab")));
  }).catch(error => { openedByName.delete(name); throw error; });
  openedByName.set(name, opened);
  return opened;
}

async function write(name: string, names: string[], change: (transaction: IDBTransaction) => void): Promise<void> {
  const transaction = (await open(name)).transaction(names, "readwrite");
  change(transaction);
  await done(transaction);
}

function indexedDbBackend(name = DB_NAME): MapCacheBackend | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  return {
    get: async sha256 => await request((await open(name)).transaction("files").objectStore("files").get(sha256)) as CachedMapFile | undefined,
    put: (meta, file) => write(name, ["files", "meta"], transaction => {
      transaction.objectStore("files").put(file, meta.sha256);
      transaction.objectStore("meta").put(meta);
    }),
    touch: meta => write(name, ["meta"], transaction => { transaction.objectStore("meta").put(meta); }),
    list: async () => await request((await open(name)).transaction("meta").objectStore("meta").getAll()) as MapCacheMeta[],
    remove: sha256s => write(name, ["files", "meta"], transaction => {
      for (const sha256 of sha256s) { transaction.objectStore("files").delete(sha256); transaction.objectStore("meta").delete(sha256); }
    }),
    clear: () => write(name, ["files", "meta"], transaction => { transaction.objectStore("files").clear(); transaction.objectStore("meta").clear(); })
  };
}

/** Webbläsarens cache för kartfiler (en för sidan). */
export const mapFileCache = new MapFileCache(() => indexedDbBackend());
/**
 * Ägaren 2026-11-14 («upplever det lite långsamt att läsa in»): kartprojektets underlag (laserkörningens bilder, ortofoton) per
 * sha256. Mätt på Ornö södra: 17 bilder, 55 MB, hämtades om vid varje öppning, eftersom kartfilernas lager bara rymmer tre
 * filer. Här ryms ett par projekts underlag; de som använts längst tillbaka tas bort först.
 */
export const layerImageCache = new MapFileCache(() => indexedDbBackend(LAYER_DB_NAME), Date.now, { maxFiles: 120, maxBytes: 600 * 1024 * 1024 });
