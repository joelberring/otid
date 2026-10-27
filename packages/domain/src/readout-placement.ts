import { rankClassResults } from "./class-ranking";
import { rankRelayTeams, relayTeamResult, type RelayLegOutcome, type RelayRestartRanking } from "./relay";
import { relayParallelLegOutcome, type RelayApprovalRule, type RelayChangeoverRule } from "./relay-parallel";
import type { StoredResultStatus } from "./result-status-order";

/**
 * Steg 57: placeringen vid avläsningen. Löparens (eller lagets) preliminära ställning bland dem som hittills är godkända,
 * räknad ur en färdig resultatlista med löparens nya resultat inlagt. Rena funktioner; samma rangordning som
 * resultatlistan (`rankClassResults`, `rankRelayTeams`): lika tid ger samma placering, rogaining rangordnas på poäng och
 * sedan tid, och en gafflad klass rankas ihop.
 */
export interface StandingRow {
  readonly key: string;
  readonly name: string;
  readonly status: StoredResultStatus;
  readonly elapsedMs?: number;
  /** Rogaining: resultatets poäng. */
  readonly score?: number;
}

export interface ReadoutStanding {
  readonly position: number;
  /** Någon annan har samma placering. */
  readonly tied: boolean;
  /** Antal godkända (rankade) hittills, löparen inräknad. */
  readonly finished: number;
  /** Ledaren när löparen inte leder ensam: namnet och avståndet (tid, eller poäng när poängen skiljer). */
  readonly leader?: { readonly name: string; readonly behindMs?: number; readonly pointsBehind?: number };
  /** Leder ensam: marginalen till tvåan (tid, eller poäng när poängen skiljer). */
  readonly ahead?: { readonly ms?: number; readonly points?: number };
}

/** Avståndet mellan två rader: poäng när klassen har poäng och de skiljer, annars tid. */
function gap(better: StandingRow, worse: StandingRow, scored: boolean): { ms?: number; points?: number } {
  const points = scored ? (better.score ?? 0) - (worse.score ?? 0) : 0;
  if (points !== 0) return { points };
  return { ms: (worse.elapsedMs ?? 0) - (better.elapsedMs ?? 0) };
}

/**
 * Ställningen för `subjectKey` bland raderna (klassens resultat med löparens nya rad). Ingen ställning när löparen inte
 * är godkänd eller när klassen inte kan rankas (olika banversioner).
 */
export function readoutStanding(rows: readonly StandingRow[], subjectKey: string): ReadoutStanding | undefined {
  const scored = rows.some((row) => row.score !== undefined);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const ranking = rankClassResults(rows.map((row) => ({ key: row.key, status: row.status, courseVersionId: "class",
    ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }), ...(row.score === undefined ? {} : { score: row.score }) })));
  const ranked = ranking.filter((row) => row.rankingState === "RANKED");
  const own = ranked.find((row) => row.key === subjectKey);
  if (!own || own.position === undefined) return undefined;
  const subject = byKey.get(subjectKey)!;
  const tied = ranked.some((row) => row.key !== subjectKey && row.position === own.position);
  const base = { position: own.position, tied, finished: ranked.length };
  if (own.position === 1 && !tied) {
    const second = ranked.find((row) => row.key !== subjectKey);
    return second ? { ...base, ahead: gap(subject, byKey.get(second.key)!, scored) } : base;
  }
  const leader = ranked.find((row) => row.key !== subjectKey && row.position === 1)!;
  const distance = gap(byKey.get(leader.key)!, subject, scored);
  return { ...base, leader: { name: byKey.get(leader.key)!.name,
    ...(distance.points !== undefined ? { pointsBehind: distance.points } : { behindMs: distance.ms ?? 0 }) } };
}

/** En löpares rad i lagets sträcka (flera rader för samma sträcka när sträckan har flera löpare). */
export interface RelayStandingLeg {
  readonly key: string;
  readonly leg: number;
  /** Saknas = ute (eller väntar på start). */
  readonly status?: StoredResultStatus;
  readonly elapsedMs?: number;
  readonly restarted: boolean;
}

export interface RelayStandingTeam {
  readonly key: string;
  readonly name: string;
  readonly legs: readonly RelayStandingLeg[];
}

export interface RelayStandingRule {
  readonly leg: number;
  readonly changeoverRule: RelayChangeoverRule;
  readonly approvalRule: RelayApprovalRule;
}

