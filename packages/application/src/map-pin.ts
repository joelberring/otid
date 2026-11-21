import { sql } from "drizzle-orm";
import { inRaceDay, localRaceDate } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";
import type { ArchiveStore } from "./map-archive-store";
import { pinMaxBytes, readInstallationSettings } from "./installation-settings";
import { cachedWithLength, countFetch, fetchIntoCache, markPinned, releasePinMarkers, usableMapCacheDir } from "./map-cache";
import { storeMode } from "./map-store";

/**
 * PLAN.md steg M2 (ADR-0229, tillägg 2026-11-21): tävlingars och träningars kartor spikas fast i mellanlagret från dagen före
 * till dagen efter tävlingsdagen (i eventets tidszon), så att läsningen på tävlingsdygnet (ADR-0178) aldrig behöver nätet.
 *
 * - **Vad:** innehåll i förrådet (`stored_in = 'STORE'`) som loppets `race_map` och `race_map_source` pekar på (bilden,
 *   kartfilen som gafflingar, banor, utskrift och kartritarens länk ritas ur), och träningsbibliotekets karta som loppet
 *   kom ifrån (`race_map_agreement.source_map_id` → `training_group_map` och `training_group_map_source`). En träning är ett
 *   lopp i ett event med träningsgrupp, så den följer samma regel. Innehåll i databasen behöver inget mellanlager.
 * - **Hur:** löparen (map-store-runner) spikar fast, laddar ner det som saknas (kontrollerat) och släpper det som inte längre
 *   ska vara spikat, var 5:e minut. En karta som laddas upp eller byts till ett lopp i fönstret spikas direkt vid skrivningen,
 *   innan den läggs i mellanlagret (`pinRaceContentNow`).
 * - **Gränsen** (`pin_max_mb`, förval 3 072 MB) stoppar inget: tävlingen går först. Den ger en varning.
 */
const MINUTE = 60_000;
/** En markering från en skrivning som ännu inte syns för löparen (transaktionen pågår) får vara kvar så här länge. */
const MARKER_GRACE_MS = 15 * MINUTE;

/** Fönstret: från så många dagar före tävlingsdagen till så många dagar efter, i eventets tidszon. */
export function pinWindowDays(): { readonly before: number; readonly after: number } {
  return { before: 1, after: 1 };
}

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/** Ska loppets kartor vara fastspikade nu? En okänd tidszon räknas som spikad (hellre en karta för mycket). */
export function racePinnedNow(raceDate: string, timeZone: string, now: Date): boolean {
  let today: string;
  try { today = localRaceDate(now, timeZone); } catch { return true; }
  const offset = dayNumber(today) - dayNumber(raceDate);
  const window = pinWindowDays();
  return offset >= -window.before && offset <= window.after;
}

const raceDayNow = (raceDate: string, timeZone: string, now: Date) => { try { return inRaceDay(now, raceDate, timeZone); } catch { return false; } };

export interface PinCandidate { readonly raceDate: string; readonly timeZone: string; readonly sha256: string; readonly byteLength: number }
export interface PinnedContent { readonly sha256: string; readonly byteLength: number; readonly raceDay: boolean }

