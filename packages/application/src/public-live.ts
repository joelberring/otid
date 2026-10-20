import { and, eq, isNull, sql } from "drizzle-orm";
import { publicLiveResponseSchema, type PublicLiveFinish, type PublicLiveLeader, type PublicLiveResponse, type PublicLiveStatus,
  type PublicRadioPassage, type PublicRadioResponse, type PublicResultListResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { readPublicRadio } from "./radio-standings";
import { publicResults } from "./results";

/**
 * Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass och radiopassager. Bygger på samma publicerade
 * resultat som resultatlistan (placeringen kommer från domänens rankning där) och samma radiotider, plus tidpunkten
 * då varje resultat kom in. Speakerns underlag är bara för admin och funktionär; detta är dess publika motsvarighet:
 * inga bricknummer, inga interna id:n eller tekniska orsaker, inga strukna löpare. Ej start och ej fullföljt är inga
 * målgångar.
 */

/** "Ny ledare" visas så här länge efter att ledarens resultat kom in. */
export const NEW_LEADER_WINDOW_MS = 5 * 60_000;

/** När ett publicerat individuellt resultat kom in. `struckAt` följer med så att projektionen själv kan utesluta strukna. */
export type PublicLiveArrival = { publicResultId: string; arrivedAt: Date; struckAt: Date | null };

export type PublicLiveInput = {
  raceId: string; now: Date; timeZone: string;
  results: PublicResultListResponse; arrivals: readonly PublicLiveArrival[]; radio: PublicRadioResponse;
};

type ResultRow = Extract<PublicResultListResponse, { formatVersion: 7 }>["results"][number];

/** Statusen som publiken ser, eller undefined när raden inte är en målgång (ej start, ej fullföljt, ingen målstämpling). */
function finishStatus(row: ResultRow): PublicLiveStatus | undefined {
  if (row.status === "DNS" || row.status === "DNF") return undefined;
  if (row.status === "MP" && row.reason === "MISSING_FINISH") return undefined;
  return row.status;
}

const runnerOf = (row: { publicResultId: string; givenName: string; familyName: string; organisationName: string | null; className: string }) =>
  ({ publicResultId: row.publicResultId, givenName: row.givenName, familyName: row.familyName, organisationName: row.organisationName,
    className: row.className });

/** Fälten plockas ett och ett: inget annat än kontraktets fält kan följa med ut. */
const passageOf = (row: PublicRadioPassage): PublicRadioPassage => ({ ...runnerOf(row), controlCode: row.controlCode, label: row.label,
  passedAt: row.passedAt, elapsedMs: row.elapsedMs, place: row.place, finished: row.finished });

const byName = (a: { className: string; familyName: string; givenName: string }, b: typeof a) =>
  a.className.localeCompare(b.className, "sv") || a.familyName.localeCompare(b.familyName, "sv") || a.givenName.localeCompare(b.givenName, "sv");

/** Ren projektion (enhetstestad): resultat + ankomsttider + radio → Live. */
export function projectPublicLive(input: PublicLiveInput): PublicLiveResponse {
  const now = input.now.getTime();
  if (!Number.isFinite(now)) throw new Error("Lästiden är ogiltig");
  if (input.results.formatVersion !== 7) throw new Error("Live kräver resultatformat 7");
  const struck = new Set(input.arrivals.filter(row => row.struckAt !== null).map(row => row.publicResultId));
  const arrivedAt = new Map(input.arrivals.filter(row => row.struckAt === null).map(row => [row.publicResultId, row.arrivedAt]));
  const rows = input.results.results.filter(row => !struck.has(row.publicResultId));

  const finishes: { row: PublicLiveFinish; at: number }[] = [];
  for (const row of rows) {
    const status = finishStatus(row);
    const at = arrivedAt.get(row.publicResultId);
    if (!status || !at) continue;
    const timed = "elapsedMs" in row && row.elapsedMs !== undefined && (status === "OK" || status === "OVERTIME" || status === "OOC");
    const points = "rogaining" in row ? row.rogaining?.total : undefined;
    finishes.push({ at: at.getTime(), row: { ...runnerOf(row), finishedAt: at.toISOString(), status,
      ...(timed ? { elapsedMs: row.elapsedMs } : {}),
      ...(status === "OK" && row.rankingState === "RANKED" && row.position !== undefined ? { place: row.position } : {}),
      ...(points !== undefined ? { points } : {}) } });
  }
  finishes.sort((a, b) => b.at - a.at || byName(a.row, b.row));

  const leaders: PublicLiveLeader[] = [];
  for (const row of rows) {
    if (row.status !== "OK" || row.rankingState !== "RANKED" || row.position !== 1 || row.elapsedMs === undefined) continue;
    const since = arrivedAt.get(row.publicResultId);
    const points = row.rogaining?.total;
    leaders.push({ ...runnerOf(row), elapsedMs: row.elapsedMs, ...(points !== undefined ? { points } : {}),
      since: since ? since.toISOString() : null, newLeader: since !== undefined && now - since.getTime() <= NEW_LEADER_WINDOW_MS });
  }
  leaders.sort(byName);

  const visible = (passage: PublicRadioPassage) => !struck.has(passage.publicResultId);
  const radio = input.radio.enabled
    ? { enabled: true, latest: input.radio.latest.filter(visible).map(passageOf),
      onTheWay: input.radio.classes.flatMap(raceClass => raceClass.onTheWay).filter(visible).map(passageOf) }
    : { enabled: false, latest: [], onTheWay: [] };

  return publicLiveResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, generatedAt: input.now.toISOString(),
    timeZone: input.timeZone, newLeaderWindowMs: NEW_LEADER_WINDOW_MS,
    finishes: finishes.map(({ row }) => row), leaders, radio });
}

/**
 * När varje publicerat individuellt resultat kom in: den första publicerade revisionen från en avläsning, annars (manuell
 * tid) den senaste publicerade. Ett ändrat beslut efteråt flyttar alltså inte löparen överst i "Senast i mål".
 */
async function readArrivals(db: Database, raceId: string): Promise<PublicLiveArrival[]> {
  const rows = await db.select({
    publicResultId: schema.entries.publicResultId, struckAt: schema.entries.struckAt,
    firstReadout: sql<string | null>`extract(epoch from min(${schema.resultRevisions.createdAt})
      filter (where ${schema.resultRevisions.readoutId} is not null)) * 1000`,
    lastPublished: sql<string>`extract(epoch from max(${schema.resultRevisions.createdAt})) * 1000`
  }).from(schema.entries)
    .innerJoin(schema.resultRevisions, and(eq(schema.resultRevisions.entryId, schema.entries.id),
      eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.published, true)))
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.teamId)))
    .groupBy(schema.entries.id).limit(10_001);
  if (rows.length > 10_000) throw new Error("Live-underlaget är för stort");
  return rows.map(row => ({ publicResultId: row.publicResultId, struckAt: row.struckAt,
    arrivedAt: new Date(Number(row.firstReadout ?? row.lastPublished)) }));
}

/** Live för en publicerad tävling. Anroparen har redan kontrollerat att tävlingen får visas (`publicRaceAccess`). */
export async function readPublicLive(db: Database, raceId: string, now = new Date()): Promise<PublicLiveResponse> {
  const [results, radio, arrivals] = await Promise.all([publicResults(db, raceId), readPublicRadio(db, raceId), readArrivals(db, raceId)]);
  return projectPublicLive({ raceId, now, timeZone: radio.timeZone, results, arrivals, radio });
}
