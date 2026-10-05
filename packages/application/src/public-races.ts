import { and, asc, desc, eq, gt, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { RaceType } from "@o-tid/contracts";
import { publicRaceCondition } from "./public-race-visibility";

/**
 * Den publika ytan (ADR-0172 beslut 4): startsidans listor och sök, tävlingssidan och den korta adressen.
 * Startsidan visar bara publicerade tävlingar som superadmin inte har dolt (`publicRaceCondition`).
 * "I dag" räknas i tävlingens egen tidszon.
 */

export type PublicRaceListItem = {
  raceId: string; shortCode: string; eventName: string; raceName: string; raceDate: string; raceType: RaceType;
  startListPublished: boolean;
};
export type PublicRaceListing = {
  ongoing: PublicRaceListItem[]; upcoming: PublicRaceListItem[]; recent: PublicRaceListItem[]; moreRecent: boolean;
};

const SECTION_LIMIT = 50;
export const PUBLIC_RECENT_STEP = 10;
export const PUBLIC_RECENT_MAX = 200;
const SEARCH_MAX = 100;
const SHORT_CODE = /^[2-9a-hjkmnp-z]{6}$/;

/** Senaste beslutet om startlistan är "publicera" (samma regel som den publika startlistan). */
const startListPublished = sql<boolean>`coalesce((select ${schema.startListPublications.action} = 'PUBLISH'
  from ${schema.startListPublications} where ${schema.startListPublications.raceId} = ${schema.races.id}
  order by ${schema.startListPublications.revision} desc limit 1), false)`;

/** Tävlingens datum jämfört med dagens datum i tävlingens tidszon. */
const localToday = (now: Date) => sql`(${now.toISOString()}::timestamptz at time zone ${schema.events.timeZone})::date`;

/** Sökord som vanlig text: % och _ betyder inget särskilt. */
export function publicRaceSearchPattern(search: string): string | undefined {
  const value = search.trim().slice(0, SEARCH_MAX);
  if (!value) return undefined;
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function listPublicRaces(db: Database, input: { search?: string | undefined; recentLimit?: number | undefined },
  now = new Date()): Promise<PublicRaceListing> {
  const pattern = publicRaceSearchPattern(input.search ?? "");
  const recentLimit = Math.min(Math.max(Math.trunc(input.recentLimit ?? PUBLIC_RECENT_STEP), 1), PUBLIC_RECENT_MAX);
  const today = localToday(now);
  const select = (when: SQL, order: SQL[], limit: number) => db.select({
    raceId: schema.races.id, shortCode: schema.races.shortCode, eventName: schema.events.name, raceName: schema.races.name,
    raceDate: schema.races.raceDate, raceType: schema.races.raceType, startListPublished
  }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(and(publicRaceCondition(), when,
      pattern ? or(ilike(schema.events.name, pattern), ilike(schema.races.name, pattern)) : undefined))
    .orderBy(...order).limit(limit);
  const [ongoing, upcoming, recent] = await Promise.all([
    select(eq(schema.races.raceDate, today), [asc(schema.events.name), asc(schema.races.name)], SECTION_LIMIT),
    select(gt(schema.races.raceDate, today), [asc(schema.races.raceDate), asc(schema.events.name)], SECTION_LIMIT),
    select(lt(schema.races.raceDate, today), [desc(schema.races.raceDate), asc(schema.events.name)], recentLimit + 1)
  ]);
  return { ongoing, upcoming, recent: recent.slice(0, recentLimit), moreRecent: recent.length > recentLimit };
}

/** Loppet bakom en kort adress (versaler godtas), oavsett publicering. Behörigheten avgörs av `publicRaceAccess`. */
export async function raceIdForShortCode(db: Database, code: string): Promise<string | undefined> {
  const shortCode = code.trim().toLowerCase();
  if (!SHORT_CODE.test(shortCode)) return undefined;
  const [race] = await db.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.shortCode, shortCode)).limit(1);
  return race?.id;
}

export type PublicRaceHub = {
  raceId: string; shortCode: string; eventName: string; raceName: string; raceDate: string; raceType: RaceType;
  timeZone: string; startListPublished: boolean; hasResults: boolean;
  /** Senaste ändringen som syns publikt: publiceringen, startlistan eller ett resultat. */
  lastUpdate: string | null;
};

/** Tävlingssidan. Anroparen har redan kontrollerat att tävlingen får visas (`publicRaceAccess`). */
export async function readPublicRaceHub(db: Database, raceId: string): Promise<PublicRaceHub | undefined> {
  const [race] = await db.select({
    raceId: schema.races.id, shortCode: schema.races.shortCode, eventName: schema.events.name, raceName: schema.races.name,
    raceDate: schema.races.raceDate, raceType: schema.races.raceType, timeZone: schema.events.timeZone, startListPublished,
    publishedAt: schema.races.publishedAt,
    lastResult: sql<string | null>`(select extract(epoch from max(${schema.resultRevisions.createdAt})) * 1000
      from ${schema.resultRevisions} where ${schema.resultRevisions.raceId} = ${schema.races.id} and ${schema.resultRevisions.published})`,
    lastStartList: sql<string | null>`(select extract(epoch from max(${schema.startListPublications.decidedAt})) * 1000
      from ${schema.startListPublications} where ${schema.startListPublications.raceId} = ${schema.races.id})`
  }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.races.id, raceId)).limit(1);
  if (!race) return undefined;
  const { publishedAt, lastResult, lastStartList, ...facts } = race;
  // Tiderna kommer som millisekunder (numeric som text från PostgreSQL).
  const times = [publishedAt?.getTime(), lastResult === null ? undefined : Number(lastResult),
    lastStartList === null ? undefined : Number(lastStartList)].filter((time): time is number => time !== undefined && Number.isFinite(time));
  return { ...facts, hasResults: lastResult !== null,
    lastUpdate: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null };
}
