import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import { retryReadConflicts } from "./read-conflict";

const gzip = promisify(gzipCallback);
export { isRetryableReadConflict } from "./read-conflict";

/**
 * Steg 51 (lasttest, docs/lasttest.md): de publika listorna räknas en gång per tävlingsversion och delas av alla
 * besökare, i stället för en gång per anrop. Svaret sparas som JSON och gzip (Caddy packar inte om ett packat svar).
 *
 * - Nyckeln är tävlingens innehållsversion (`publicRaceContentVersion`); en ändring som inte syns i nyckeln täcks av
 *   maxåldern (`maxAgeMs`).
 * - Högst en uträkning åt gången per tävling och lista, och högst en per `minIntervalMs` eller tre gånger förra
 *   uträkningens tid om den är längre: under en målrusning, när versionen ändras flera gånger i sekunden, räknas listan
 *   om i takt med att den hinner och tar högst en tredjedel av processen, så att avläsningarna alltid får plats.
 * - Medan en ny version räknas får anropet den senaste färdiga direkt om den är högst `serveStaleMs` gammal, annars
 *   väntar det högst `waitMs` (och får den senaste färdiga, högst `maxStaleMs` gammal). Resultatströmmen väcker
 *   publiken först när den nya listan är räknad (`fresh`), så en ny avläsning syns inom några sekunder utan att
 *   besökarna väntar på uträkningen.
 * - Versionen läses högst en gång per `versionTtlMs` och tävling (en fråga i stället för en per anrop).
 * Cachen ligger i webbprocessen (en instans i drift, ADR-0168); den ändrar aldrig vad listorna innehåller.
 */
export type CachedPublic<T> = { readonly key: string; readonly at: number; readonly value: T; readonly json: string;
  readonly gzip: Buffer; readonly etag: string };

export type PublicRaceCacheOptions = {
  readonly version: (raceId: string) => Promise<string | null>;
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  readonly minIntervalMs?: number;
  readonly waitMs?: number;
  readonly maxStaleMs?: number;
  readonly serveStaleMs?: number;
  readonly maxEntries?: number;
  readonly versionTtlMs?: number;
};

type Slot = { entry?: CachedPublic<unknown>; inflight?: Promise<CachedPublic<unknown>> | undefined; lastStart: number; lastDuration: number };

/** En uträkning får ta högst var tredje sekund av processen (steg 51). */
const COMPUTE_SHARE = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));


