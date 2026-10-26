import type { ReadoutPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import {
  entryCourseControls, evaluateReadoutForEntry, relayClassLegStarts, relayTeamResult, teamSprintEachLegLayout,
  teamSprintRoute, type EvaluationReadout, type RaceSnapshot, type RelayLegOutcome, type RelayTeamResult, type TeamSprintEachLegPart,
  type TeamSprintRoute
} from "@o-tid/domain";

/**
 * Stafett i avläsningsvyn (ADR-0169 beslut 3). Sträckans start räknas lokalt med samma regel
 * som servern: föregående sträckas måltid från en avläsning i den här webbläsaren, annars från
 * paketet. Lagets tid räknas ur sträckornas lokala eller kända resultat. Serverns svar gäller.
 */
export interface LocalRelay {
  readonly teamNumber: number;
  readonly teamName: string;
  readonly leg: number;
  /** Steg 48: teamsprint – alla sträckor som löparen springer med brickan, och saknade växlingsstämplingar. */
  readonly legs: readonly number[];
  readonly changeoverMissing?: { readonly needed: number; readonly found: number };
  /**
   * Steg 50: teamsprint med utläsning efter varje sträcka – vilken av löparens sträckor utläsningen gällde (`part` = 1 för
   * löparens första), löparen, och sträckor vars utläsning saknas (glömd utläsning).
   */
  readonly teamSprint?: { readonly part: number; readonly runner: string; readonly missingLegs: readonly number[] };
  readonly legCount: number;
  readonly team: RelayTeamResult;
}

type Relay = NonNullable<ReadoutPackage["relay"]>;

function teamOf(relay: Relay, entryId: string) {
  for (const team of relay.teams) {
    const leg = team.legs.find((candidate) => candidate.entryId === entryId);
    if (leg) return { team, leg: leg.leg };
  }
  return undefined;
}

function cardOf(pkg: ReadoutPackage, entryId: string): string | undefined {
  return pkg.raceSnapshot.cardAssignments.find((assignment) => assignment.active && assignment.entryId === entryId)?.cardNumber;
}

export function payloadReadout(payload: SportidentReadoutPayload): EvaluationReadout {
  return { cardNumber: payload.cardNumber, punches: payload.punches,
    ...(payload.finishPunchedAt ? { finishPunchedAt: payload.finishPunchedAt } : {}),
    ...(payload.startPunchedAt ? { startPunchedAt: payload.startPunchedAt } : {}) };
}

/** Steg 50: löparen (brickans ägare) i en teamsprint med utläsning efter varje sträcka, med sträckorna i ordning. */
function eachLegRunner(pkg: ReadoutPackage, cardNumber: string) {
  const owner = pkg.raceSnapshot.cardAssignments.find((assignment) => assignment.active && assignment.cardNumber === cardNumber);
  const entry = owner && pkg.raceSnapshot.entries.find((candidate) => candidate.id === owner.entryId);
  const sprint = entry?.teamSprint;
  if (!entry || sprint?.mode !== "EACH_LEG") return undefined;
  const legs = teamSprintLegs(pkg, entry.id)?.legs;
  return legs ? { owner: entry, legs, changeoverCode: sprint.changeoverCode } : undefined;
}

export interface LocalTeamSprintRouting {
  /** Löparens sträckor med utläsningen som varje sträcka bygger på i den här webbläsaren. */
  readonly assigned: ReadonlyMap<string, SportidentReadoutPayload>;
  /** Den sista utläsningens fördelning, sträckan den gäller och delningen för bedömningen. */
  readonly last?: { readonly route: TeamSprintRoute; readonly target?: string; readonly layout: ReadonlyMap<string, TeamSprintEachLegPart> };
}

/**
 * Steg 50: fördelar brickans utläsningar i den här webbläsaren (i tur och ordning) på löparens sträckor med samma regel som
 * servern. Sträckor som har ett resultat i paketet räknas som utlästa (med paketets måltid).
 */
export function routeTeamSprintLocally(pkg: ReadoutPackage, payloads: readonly SportidentReadoutPayload[]): LocalTeamSprintRouting | undefined {
  const runner = payloads[0] && eachLegRunner(pkg, payloads[0].cardNumber);
  if (!runner) return undefined;
  const known = new Map((pkg.relay?.legResults ?? []).map((row) => [row.entryId, row]));
  const assigned = new Map<string, SportidentReadoutPayload>();
  const links = new Map<string, { id: string; finishPunchedAt?: string }>();
  const snapshot = pkg.raceSnapshot as RaceSnapshot;
  let last: LocalTeamSprintRouting["last"];
  payloads.forEach((payload, index) => {
    const parts = runner.legs.map((leg) => {
      const readout = links.get(leg.entryId) ?? (known.get(leg.entryId)?.finishTime
        ? { id: `server:${leg.entryId}`, finishPunchedAt: known.get(leg.entryId)!.finishTime! } : undefined);
      return { entryId: leg.entryId, leg: leg.leg, done: links.has(leg.entryId) || known.has(leg.entryId),
        controlCodes: entryCourseControls(snapshot, leg.entryId)?.controlCodes ?? [], ...(readout ? { readout } : {}) };
    });
    const route = teamSprintRoute(parts, payloadReadout(payload), runner.changeoverCode);
    const missing = new Set(route.kind === "LEGS" ? route.missing : []);
    const linked = route.kind === "REREAD" ? route.parts.map((part) => runner.legs[part - 1]!.entryId)
      : route.kind === "LEGS" ? runner.legs.slice(route.from - 1, route.to).flatMap((leg, offset) => missing.has(route.from + offset) ? [] : [leg.entryId])
      : [];
    const link = { id: `local:${index}`, ...(payload.finishPunchedAt ? { finishPunchedAt: payload.finishPunchedAt } : {}) };
    for (const entryId of linked) { links.set(entryId, link); assigned.set(entryId, payload); }
    const layout = teamSprintEachLegLayout(parts.map((part) => {
      const readout = links.get(part.entryId) ?? part.readout;
      return { entryId: part.entryId, ...(readout ? { readout } : {}) };
    }), runner.changeoverCode);
    last = { route, ...(linked.length > 0 ? { target: linked.at(-1)! } : {}), layout };
  });
  return { assigned, ...(last ? { last } : {}) };
}

/** Sträcklöparnas avläsningar i den här webbläsaren: brickans senaste, eller i teamsprint den som sträckan fick. */
function localPayloads(pkg: ReadoutPackage, local: readonly SportidentReadoutPayload[]): (entryId: string) => SportidentReadoutPayload | undefined {
  const sprints = new Map<string, ReadonlyMap<string, SportidentReadoutPayload>>();
  return (entryId) => {
    const entry = pkg.raceSnapshot.entries.find((candidate) => candidate.id === entryId);
    if (entry?.teamSprint?.mode === "EACH_LEG") {
      const owner = entry.teamSprint.legEntryIds[0]!;
      const card = cardOf(pkg, owner);
      if (card === undefined) return undefined;
      if (!sprints.has(owner)) sprints.set(owner, routeTeamSprintLocally(pkg, local.filter((payload) => payload.cardNumber === card))?.assigned ?? new Map());
      return sprints.get(owner)!.get(entryId);
    }
    const card = cardOf(pkg, entryId);
    return card === undefined ? undefined : [...local].reverse().find((payload) => payload.cardNumber === card);
  };
}

function legFinish(pkg: ReadoutPackage, payloadOf: (entryId: string) => SportidentReadoutPayload | undefined, entryId: string): string | undefined {
  return payloadOf(entryId)?.finishPunchedAt ??
    pkg.relay?.legResults.find((row) => row.entryId === entryId)?.finishTime ?? undefined;
}

/** Ögonblicksbilden med sträckans lokalt räknade start, när den går att räkna. Annars paketets. */
export function relaySnapshot(pkg: ReadoutPackage, entryId: string, local: readonly SportidentReadoutPayload[]): RaceSnapshot {
  const snapshot = pkg.raceSnapshot as RaceSnapshot;
  const relay = pkg.relay;
  const found = relay && teamOf(relay, entryId);
  const rule = found && relay.classes.find((row) => row.classId === found.team.classId)?.legs.find((leg) => leg.leg === found.leg);
  if (!found || !rule) return snapshot;
  // Steg 47: hela klassens växlingar, eftersom en flygande omstart räknas från ledarlagets växling.
  const classRules = relay.classes.find((row) => row.classId === found.team.classId)!.legs.map((leg) => ({ leg: leg.leg,
    startMethod: leg.startMethod, ...(leg.startTime ? { startTime: leg.startTime } : {}),
    ...(leg.restartAfterMinutes !== null ? { restartAfterMinutes: leg.restartAfterMinutes } : {}) }));
  const payloadOf = localPayloads(pkg, local);
  const teams = relay.teams.filter((team) => team.classId === found.team.classId).map((team) => ({ key: team.id,
    changeovers: new Map(team.legs.map((leg) => [leg.leg, legFinish(pkg, payloadOf, leg.entryId)])) }));
  const start = relayClassLegStarts(classRules, teams).teams.get(found.team.id)?.get(found.leg)?.start;
  if (!start || rule.leg !== found.leg) return snapshot;
  return { ...snapshot, entries: snapshot.entries.map((entry) => entry.id === entryId ? { ...entry, fixedStartTime: start } : entry) };
}

function legOutcome(pkg: ReadoutPackage, local: readonly SportidentReadoutPayload[], entryId: string, leg: number,
  payloadOf: (entryId: string) => SportidentReadoutPayload | undefined): RelayLegOutcome {
  const payload = payloadOf(entryId);
  if (payload) {
    const result = evaluateReadoutForEntry(payloadReadout(payload), relaySnapshot(pkg, entryId, local), entryId);
    if (result.status !== "UNKNOWN_CARD") return { leg, status: result.status, ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}) };
  }
  const known = pkg.relay?.legResults.find((row) => row.entryId === entryId);
  return known ? { leg, status: known.status, ...(known.elapsedMs !== null ? { elapsedMs: known.elapsedMs } : {}) } : { leg };
}

