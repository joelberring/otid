import {
  coursesArePublic, getPublicStartList, publicRaceContentVersion, publicRelayResults, publicResultDetailFrom, publicResults, readPublicLiveFrom, readPublicRadio
} from "@o-tid/application";
import { db } from "./db";
import { createPublicRaceCache, onlyNewResults } from "./public-race-cache";
import { publicStartListValue } from "./public-start-list-route";

/**
 * Steg 51: de publika listorna ur cachen per tävlingsversion (`public-race-cache.ts`). Sidorna och de publika
 * API:erna läser här; grinden (`publicRaceResponse`/`requirePublicRace`) körs som förut för varje anrop.
 */
const globalCache = globalThis as typeof globalThis & { oTidPublicRaceCache?: ReturnType<typeof createPublicRaceCache> };
const cache = globalCache.oTidPublicRaceCache ??= createPublicRaceCache({ version: (raceId) => publicRaceContentVersion(db, raceId),
  staleAllowed: onlyNewResults });

/** `fresh`: vänta på den aktuella versionen (väckningen). `exact`: läs versionen nu (sidorna, efter en sparad ändring). */
type Read = { fresh?: boolean; exact?: boolean };
export const cachedPublicResults = (raceId: string, read: Read = {}) => cache.read(raceId, "results", () => publicResults(db, raceId), read);
export const cachedPublicRelayResults = (raceId: string, read: Read = {}) =>
  cache.read(raceId, "relay", () => publicRelayResults(db, raceId), read);
export const cachedPublicRadio = (raceId: string, read: Read = {}) => cache.read(raceId, "radio", () => readPublicRadio(db, raceId), read);

/** Live ur de cachade listorna; "Ny ledare" och tiden följer klockan, så Live räknas om minst var femte sekund. */
export const cachedPublicLive = (raceId: string, read: Read = {}) => cache.read(raceId, "live", async () => {
  const [results, relay, radio] = await Promise.all([cachedPublicResults(raceId, read), cachedPublicRelayResults(raceId, read),
    cachedPublicRadio(raceId, read)]);
  return readPublicLiveFrom(db, raceId, { results: results.value, relay: relay.value, radio: radio.value });
}, { maxAgeMs: 5_000, ...read });

/**
 * Räknar resultatlistorna och Live för tävlingens nya version innan resultatströmmen väcker publiken, så att
 * besökarnas hämtningar träffar en färdig lista.
 */
export async function warmPublicRaceLists(raceId: string): Promise<void> {
  await cachedPublicLive(raceId, { fresh: true });
}

/** Den publicerade (eller löpande) startlistan, eller null. */
export const cachedPublicStartList = (raceId: string, read: Read = {}) => cache.read(raceId, "start-list", async () => {
  return publicStartListValue(await getPublicStartList(db, raceId));
}, read);

/** Steg 52: om banorna är publika (ADR-0176), per tävlingsversion; versionen tar med arrangörens val. */
export const cachedCoursesArePublic = (raceId: string, read: Read = {}) =>
  cache.read(raceId, "courses-public", () => db.transaction(tx => coursesArePublic(tx, raceId)), read);

/** En deltagares rad ur den cachade resultatlistan; `stale` som i `CachedPublic`. */
export async function cachedPublicResultDetail(raceId: string, publicResultId: string, read: Read = {}) {
  const [results, coursesPublic] = await Promise.all([cachedPublicResults(raceId, read), cachedCoursesArePublic(raceId, read)]);
  return { ...publicResultDetailFrom(results.value, publicResultId, coursesPublic.value),
    stale: results.stale === true || coursesPublic.stale === true };
}

/**
 * Steg 51: hur många rader en publik lista får ha och ändå skickas med sidan. En större lista (3 000 löpare ger flera MB
 * HTML och sekunder av serverns tid per besök) hämtas av sidan direkt från det cachade API:et i stället.
 */
export const PUBLIC_PAGE_INLINE_ROWS = 400;

export function publicPageRows(results: { results: readonly unknown[] }, relay: { classes: readonly { teams: readonly { legs: readonly unknown[] }[] }[] }): number {
  return results.results.length + relay.classes.reduce((sum, row) => sum + row.teams.reduce((teams, team) => teams + team.legs.length, 0), 0);
}
