import type { ReadoutPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import {
  evaluateCardReadout, relayLegStartTime, relayTeamResult, type RaceSnapshot, type RelayLegOutcome, type RelayTeamResult
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

/** Senaste avläsningen av sträcklöparens bricka i den här webbläsaren. */
function localPayload(pkg: ReadoutPackage, local: readonly SportidentReadoutPayload[], entryId: string) {
  const card = cardOf(pkg, entryId);
  return card === undefined ? undefined : [...local].reverse().find((payload) => payload.cardNumber === card);
}

function legFinish(pkg: ReadoutPackage, local: readonly SportidentReadoutPayload[], entryId: string): string | undefined {
  return localPayload(pkg, local, entryId)?.finishPunchedAt ??
    pkg.relay?.legResults.find((row) => row.entryId === entryId)?.finishTime ?? undefined;
}

/** Ögonblicksbilden med sträckans lokalt räknade start, när den går att räkna. Annars paketets. */
export function relaySnapshot(pkg: ReadoutPackage, entryId: string, local: readonly SportidentReadoutPayload[]): RaceSnapshot {
  const snapshot = pkg.raceSnapshot as RaceSnapshot;
  const relay = pkg.relay;
  const found = relay && teamOf(relay, entryId);
  const rule = found && relay.classes.find((row) => row.classId === found.team.classId)?.legs.find((leg) => leg.leg === found.leg);
  if (!found || !rule) return snapshot;
  const previous = found.team.legs.find((leg) => leg.leg === found.leg - 1);
  const start = relayLegStartTime({ leg: rule.leg, startMethod: rule.startMethod, ...(rule.startTime ? { startTime: rule.startTime } : {}) },
    previous ? legFinish(pkg, local, previous.entryId) : undefined);
  if (!start) return snapshot;
  return { ...snapshot, entries: snapshot.entries.map((entry) => entry.id === entryId ? { ...entry, fixedStartTime: start } : entry) };
}

function legOutcome(pkg: ReadoutPackage, local: readonly SportidentReadoutPayload[], entryId: string, leg: number): RelayLegOutcome {
  const payload = localPayload(pkg, local, entryId);
  if (payload) {
    const readout = { cardNumber: payload.cardNumber, punches: payload.punches,
      ...(payload.finishPunchedAt ? { finishPunchedAt: payload.finishPunchedAt } : {}),
      ...(payload.startPunchedAt ? { startPunchedAt: payload.startPunchedAt } : {}) };
    const result = evaluateCardReadout(readout, relaySnapshot(pkg, entryId, local));
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
  const outcomes = found.team.legs.map((leg) => leg.entryId === entryId ? { ...current, leg: leg.leg }
    : legOutcome(pkg, local, leg.entryId, leg.leg));
  return { teamNumber: found.team.number, teamName: found.team.name, leg: found.leg, legCount, team: relayTeamResult(legCount, outcomes) };
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

/** Lagets nummer och sträckan, för övningsstationens lista. */
export function relayPlace(pkg: ReadoutPackage, entryId: string): { readonly teamNumber: number; readonly leg: number } | undefined {
  const found = pkg.relay && teamOf(pkg.relay, entryId);
  return found ? { teamNumber: found.team.number, leg: found.leg } : undefined;
}