/** Laget och sträckan för en avläst sträcklöpare, med lagets resultat efter den här sträckan. */
export function localRelay(pkg: ReadoutPackage, entryId: string, current: Omit<RelayLegOutcome, "leg">,
  local: readonly SportidentReadoutPayload[]): LocalRelay | undefined {
  const relay = pkg.relay;
  const found = relay && teamOf(relay, entryId);
  const legCount = found && relay.classes.find((row) => row.classId === found.team.classId)?.legs.length;
  if (!found || !legCount) return undefined;
  const payloadOf = localPayloads(pkg, local);
  const outcomes = found.team.legs.map((leg) => leg.entryId === entryId ? { ...current, leg: leg.leg }
    : legOutcome(pkg, local, leg.entryId, leg.leg, payloadOf));
  const legs = [found.leg, ...found.team.legs.filter((leg) => leg.sameAsLeg === found.leg).map((leg) => leg.leg)].sort((a, b) => a - b);
  return { teamNumber: found.team.number, teamName: found.team.name, leg: found.leg, legs, legCount,
    team: relayTeamResult(legCount, outcomes) };
}

/**
 * Övningsstationen: tider för en sträcklöpare så att lagets sträckor följer på varandra. Lagets
 * fönster är från masstarten till nu; sträcka k av n går i mål efter k/n av fönstret (lite olika
 * fart per lag). Stämplingarna läggs efter sträckans start. Ger undefined utan masstart i det förflutna.
 */
