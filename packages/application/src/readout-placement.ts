import { and, eq, inArray } from "drizzle-orm";
import type { PublicRelayResults, PublicResultListResponse, ReadoutPlacement } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { readoutStanding, relayReadoutStanding, type RelayStandingTeam, type StandingRow, type StoredResultStatus } from "@o-tid/domain";

/**
 * Steg 57: placeringen vid avläsningen. Kvittot får löparens (eller lagets) preliminära placering, räknad ur den
 * resultatlista som redan är räknad för tävlingsversionen (webbens cache, ADR-0177) med avläsningens resultat – och
 * de andra avläsningarna sedan listan räknades – inlagda. Ingen ny uträkning av klassen för varje avläsning.
 */

/** Ett resultat som läggs in i listan: avläsningens eget och de som kommit in sedan listan räknades. */
export interface PlacementResultRow {
  readonly publicResultId: string;
  readonly className: string;
  readonly name: string;
  readonly status: StoredResultStatus;
  readonly elapsedMs?: number;
  readonly score?: number;
  /** Sträcklöpare (stafett): raden hör till lagets sträcka. */
  readonly relay: boolean;
}

export interface PlacementSubject extends PlacementResultRow {
  readonly resultRevisionId: string;
}

type EvaluationFacts = { readonly elapsedMs?: unknown; readonly rogaining?: { readonly total?: unknown } };

/** Resultatet bakom varje kvitterad revision: löparens publika id, klass, namn, status, tid och poäng (en fråga). */
export async function loadPlacementSubjects(db: Database, raceId: string, resultRevisionIds: readonly string[]):
  Promise<Map<string, PlacementSubject>> {
  if (resultRevisionIds.length === 0) return new Map();
  const rows = await db.select({ id: schema.resultRevisions.id, status: schema.resultRevisions.status,
    evaluation: schema.resultRevisions.evaluation, publicResultId: schema.entries.publicResultId, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, teamId: schema.entries.teamId, className: schema.classes.name })
    .from(schema.resultRevisions)
    .innerJoin(schema.entries, eq(schema.entries.id, schema.resultRevisions.entryId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.id, [...resultRevisionIds])));
  return new Map(rows.map((row) => {
    const facts = row.evaluation as EvaluationFacts;
    const elapsedMs = typeof facts.elapsedMs === "number" ? facts.elapsedMs : undefined;
    const score = typeof facts.rogaining?.total === "number" ? facts.rogaining.total : undefined;
    return [row.id, { resultRevisionId: row.id, publicResultId: row.publicResultId, className: row.className,
      name: `${row.givenName} ${row.familyName}`, status: row.status as StoredResultStatus, relay: row.teamId !== null,
      ...(elapsedMs === undefined ? {} : { elapsedMs }), ...(score === undefined ? {} : { score }) }];
  }));
}

function standingRow(row: PlacementResultRow): StandingRow {
  return { key: row.publicResultId, name: row.name, status: row.status, ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }),
    ...(row.score === undefined ? {} : { score: row.score }) };
}

/**
 * Placeringen för `subject` ur listan `results` (individuella klasser) eller `relay` (stafett), med `recent` (de nyare
 * resultaten, även subject) inlagda. Ingen placering när löparen inte är godkänd, när klassen inte kan rankas eller när
 * listan saknar klassen eller laget.
 */
export function placementFrom(input: { readonly subject: PlacementSubject; readonly results?: PublicResultListResponse | undefined;
  readonly relay?: PublicRelayResults | undefined; readonly recent: readonly PlacementResultRow[] }): ReadoutPlacement | undefined {
  const { subject } = input;
  if (subject.status !== "OK") return undefined;
  const recent = new Map(input.recent.map((row) => [row.publicResultId, row]));
  recent.set(subject.publicResultId, subject);
  if (!subject.relay) {
    if (!input.results) return undefined;
    const listed = input.results.results.flatMap((row) => row.className === subject.className && "publicResultId" in row ? [row] : []);
    if (listed.some((row) => row.rankingState === "MIXED_COURSE_VERSIONS")) return undefined;
    const rows = new Map<string, StandingRow>(listed.map((row) => [row.publicResultId, { key: row.publicResultId,
      name: `${row.givenName} ${row.familyName}`, status: row.status,
      ...("elapsedMs" in row && row.elapsedMs !== undefined ? { elapsedMs: row.elapsedMs } : {}),
      ...("rogaining" in row && row.rogaining ? { score: row.rogaining.total } : {}) }]));
    for (const row of recent.values()) if (!row.relay && row.className === subject.className) rows.set(row.publicResultId, standingRow(row));
    const standing = readoutStanding([...rows.values()], subject.publicResultId);
    return standing ? { kind: "individual", standing } : undefined;
  }
  const relayClass = input.relay?.classes.find((row) => row.name === subject.className &&
    row.teams.some((team) => team.legs.some((leg) => leg.publicResultId === subject.publicResultId)));
  if (!relayClass) return undefined;
  let teamKey: string | undefined;
  let leg: number | undefined;
  const teams: RelayStandingTeam[] = relayClass.teams.map((team) => ({ key: String(team.number), name: team.name,
    legs: team.legs.map((row) => {
      const newer = recent.get(row.publicResultId);
      if (row.publicResultId === subject.publicResultId) { teamKey = String(team.number); leg = row.leg; }
      const status = newer?.relay ? newer.status : row.status ?? undefined;
      const elapsedMs = newer?.relay ? newer.elapsedMs : row.elapsedMs ?? undefined;
      return { key: row.publicResultId, leg: row.leg, restarted: row.restarted, ...(status ? { status } : {}),
        ...(elapsedMs === undefined ? {} : { elapsedMs }) };
    }) }));
  if (teamKey === undefined || leg === undefined) return undefined;
  const standing = relayReadoutStanding({ teams, rules: relayClass.legRules ?? [], restartRanking: relayClass.restartRanking ?? "AFTER_NORMAL",
    teamKey, runnerKey: subject.publicResultId, leg });
  if (!standing || (!standing.team && !standing.legTime)) return undefined;
  return { kind: "relay", leg: standing.leg, ...(standing.team ? { team: standing.team } : {}),
    ...(standing.legTime ? { legTime: standing.legTime } : {}) };
}
