import type { PublicRelayResults, PublicResultListResponse } from "@o-tid/contracts";
import { buildSplitTable, type SplitTable } from "@o-tid/domain";
import { compareText, matches, searchable } from "./search";
import { groupByClub, type ClubGroup } from "./start-list-model";

/**
 * PLAN.md steg 13: en gemensam modell för resultatlistorna i arbetsytan och på den publika sidan. Båda läser de
 * publicerade resultaten; placering, tid efter och sträckplaceringar kommer från resultatmotorn och domänen.
 */

export type ResultStatus = "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS" | "NT";
export type ResultSplit = { controlCode: number; occurrence: number; legMs: number; elapsedMs: number };
export type ResultRow = {
  /** Länk till löparens resultatsida; saknas i äldre format. */
  publicResultId: string | null;
  name: string; club: string | null; className: string; place: number | null; timeMs: number | null; behindMs: number | null;
  status: ResultStatus; reason: string; variant: string | null; splits: ResultSplit[]; missingControls: number[];
};
export type ResultClass = { name: string; rows: ResultRow[];
  /** Godkända resultat bygger på olika banversioner: ingen placering visas. */
  mixedCourses: boolean };
export type RelayClass = PublicRelayResults["classes"][number];
export type RelayTeam = RelayClass["teams"][number];
export type ResultListModel = { classes: ResultClass[]; relayClasses: RelayClass[] };

type PublicRow = PublicResultListResponse["results"][number];

function row(result: PublicRow): ResultRow {
  return {
    publicResultId: "publicResultId" in result ? result.publicResultId : null,
    name: `${result.givenName} ${result.familyName}`, club: result.organisationName, className: result.className,
    place: "position" in result ? result.position ?? null : null,
    timeMs: "elapsedMs" in result ? result.elapsedMs ?? null : null,
    behindMs: "timeBehindMs" in result ? result.timeBehindMs ?? null : null,
    status: result.status, reason: result.reason,
    variant: "courseVariantCode" in result ? result.courseVariantCode ?? null : null,
    splits: "splits" in result ? result.splits.map(split => ({ ...split })) : [],
    missingControls: "missingControls" in result ? [...result.missingControls] : []
  };
}

/** Serverns ordning (status, tid, namn) behålls; klasserna kommer i bokstavsordning. */
export function resultListFromPublic(results: PublicResultListResponse, relay: PublicRelayResults): ResultListModel {
  const classes = new Map<string, ResultClass>();
  for (const result of results.results) {
    const raceClass = classes.get(result.className) ?? { name: result.className, rows: [], mixedCourses: false };
    raceClass.rows.push(row(result));
    if (result.rankingState === "MIXED_COURSE_VERSIONS") raceClass.mixedCourses = true;
    classes.set(result.className, raceClass);
  }
  return { classes: [...classes.values()], relayClasses: relay.classes };
}

/** Alla klassnamn (individuella och stafett) för klassfiltret. */
export function resultClassNames(model: ResultListModel): string[] {
  return [...new Set([...model.classes.map(row => row.name), ...model.relayClasses.map(row => row.name)])].sort(compareText);
}

const teamMatches = (needle: string, team: RelayTeam) =>
  matches(needle, team.name, team.organisationName, ...team.legs.flatMap(leg => [`${leg.givenName} ${leg.familyName}`, leg.organisationName]));

/** Sök (namn, klubb, lag) och klassfilter. Klasser utan träffar döljs. */
export function filterResults(model: ResultListModel, query: string, className: string): ResultListModel {
  const needle = searchable(query.trim());
  return {
    classes: model.classes.filter(row => !className || row.name === className).flatMap(raceClass => {
      const rows = needle ? raceClass.rows.filter(result => matches(needle, result.name, result.club)) : raceClass.rows;
      return rows.length ? [{ ...raceClass, rows }] : [];
    }),
    relayClasses: model.relayClasses.filter(row => !className || row.name === className).flatMap(raceClass => {
      if (!needle) return [raceClass];
      const teams = raceClass.teams.filter(team => teamMatches(needle, team));
      const numbers = new Set(teams.map(team => team.number));
      return teams.length ? [{ ...raceClass, teams, legs: raceClass.legs.map(leg => ({ ...leg,
        results: leg.results.filter(result => numbers.has(result.teamNumber)) })) }] : [];
    })
  };
}

export type SplitGroup = { className: string; variant: string | null; rows: ResultRow[]; table: SplitTable };

/**
 * Sträcktider per klass. En gafflad klass delas per variant, eftersom sträckorna bara kan jämföras inom samma
 * variant. Löpare utan sträcktider (ej start, ej fullföljt, utan tidtagning) visas inte i sträcktidslistan.
 */
export function splitGroups(raceClass: ResultClass): SplitGroup[] {
  const groups = new Map<string, ResultRow[]>();
  for (const result of raceClass.rows) {
    if (result.splits.length === 0 && result.timeMs === null) continue;
    const key = result.variant ?? "";
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.entries()].sort(([a], [b]) => compareText(a, b)).map(([variant, rows]) => ({
    className: raceClass.name, variant: variant || null, rows,
    table: buildSplitTable(rows.map((result, index) => ({ key: String(index), ok: result.status === "OK",
      ...(result.timeMs === null ? {} : { elapsedMs: result.timeMs }), splits: result.splits })))
  }));
}

export type ClubResultRow = { className: string; result: ResultRow };
export type ClubTeamRow = { className: string; team: RelayTeam };
export type ClubResults = {
  club: string | null; runners: ClubResultRow[]; teams: ClubTeamRow[];
  /** Antal löpare, godkända och pallplatser (plats 1–3) för individuella resultat. */
  summary: { runners: number; approved: number; podium: number };
};

/** Resultaten per klubb: individuella löpare i klassordning och stafettlag. */
export function resultsByClub(model: ResultListModel): ClubResults[] {
  type Item = { kind: "RUNNER"; row: ClubResultRow } | { kind: "TEAM"; row: ClubTeamRow };
  const items: Item[] = [
    ...model.classes.flatMap(raceClass => raceClass.rows.map(result => ({ kind: "RUNNER" as const, row: { className: raceClass.name, result } }))),
    ...model.relayClasses.flatMap(raceClass => raceClass.teams.map(team => ({ kind: "TEAM" as const, row: { className: raceClass.name, team } })))
  ];
  return groupByClub(items, item => item.kind === "RUNNER" ? item.row.result.club : item.row.team.organisationName)
    .map(({ club, rows }: ClubGroup<Item>) => {
      const runners = rows.flatMap(item => item.kind === "RUNNER" ? [item.row] : []);
      return { club, runners, teams: rows.flatMap(item => item.kind === "TEAM" ? [item.row] : []),
        summary: { runners: runners.length, approved: runners.filter(row => row.result.status === "OK").length,
          podium: runners.filter(row => row.result.place !== null && row.result.place <= 3).length } };
    });
}