export function relayExerciseWindow(pkg: ReadoutPackage, entryId: string, now: Date): { startAt: Date; finishAt: Date } | undefined {
  const relay = pkg.relay;
  const found = relay && teamOf(relay, entryId);
  const legs = found && relay.classes.find((row) => row.classId === found.team.classId)?.legs;
  const massStart = legs?.find((leg) => leg.leg === 1)?.startTime;
  if (!found || !legs || !massStart) return undefined;
  const window = now.getTime() - 5_000 - Date.parse(massStart);
  if (!(window > 5 * 60_000)) return undefined;
  const pace = 1 - 0.03 * (found.team.number % 5);
  const at = (fraction: number) => new Date(Date.parse(massStart) + Math.floor(window * pace * fraction / 1_000) * 1_000);
  return { startAt: at((found.leg - 1) / legs.length), finishAt: at(found.leg / legs.length) };
}

/** Steg 48: teamsprint – löparens sträckor (med brickans ägare först) och lagets antal sträckor. */
export function teamSprintLegs(pkg: ReadoutPackage, entryId: string): { legs: { leg: number; entryId: string }[]; legCount: number } | undefined {
  const relay = pkg.relay;
  const found = relay && teamOf(relay, entryId);
  const legCount = found && relay.classes.find((row) => row.classId === found.team.classId)?.legs.length;
  if (!found || !legCount) return undefined;
  const legs = found.team.legs.filter((leg) => leg.entryId === entryId || leg.sameAsLeg === found.leg)
    .map((leg) => ({ leg: leg.leg, entryId: leg.entryId })).sort((a, b) => a.leg - b.leg);
  return legs.length > 1 ? { legs, legCount } : undefined;
}

/** Lagets nummer och sträckan, för övningsstationens lista. */
export function relayPlace(pkg: ReadoutPackage, entryId: string): { readonly teamNumber: number; readonly leg: number } | undefined {
  const found = pkg.relay && teamOf(pkg.relay, entryId);
  return found ? { teamNumber: found.team.number, leg: found.leg } : undefined;
}
