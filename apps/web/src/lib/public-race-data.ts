import {
  coursesArePublic, getPublicStartList, publicRaceContentVersion, publicRelayResults, publicResultDetailFrom, publicResults, readPublicLiveFrom, readPublicRadio
} from "@o-tid/application";
import { publicDb as db } from "./db";
import { instanceRole } from "./instance-role";
import { createPublicRaceCache, onlyNewResults } from "./public-race-cache";
import { publicLoad } from "./public-load";
import { publicStartListValue } from "./public-start-list-route";

/**
 * Steg 51: de publika listorna ur cachen per tävlingsversion (`public-race-cache.ts`). Sidorna och de publika
 * API:erna läser här; grinden (`publicRaceResponse`/`requirePublicRace`) körs som förut för varje anrop.
 */
const globalCache = globalThis as typeof globalThis & { oTidPublicRaceCache?: ReturnType<typeof createPublicRaceCache> };
/**
 * Steg 54: listorna räknas i publikens pool (tidsgräns, egna anslutningar). I tävlingens instans (`web`), där bara
 * inloggade läser listorna, tar en uträkning högst en sjättedel av processen, räknas aldrig i förväg och en upp till 5 s
 * gammal lista ges direkt.
 */
const competition = instanceRole() === "competition";
const cache = globalCache.oTidPublicRaceCache ??= createPublicRaceCache({ version: (raceId) => publicRaceContentVersion(db, raceId),
  staleAllowed: onlyNewResults, pressure: () => publicLoad().pressure(), computeShare: competition ? 6 : 3,
  // I tävlingens instans väntar arbetsytan och speakern hellre inte: en lista som är högst 5 s gammal ges direkt (märkt,
  // sidan hämtar igen strax) när bara nya resultat har kommit in.
  ...(competition ? { serveStaleMs: 5_000 } : {}) });

/** `fresh`: vänta på den aktuella versionen (väckningen). `exact`: läs versionen nu (sidorna, efter en sparad ändring). */
type Read = { fresh?: boolean; exact?: boolean };

/** Instansen som visar en lista lyssnar på resultatströmmen (se `ensurePublicResultListener`); inläst först vid behov. */
let streamModule: Promise<typeof import("./public-result-event-stream")> | undefined;
function listenForResults(): void {
  streamModule ??= import("./public-result-event-stream");
  streamModule.then((module) => module.ensurePublicResultListener(), (error) => {
    streamModule = undefined;
    console.error("Resultatströmmen kunde inte läsas in", error);
  });
}

const read = <T>(raceId: string, kind: string, compute: () => Promise<T>, options: Read & { maxAgeMs?: number } = {}) => {
  listenForResults();
  return cache.read(raceId, kind, compute, options);
};
export const cachedPublicResults = (raceId: string, options: Read = {}) => read(raceId, "results", () => publicResults(db, raceId), options);
/**
 * Steg 54: resultatlistan för arrangören och funktionärerna (gafflingsbilden även när banorna är hemliga, ADR-0176), per
 * tävlingsversion som den publika. Grinden kontrollerar fortfarande vem som frågar vid varje anrop; svaret är privat.
 * Förut räknades den om vid varje anrop från en speakerskärm eller arbetsyta.
 */
export const cachedStaffResults = (raceId: string, options: Read = {}) =>
  read(raceId, "results:staff", () => publicResults(db, raceId, { staff: true }), options);
export const cachedPublicRelayResults = (raceId: string, options: Read = {}) =>
  read(raceId, "relay", () => publicRelayResults(db, raceId), options);
export const cachedPublicRadio = (raceId: string, options: Read = {}) => read(raceId, "radio", () => readPublicRadio(db, raceId), options);

/** Live ur de cachade listorna; "Ny ledare" och tiden följer klockan, så Live räknas om minst var femte sekund. */
export const cachedPublicLive = (raceId: string, read: Read = {}) => cache.read(raceId, "live", async () => {
  const [results, relay, radio] = await Promise.all([cachedPublicResults(raceId, read), cachedPublicRelayResults(raceId, read),
    cachedPublicRadio(raceId, read)]);
  return readPublicLiveFrom(db, raceId, { results: results.value, relay: relay.value, radio: radio.value });
}, { maxAgeMs: 5_000, ...read });

/**
 * Har den här instansen visat tävlingens listor de senaste två minuterna? Med två instanser bakom Caddy kan besökarens
 * resultatström ligga på den ena och hämtningen hamna på den andra; båda räknar då om när ett resultat kommer in.
 */
export const publicRaceListsRecentlyRead = (raceId: string) => cache.recentlyRead(raceId, 120_000);

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
export async function cachedPublicResultDetail(raceId: string, publicResultId: string, read: Read & { staff?: boolean } = {}) {
  if (read.staff) {
    const results = await cachedStaffResults(raceId, read);
    return { ...publicResultDetailFrom(results.value, publicResultId, true), stale: results.stale === true, retryMs: results.retryMs };
  }
  const [results, coursesPublic] = await Promise.all([cachedPublicResults(raceId, read), cachedCoursesArePublic(raceId, read)]);
  return { ...publicResultDetailFrom(results.value, publicResultId, coursesPublic.value),
    stale: results.stale === true || coursesPublic.stale === true, retryMs: results.retryMs };
}

/**
 * Steg 51: hur många rader en publik lista får ha och ändå skickas med sidan. En större lista (3 000 löpare ger flera MB
 * HTML och sekunder av serverns tid per besök) hämtas av sidan direkt från det cachade API:et i stället.
 */
export const PUBLIC_PAGE_INLINE_ROWS = 400;

export function publicPageRows(results: { results: readonly unknown[] }, relay: { classes: readonly { teams: readonly { legs: readonly unknown[] }[] }[] }): number {
  return results.results.length + relay.classes.reduce((sum, row) => sum + row.teams.reduce((teams, team) => teams + team.legs.length, 0), 0);
}
