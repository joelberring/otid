import { MAP_PROJECT_TRACK_MAX_PARTS, MAP_PROJECT_TRACK_PART_POINTS } from "@o-tid/contracts";
import { simplifyTrack, type RawPoint } from "./map-project-tracks";
import { inLanguage } from "./in-language";

/**
 * ADR-0219 tillägget om rekningen (K3): spåren i telefonen innan servern tagit emot dem (IndexedDB, per projekt och konto).
 * Ett spår som spelas in samlar punkter i `open`; var 3 000:e punkt förenklas de och blir en fast del (`parts`) som skickas
 * och aldrig ändras (servern gör samma del en gång). Spåret tas bort ur telefonen först när servern kvitterat alla delar
 * och spåret är avslutat (AGENTS.md). Saknas IndexedDB finns spåren bara i minnet.
 */
const DB_NAME = "otid-map-project-tracks";
const STORE = "tracks";
/** Så många punkter samlas innan de förenklas till en del. */
export const OPEN_PART_POINTS = 3000;

export interface LocalTrack {
  readonly trackId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly name: string;
  readonly source: "FIELD" | "GPX";
  readonly startedAt: string;
  /** Fasta delar (förenklade), i ordning. */
  readonly parts: readonly RawPoint[][];
  /** Punkterna sedan den senaste delen (inspelningen pågår). */
  readonly open: readonly RawPoint[];
  /** Så många delar som servern kvitterat. */
  readonly sent: number;
  /** Servern har spåret. */
  readonly created: boolean;
  /** När inspelningen avslutades (eller GPX-filen lästes); saknas medan den pågår. */
  readonly endedAt?: string | undefined;
  /** Senaste felet från servern (visas vid spåret). */
  readonly problem?: number | undefined;
}

/** Punkterna i `open` blir fasta delar: vid 3 000 punkter, eller alla när spåret avslutas. Högst 50 delar. */
export function closeParts(track: LocalTrack, final: boolean): LocalTrack {
  if (!final && track.open.length < OPEN_PART_POINTS) return track;
  // Översynen G3: slutet skickas med sista delen; finns inga nya punkter blir sista punkten en egen del, så att servern får
  // veta att spåret är slut innan telefonens kopia tas bort.
  if (final && track.open.length === 0) {
    const last = track.parts[track.parts.length - 1]?.at(-1);
    return last && track.parts.length < MAP_PROJECT_TRACK_MAX_PARTS ? { ...track, parts: [...track.parts, [last]] } : track;
  }
  if (track.open.length === 0) return track;
  const simplified = simplifyTrack(track.open);
  const parts = [...track.parts];
  for (let i = 0; i < simplified.length && parts.length < MAP_PROJECT_TRACK_MAX_PARTS; i += MAP_PROJECT_TRACK_PART_POINTS) {
    parts.push(simplified.slice(i, i + MAP_PROJECT_TRACK_PART_POINTS));
  }
  // Nästa del börjar där den förra slutade, så att spåret hänger ihop.
  const last = simplified[simplified.length - 1];
  return { ...track, parts, open: final || !last ? [] : [last] };
}

/** Alla punkter (delarna och de som ännu inte blivit en del), för kartan. */
export const localPoints = (track: LocalTrack): RawPoint[] => [...track.parts.flat(), ...track.open];

/** Spåret är fullt (50 delar): inspelningen stoppas. */
export const trackFull = (track: LocalTrack) => track.parts.length >= MAP_PROJECT_TRACK_MAX_PARTS;

let opened: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "trackId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("IndexedDB kunde inte öppnas", "The browser's storage (IndexedDB) could not be opened")));
    request.onblocked = () => reject(new Error(inLanguage("IndexedDB är blockerad av en annan flik", "The browser's storage (IndexedDB) is blocked by another tab")));
  }).catch(error => { opened = undefined; throw error; });
  return opened;
}

const memory = new Map<string, LocalTrack>();
export const trackStoreAvailable = () => typeof indexedDB !== "undefined";

export async function localTracks(projectId: string, accountId: string): Promise<LocalTrack[]> {
  const mine = (track: LocalTrack) => track.projectId === projectId && track.accountId === accountId;
  if (!trackStoreAvailable()) return [...memory.values()].filter(mine);
  const database = await open();
  const all = await new Promise<LocalTrack[]>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as LocalTrack[]);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("Spåren kunde inte läsas", "The tracks could not be read")));
  });
  return all.filter(mine).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

async function write(action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  const database = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(inLanguage("Spåret kunde inte sparas", "The track could not be saved")));
    transaction.onabort = () => reject(transaction.error ?? new Error(inLanguage("Spåret kunde inte sparas", "The track could not be saved")));
  });
}

export async function putLocalTrack(track: LocalTrack): Promise<void> {
  if (!trackStoreAvailable()) { memory.set(track.trackId, track); return; }
  await write(store => store.put(track));
}

/** Bara när servern kvitterat hela spåret, eller när personen tar bort det. */
export async function deleteLocalTrack(trackId: string): Promise<void> {
  if (!trackStoreAvailable()) { memory.delete(trackId); return; }
  await write(store => store.delete(trackId));
}

/** Spåren som väntar på servern (alla projekt och konton i webbläsaren), för utloggningens fråga. */
export async function pendingTrackCount(): Promise<number> {
  if (!trackStoreAvailable()) return memory.size;
  if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some(row => row.name === DB_NAME)) return 0;
  const database = await open();
  return new Promise<number>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(inLanguage("Spåren kunde inte räknas", "The tracks could not be counted")));
  });
}

/** Allt i telefonen (utloggning). */
export async function clearLocalTracks(): Promise<void> {
  memory.clear();
  if (!trackStoreAvailable()) return;
  if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some(row => row.name === DB_NAME)) return;
  await write(store => store.clear());
}