/** Urvalet (ren funktion): det som ska spikas nu, ett per sha256; `raceDay` när något lopp som använder det har tävlingsdygnet nu. */
export function selectPinned(candidates: readonly PinCandidate[], now: Date): PinnedContent[] {
  const result = new Map<string, PinnedContent>();
  for (const candidate of candidates) {
    if (!racePinnedNow(candidate.raceDate, candidate.timeZone, now)) continue;
    const raceDay = raceDayNow(candidate.raceDate, candidate.timeZone, now);
    const earlier = result.get(candidate.sha256);
    result.set(candidate.sha256, { sha256: candidate.sha256, byteLength: candidate.byteLength, raceDay: raceDay || (earlier?.raceDay ?? false) });
  }
  return [...result.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
}

/** Loppen nära i tid (grovt i UTC, tre dygn åt varje håll räcker för alla tidszoner) och innehållet de pekar på. */
async function pinCandidates(tx: DbExecutor, now: Date, raceId?: string): Promise<PinCandidate[]> {
  const day = now.toISOString().slice(0, 10);
  const filter = raceId ? sql`r.id = ${raceId}::uuid` : sql`r.race_date between ${day}::date - 3 and ${day}::date + 3`;
  const rows = (await tx.execute<{ race_date: string; time_zone: string; sha256: string; byte_length: number }>(sql`select
      r.race_date::text as race_date, e.time_zone, c.sha256, c.byte_length
    from race r join event e on e.id = r.event_id
    join lateral (
      select m.content_sha256 as sha from race_map m where m.race_id = r.id
      union select s.content_sha256 from race_map_source s where s.race_id = r.id
      union select g.content_sha256 from race_map_agreement a join training_group_map g on g.id = a.source_map_id where a.race_id = r.id
      union select gs.content_sha256 from race_map_agreement a join training_group_map_source gs on gs.map_id = a.source_map_id where a.race_id = r.id
    ) refs on refs.sha is not null
    join map_content c on c.sha256 = refs.sha and c.stored_in = 'STORE'
    where ${filter}`)).rows;
  return rows.map(row => ({ raceDate: row.race_date, timeZone: row.time_zone, sha256: row.sha256, byteLength: Number(row.byte_length) }));
}

/** Det som ska vara fastspikat nu. */
export async function pinnedContentNow(tx: DbExecutor, now = new Date()): Promise<PinnedContent[]> {
  return selectPinned(await pinCandidates(tx, now), now);
}

/**
 * Vid skrivningen (punkt 4): ligger loppet i fönstret spikas `sha256s` (det som ska skrivas, före skrivningen) och loppets
 * innehåll i förrådet fast direkt. Bara med förrådet påslaget och ett skrivbart mellanlager; annars ingenting.
 */
export async function pinRaceContentNow(tx: DbExecutor, raceId: string, now: Date, sha256s: readonly string[] = []): Promise<void> {
  if (storeMode() !== "on") return;
  const dir = usableMapCacheDir();
  if (!dir) return;
  const [race] = (await tx.execute<{ race_date: string; time_zone: string }>(sql`select r.race_date::text as race_date, e.time_zone
    from race r join event e on e.id = r.event_id where r.id = ${raceId}::uuid`)).rows;
  if (!race || !racePinnedNow(race.race_date, race.time_zone, now)) return;
  const own = (await pinCandidates(tx, now, raceId)).map(candidate => candidate.sha256);
  await markPinned(dir, new Set([...sha256s, ...own]), now);
}

export interface PinRoundResult {
  readonly pinned: number; readonly pinnedBytes: number; readonly fetched: number; readonly fetchedBytes: number;
  readonly failed: number; readonly failedBytes: number; readonly released: number; readonly limitBytes: number; readonly overLimit: boolean;
  readonly errors: string[];
}

/**
 * Ett varv (löparen, var 5:e minut): spika fast, ladda ner det som saknas (kontrollerat i `fetchIntoCache`), släpp det som
 * inte längre ska vara spikat. Ett fel på ett innehåll stoppar inte de andra; det som misslyckas prövas igen nästa varv.
 */
export async function runPinRound(tx: DbExecutor, store: ArchiveStore, dir: string, now = new Date()): Promise<PinRoundResult> {
  const pinned = await pinnedContentNow(tx, now);
  const limitBytes = pinMaxBytes(await readInstallationSettings(tx));
  await markPinned(dir, pinned.map(content => content.sha256), now);
  let fetched = 0, fetchedBytes = 0, failed = 0, failedBytes = 0;
  const errors: string[] = [];
  for (const content of pinned) {
    if (await cachedWithLength(dir, content.sha256, content.byteLength)) continue;
    try {
      const handle = await fetchIntoCache(store, dir, content.sha256, content.byteLength);
      await handle.close();
      await countFetch(tx, content.byteLength, now);
      fetched += 1; fetchedBytes += content.byteLength;
    } catch (error) {
      failed += 1; failedBytes += content.byteLength;
      if (errors.length < 5) errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const released = await releasePinMarkers(dir, new Set(pinned.map(content => content.sha256)), MARKER_GRACE_MS, now);
  const pinnedBytes = pinned.reduce((sum, content) => sum + content.byteLength, 0);
  return { pinned: pinned.length, pinnedBytes, fetched, fetchedBytes, failed, failedBytes, released, limitBytes,
    overLimit: pinnedBytes > limitBytes, errors };
}

export interface PinStatus {
  readonly count: number; readonly bytes: number; readonly missing: number; readonly missingBytes: number;
  /** Något som saknas används av ett lopp som har tävlingsdygnet nu. */
  readonly missingRaceDay: boolean;
  readonly limitBytes: number; readonly overLimit: boolean;
}

/** Läget för superadminsidan: det som ska vara spikat och om det finns i mellanlagret. Null när mellanlagret inte går att läsa. */
export async function pinStatus(tx: DbExecutor, dir: string, now = new Date()): Promise<PinStatus | null> {
  const pinned = await pinnedContentNow(tx, now);
  const limitBytes = pinMaxBytes(await readInstallationSettings(tx));
  let missing = 0, missingBytes = 0, missingRaceDay = false;
  try {
    for (const content of pinned) {
      if (await cachedWithLength(dir, content.sha256, content.byteLength)) continue;
      missing += 1; missingBytes += content.byteLength;
      missingRaceDay ||= content.raceDay;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EACCES") return null;
    throw error;
  }
  const bytes = pinned.reduce((sum, content) => sum + content.byteLength, 0);
  return { count: pinned.length, bytes, missing, missingBytes, missingRaceDay, limitBytes, overLimit: bytes > limitBytes };
}
