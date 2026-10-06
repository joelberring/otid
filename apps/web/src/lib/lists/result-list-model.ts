import type { PublicRadioResponse, PublicRelayResults, PublicResultListResponse } from "@o-tid/contracts";
import { splitTablesByVariant, type SplitTable } from "@o-tid/domain";
import { compareText, matches, searchable } from "./search";
import { groupByClub, type ClubGroup } from "./start-list-model";

/**
 * PLAN.md steg 13: en gemensam modell för resultatlistorna i arbetsytan och på den publika sidan. Båda läser de
 * publicerade resultaten; placering, tid efter och sträckplaceringar kommer från resultatmotorn och domänen.
 */

export type ResultStatus = "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS" | "NT";
export type ResultSplit = { controlCode: number; occurrence: number; legMs: number; elapsedMs: number };
/** Rogaining (ADR-0170 beslut 5): kontrollpoäng, straff, summa och de räknade kontrollerna i stämplingsordning. */
export type ResultScore = { controlPoints: number; penalty: number; total: number; controls: { controlCode: number; points: number }[] };
export type ResultRow = {
  /** Länk till löparens resultatsida; saknas i äldre format. */
  publicResultId: string | null;
  name: string; club: string | null; className: string; place: number | null; timeMs: number | null; behindMs: number | null;
  status: ResultStatus; reason: string; variant: string | null; splits: ResultSplit[]; missingControls: number[];
  score: ResultScore | null;
};
/** Mellantider vid klassens radiokontroller (ADR-0172 beslut 5). */
export type RadioClass = PublicRadioResponse["classes"][number];
export type ResultClass = { name: string; rows: ResultRow[];
  /** Radiokontrollerna: de som är ute i skogen och tiderna vid varje kontroll. Saknas utan radio. */
  radio?: RadioClass | undefined;
  /** Rogainingklass: listan visar poäng, straff och summa (sorterad på summa, sedan tid). */
  scored: boolean;
  /** Godkända resultat bygger på olika banversioner: ingen placering visas. */
  mixedCourses: boolean };
export type RelayClass = PublicRelayResults["classes"][number];
export type RelayTeam = RelayClass["teams"][number];
export type ResultListModel = { classes: ResultClass[]; relayClasses: RelayClass[];
  /** Tidszonen för radiopassagernas klockslag; saknas utan radio. */
  radioTimeZone?: string | null | undefined };

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
    missingControls: "missingControls" in result ? [...result.missingControls] : [],
    score: "rogaining" in result && result.rogaining ? { controlPoints: result.rogaining.controlPoints, penalty: result.rogaining.penalty,
      total: result.rogaining.total, controls: result.rogaining.controls.map(control => ({ ...control })) } : null
  };
}

/**
 * Serverns ordning (status, poäng, tid, namn) behålls; klasserna kommer i bokstavsordning. Med radio får klasserna
 * sina mellantider, och en klass där ingen läst av än men någon passerat en radiokontroll finns med utan resultat.
 */
export function resultListFromPublic(results: PublicResultListResponse, relay: PublicRelayResults,
  radio?: PublicRadioResponse): ResultListModel {
  const classes = new Map<string, ResultClass>();
  for (const result of results.results) {
    const raceClass = classes.get(result.className) ?? { name: result.className, rows: [], mixedCourses: false, scored: false };
    const value = row(result);
    raceClass.rows.push(value);
    if (value.score) raceClass.scored = true;
    if (result.rankingState === "MIXED_COURSE_VERSIONS") raceClass.mixedCourses = true;
    classes.set(result.className, raceClass);
  }
  const live = radio?.enabled ? radio.classes : [];
  for (const radioClass of live) {
    const raceClass = classes.get(radioClass.className) ?? { name: radioClass.className, rows: [], mixedCourses: false, scored: false };
    classes.set(radioClass.className, { ...raceClass, radio: radioClass });
  }
  // Samma ordning som servern (svensk bokstavsordning); radioklasserna sorteras in.
  return { classes: [...classes.values()].sort((a, b) => a.name.localeCompare(b.name, "sv")), relayClasses: relay.classes,
    radioTimeZone: live.length > 0 ? radio!.timeZone : null };
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
      if (!needle) return [raceClass];
      const rows = raceClass.rows.filter(result => matches(needle, result.name, result.club));
      const radio = raceClass.radio ? filterRadio(raceClass.radio, needle) : undefined;
      return rows.length || radio ? [{ ...raceClass, rows, radio }] : [];
    }),
    relayClasses: model.relayClasses.filter(row => !className || row.name === className).flatMap(raceClass => {
      if (!needle) return [raceClass];
      const teams = raceClass.teams.filter(team => teamMatches(needle, team));
      const numbers = new Set(teams.map(team => team.number));
      return teams.length ? [{ ...raceClass, teams, legs: raceClass.legs.map(leg => ({ ...leg,
        results: leg.results.filter(result => numbers.has(result.teamNumber)) })) }] : [];
    }),
    radioTimeZone: model.radioTimeZone
  };
}

/** Sökningen i radiodelen: löpare (namn, klubb) som är ute och vid kontrollerna. Undefined utan träffar. */
function filterRadio(radio: RadioClass, needle: string): RadioClass | undefined {
  const hit = (passage: RadioClass["onTheWay"][number]) =>
    matches(needle, `${passage.givenName} ${passage.familyName}`, passage.organisationName);
  const onTheWay = radio.onTheWay.filter(hit);
  const controls = radio.controls.map(control => ({ ...control, passages: control.passages.filter(hit) }));
  return onTheWay.length || controls.some(control => control.passages.length) ? { ...radio, onTheWay, controls } : undefined;
}

export type SplitGroup = { className: string; variant: string | null; rows: ResultRow[]; table: SplitTable };

/**
 * Sträcktider per klass (domänens sträcktidsanalys). En gafflad klass delas per variant, eftersom sträckorna bara
 * kan jämföras inom samma variant. Löpare utan sträcktider (ej start, ej fullföljt, utan tidtagning) visas inte.
 */
export function splitGroups(raceClass: ResultClass): SplitGroup[] {
  const rows = raceClass.rows.filter(result => result.splits.length > 0 || result.timeMs !== null);
  return splitTablesByVariant(rows.map((result, index) => ({ key: String(index), ok: result.status === "OK", variant: result.variant,
    ...(result.timeMs === null ? {} : { elapsedMs: result.timeMs }), splits: result.splits })))
    .map(group => ({ className: raceClass.name, variant: group.variant, rows: group.keys.map(key => rows[Number(key)]!), table: group.table }));
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