export interface RelayReadoutStanding {
  readonly leg: number;
  /** Lagets placering efter sträckan (summan av sträcktiderna, omstartslag enligt klassens val). */
  readonly team?: ReadoutStanding;
  /** Löparens sträcktid mot de andra på sträckan. */
  readonly legTime?: ReadoutStanding & { readonly elapsedMs: number };
}

const EPOCH = new Date(0).toISOString();

/** Lagets resultat på en sträcka ur löparnas rader (ADR-0174 beslut 6 vid flera löpare på sträckan). */
function legOutcome(rows: readonly RelayStandingLeg[], leg: number, rule: RelayStandingRule | undefined): RelayLegOutcome {
  if (rows.length <= 1) {
    const row = rows[0];
    return { leg, ...(row?.restarted ? { restarted: true } : {}), ...(row?.status ? { status: row.status,
      ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }) } : {}) };
  }
  // Löparna bedöms från sträckans start, så deras tider är måltider räknade från en gemensam start.
  return relayParallelLegOutcome({ leg, changeover: rule?.changeoverRule ?? "FIRST", approval: rule?.approvalRule ?? "ALL",
    legStart: EPOCH, restarted: rows[0]!.restarted, runners: rows.map((row) => ({ ...(row.status ? { status: row.status } : {}),
      ...(row.status && row.elapsedMs !== undefined ? { finishTime: new Date(row.elapsedMs).toISOString() } : {}) })) });
}

/**
 * Stafett: lagets placering efter sträckan `leg` (som om stafetten hade `leg` sträckor) och löparens sträcktid mot de
 * andras på sträckan. Teamsprint och flera löpare per sträcka följer ADR-0174.
 */
export function relayReadoutStanding(input: { readonly teams: readonly RelayStandingTeam[]; readonly rules: readonly RelayStandingRule[];
  readonly restartRanking: RelayRestartRanking; readonly teamKey: string; readonly runnerKey: string; readonly leg: number }):
  RelayReadoutStanding | undefined {
  const team = input.teams.find((row) => row.key === input.teamKey);
  const runner = team?.legs.find((row) => row.key === input.runnerKey && row.leg === input.leg);
  if (!team || !runner) return undefined;
  const rules = new Map(input.rules.map((rule) => [rule.leg, rule]));
  const results = input.teams.map((row) => {
    const outcomes: RelayLegOutcome[] = [];
    for (let leg = 1; leg <= input.leg; leg += 1) outcomes.push(legOutcome(row.legs.filter((other) => other.leg === leg), leg, rules.get(leg)));
    return { key: row.key, result: relayTeamResult(input.leg, outcomes) };
  });
  const ranking = rankRelayTeams(results, { restartRanking: input.restartRanking });
  const resultOf = new Map(results.map((row) => [row.key, row.result]));
  const nameOf = new Map(input.teams.map((row) => [row.key, row.name]));
  const teamStanding = (() => {
    const own = ranking.find((row) => row.key === input.teamKey);
    if (own?.position === undefined) return undefined;
    const placed = ranking.filter((row) => row.position !== undefined);
    const tied = placed.some((row) => row.key !== input.teamKey && row.position === own.position);
    const base = { position: own.position, tied, finished: placed.length };
    const elapsed = (key: string) => resultOf.get(key)!.elapsedMs!;
    if (own.position === 1 && !tied) {
      const second = placed.find((row) => row.key !== input.teamKey);
      const ms = second ? elapsed(second.key) - elapsed(input.teamKey) : undefined;
      // Med omstartslag efter de andra (förvalet) kan tvåan ha kortare tid; då sägs ingen marginal.
      return second ? { ...base, ahead: ms !== undefined && ms >= 0 ? { ms } : {} } : base;
    }
    const leader = placed.find((row) => row.key !== input.teamKey && row.position === 1)!;
    const behindMs = elapsed(input.teamKey) - elapsed(leader.key);
    return { ...base, leader: { name: nameOf.get(leader.key)!, ...(behindMs >= 0 ? { behindMs } : {}) } };
  })();
  const legRows: StandingRow[] = input.teams.flatMap((row) => row.legs.filter((other) => other.leg === input.leg && other.status)
    .map((other) => ({ key: other.key, name: row.name, status: other.status!, ...(other.elapsedMs === undefined ? {} : { elapsedMs: other.elapsedMs }) })));
  const legStanding = runner.status === "OK" && runner.elapsedMs !== undefined ? readoutStanding(legRows, input.runnerKey) : undefined;
  return { leg: input.leg, ...(teamStanding ? { team: teamStanding } : {}),
    ...(legStanding ? { legTime: { ...legStanding, elapsedMs: runner.elapsedMs! } } : {}) };
}