export function createPublicRaceCache(options: PublicRaceCacheOptions) {
  const now = options.now ?? Date.now;
  const defaults = { maxAgeMs: options.maxAgeMs ?? 15_000, minIntervalMs: options.minIntervalMs ?? 1_000, waitMs: options.waitMs ?? 2_000,
    maxStaleMs: options.maxStaleMs ?? 30_000, serveStaleMs: options.serveStaleMs ?? 3_000 };
  const maxEntries = options.maxEntries ?? 300;
  const slots = new Map<string, Slot>();
  const versionTtlMs = options.versionTtlMs ?? 500;
  const versions = new Map<string, { at: number; value: Promise<string | null> }>();

  /** Tävlingens version, högst `versionTtlMs` gammal; samtidiga anrop delar en fråga. */
  function versionOf(raceId: string): Promise<string | null> {
    const known = versions.get(raceId);
    if (known && now() - known.at < versionTtlMs) return known.value;
    const value = options.version(raceId);
    versions.set(raceId, { at: now(), value });
    value.catch(() => { if (versions.get(raceId)?.value === value) versions.delete(raceId); });
    while (versions.size > maxEntries) versions.delete(versions.keys().next().value!);
    return value;
  }

  function slotFor(id: string): Slot {
    const existing = slots.get(id);
    if (existing) {
      // Senast använd sist (enkel LRU).
      slots.delete(id);
      slots.set(id, existing);
      return existing;
    }
    const slot: Slot = { lastStart: Number.NEGATIVE_INFINITY, lastDuration: 0 };
    slots.set(id, slot);
    while (slots.size > maxEntries) slots.delete(slots.keys().next().value!);
    return slot;
  }

  async function build<T>(raceId: string, slot: Slot, compute: () => Promise<T>, minIntervalMs: number): Promise<CachedPublic<T>> {
    const delay = slot.lastStart + Math.max(minIntervalMs, COMPUTE_SHARE * slot.lastDuration) - now();
    if (delay > 0) await sleep(delay);
    slot.lastStart = now();
    // Nyckeln läses före uträkningen: ändras något under tiden räknas listan om vid nästa anrop.
    const key = await options.version(raceId) ?? "okänd";
    versions.set(raceId, { at: now(), value: Promise.resolve(key === "okänd" ? null : key) });
    const value = await retryReadConflicts(compute);
    const json = JSON.stringify(value);
    slot.lastDuration = now() - slot.lastStart;
    const entry: CachedPublic<T> = { key, at: now(), value, json, gzip: await gzip(json),
      etag: `"${createHash("sha256").update(json).digest("base64url").slice(0, 27)}"` };
    slot.entry = entry;
    return entry;
  }

  /**
   * Listan `kind` för tävlingen, ur cachen eller nyräknad. `compute` får inte ha sidoeffekter. `fresh` väntar alltid
   * på en lista för den aktuella versionen (för väckningen i resultatströmmen).
   */
  async function read<T>(raceId: string, kind: string, compute: () => Promise<T>,
    overrides: { maxAgeMs?: number; minIntervalMs?: number; fresh?: boolean } = {}): Promise<CachedPublic<T>> {
    const maxAgeMs = overrides.maxAgeMs ?? defaults.maxAgeMs;
    const minIntervalMs = overrides.minIntervalMs ?? defaults.minIntervalMs;
    const slot = slotFor(`${raceId}:${kind}`);
    const key = overrides.fresh ? await options.version(raceId) : await versionOf(raceId);
    const cached = slot.entry as CachedPublic<T> | undefined;
    if (cached && key !== null && cached.key === key && now() - cached.at < maxAgeMs) return cached;
    const inflight = (slot.inflight ??= build(raceId, slot, compute, minIntervalMs)
      .finally(() => { slot.inflight = undefined; })) as Promise<CachedPublic<T>>;
    if (overrides.fresh) return inflight;
    if (cached && now() - cached.at < defaults.serveStaleMs) return cached;
    if (cached && now() - cached.at < defaults.maxStaleMs) {
      const stale = sleep(defaults.waitMs).then(() => cached);
      return Promise.race([inflight.catch(() => cached), stale]);
    }
    // Går uträkningen inte att göra just nu får besökaren den senaste listan hellre än ett fel.
    return cached ? inflight.catch(() => cached) : inflight;
  }

  return { read, clear: () => { slots.clear(); versions.clear(); } };
}

/**
 * Ett cachat publikt JSON-svar: gzip när webbläsaren tar emot det, ETag och 304 när innehållet inte ändrats.
 * `publicRaceResponse` gör om cache-control till privat vid förhandsvisning.
 */
export function cachedJsonResponse(request: Request, entry: CachedPublic<unknown>, cacheControl: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": cacheControl, etag: entry.etag,
    vary: "accept-encoding" };
  const match = request.headers.get("if-none-match");
  if (match !== null && match.split(",").some((tag) => tag.trim() === entry.etag)) return new Response(null, { status: 304, headers });
  const acceptsGzip = (request.headers.get("accept-encoding") ?? "").split(",").some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    return coding?.trim() === "gzip" && !params.some((param) => /^\s*q=0(\.0*)?\s*$/.test(param));
  });
  if (acceptsGzip) return new Response(new Uint8Array(entry.gzip), { headers: { ...headers, "content-encoding": "gzip" } });
  return new Response(entry.json, { headers });
}
