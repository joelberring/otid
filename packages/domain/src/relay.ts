import { rankClassResults, type ClassRankingState } from "./class-ranking";
import { compareResultStatuses, type StoredResultStatus } from "./result-status-order";

/**
 * Stafett (ADR-0169 beslut 3). En stafettklass har sträckor med startsätt per sträcka.
 * Varje sträcka bedöms som en individuell avläsning med sträckans starttid som fast
 * starttid; lagresultatet räknas här. Funktionerna är rena.
 *
 * Startsätt:
 * - MASS_START: sträckan startar på sin starttid (sträcka 1 alltid).
 * - CHANGEOVER: växling, sträckan startar när föregående sträcka gick i mål.
 * - RESTART: växling, men lag som inte växlat före omstartstiden startar då.
 *   Okänd måltid på föregående sträcka (inte avläst, brutit utan mål) ger omstartstiden.
 * - FLYING_RESTART (flygande omstart, steg 47): som omstart, men tiden räknas fram per sträcka:
 *   ledarlagets växling till sträckan (första laget som växlade, oavsett status) plus en gräns i
 *   minuter. Se `relayClassLegStarts` i relay-starts.ts.
 *
 * Lagets tid är summan av sträcktiderna. Utan masstarter efter sträcka 1 och utan omstart
 * är det samma sak som sista sträckans måltid minus första start. Ett lag är godkänt först
 * när alla sträckor är godkända; en felstämplad, diskad, bruten eller ej startad sträcka gör
 * laget orankat.
 */
export type RelayStartMethod = "MASS_START" | "CHANGEOVER" | "RESTART" | "FLYING_RESTART";

/** Längsta gräns för flygande omstart (minuter efter ledarens växling). */
export const RELAY_MAX_RESTART_AFTER_MINUTES = 720;

export const RELAY_MAX_LEGS = 30;

export interface RelayLegRule {
  readonly leg: number;
  readonly startMethod: RelayStartMethod;
  /** Masstart- eller omstartstid. Saknas för växling och flygande omstart. */
  readonly startTime?: string;
  /** Flygande omstart: minuter efter ledarlagets växling till sträckan. */
  readonly restartAfterMinutes?: number;
}

export type RelayLegRuleProblem =
  | "TOO_FEW_LEGS"
  | "TOO_MANY_LEGS"
  | "LEG_NUMBERS"
  | "FIRST_LEG_NOT_MASS_START"
  | "MISSING_START_TIME"
  | "UNEXPECTED_START_TIME"
  | "INVALID_START_TIME"
  | "MISSING_RESTART_AFTER"
  | "UNEXPECTED_RESTART_AFTER";

/** Kontrollerar sträckorna: 2–30 sträckor (steg 47: 25-manna ryms) numrerade 1..n, sträcka 1 masstart, tider där de behövs. */
export function relayLegRuleProblem(rules: readonly RelayLegRule[]): RelayLegRuleProblem | undefined {
  if (rules.length < 2) return "TOO_FEW_LEGS";
  if (rules.length > RELAY_MAX_LEGS) return "TOO_MANY_LEGS";
  const sorted = [...rules].sort((left, right) => left.leg - right.leg);
  if (sorted.some((rule, index) => rule.leg !== index + 1)) return "LEG_NUMBERS";
  if (sorted[0]!.startMethod !== "MASS_START") return "FIRST_LEG_NOT_MASS_START";
  for (const rule of sorted) {
    if (rule.startMethod === "FLYING_RESTART") {
      if (rule.startTime !== undefined) return "UNEXPECTED_START_TIME";
      const after = rule.restartAfterMinutes;
      if (after === undefined || !Number.isInteger(after) || after < 1 || after > RELAY_MAX_RESTART_AFTER_MINUTES) return "MISSING_RESTART_AFTER";
      continue;
    }
    if (rule.restartAfterMinutes !== undefined) return "UNEXPECTED_RESTART_AFTER";
    if (rule.startMethod === "CHANGEOVER") {
      if (rule.startTime !== undefined) return "UNEXPECTED_START_TIME";
      continue;
    }
    if (rule.startTime === undefined) return "MISSING_START_TIME";
    if (!Number.isFinite(Date.parse(rule.startTime))) return "INVALID_START_TIME";
  }
  return undefined;
}

function ms(value: string): number {
  return Date.parse(value);
}

/** Omstartstiden för sträckan: fast tid, eller den framräknade tiden för en flygande omstart. */
function restartTimeOf(rule: RelayLegRule, flyingRestartTime: string | undefined): string | undefined {
  if (rule.startMethod === "RESTART") return rule.startTime;
  if (rule.startMethod === "FLYING_RESTART") return flyingRestartTime;
  return undefined;
}

/**
 * Sträckans starttid givet föregående sträckas måltid (om den är känd). En flygande omstart behöver
 * den framräknade omstartstiden (`relayClassLegStarts`); utan den gäller växlingen.
 */
export function relayLegStartTime(rule: RelayLegRule, previousLegFinish: string | undefined, flyingRestartTime?: string): string | undefined {
  if (rule.startMethod === "MASS_START") return rule.startTime;
  const restart = restartTimeOf(rule, flyingRestartTime);
  if (rule.startMethod === "CHANGEOVER" || restart === undefined) return previousLegFinish;
  return previousLegFinish !== undefined && ms(previousLegFinish) < ms(restart) ? previousLegFinish : restart;
}

/** Startade sträckan i en omstart (och inte vid växling)? En växling exakt på omstartstiden räknas som omstart. */
export function relayLegRestarted(rule: RelayLegRule, previousLegFinish: string | undefined, flyingRestartTime?: string): boolean {
  const restart = restartTimeOf(rule, flyingRestartTime);
  return restart !== undefined && (previousLegFinish === undefined || ms(previousLegFinish) >= ms(restart));
}

/**
 * Starttid per sträcka för ett lag. `finishTimes` är sträckornas måltider (måltid från
 * resultatet, även om sträckan är felstämplad). Sträcka n:s start beror bara på sträcka n−1.
 */
export function relayLegStartTimes(rules: readonly RelayLegRule[], finishTimes: ReadonlyMap<number, string | undefined>):
  Map<number, string | undefined> {
  const starts = new Map<number, string | undefined>();
  for (const rule of [...rules].sort((left, right) => left.leg - right.leg)) {
    starts.set(rule.leg, relayLegStartTime(rule, rule.leg === 1 ? undefined : finishTimes.get(rule.leg - 1)));
  }
  return starts;
}

/** En sträckas resultat. Saknas status har sträckan inget resultat än (löparen är ute eller har inte startat). */
export interface RelayLegOutcome {
  readonly leg: number;
  readonly status?: StoredResultStatus;
  /** Sträcktid (mål − sträckans start). */
  readonly elapsedMs?: number;
  /** Sträckan startade i en omstart (fast eller flygande). */
  readonly restarted?: boolean;
}

export type RelayTeamStatus = StoredResultStatus | "RUNNING";

export interface RelayTeamResult {
  /** OK när alla sträckor är godkända; RUNNING när ingen sträcka underkänts och någon saknar resultat. */
  readonly status: RelayTeamStatus;
  /** Lagets tid (summan av sträcktiderna), bara för godkända lag. */
  readonly elapsedMs?: number;
  /** Första sträckan utan resultat: laget är ute på den sträckan. */
  readonly currentLeg?: number;
  /** Antal sträckor med resultat. */
  readonly completedLegs: number;
  /** Laget har deltagit i en omstart på någon sträcka (SOFT TR 5.8.2). */
  readonly restarted: boolean;
}

/** Underkända lagstatusar i den ordning de gäller när flera sträckor är underkända. */
const TEAM_FAILURE_ORDER: readonly StoredResultStatus[] = ["DSQ", "MP", "DNF", "DNS", "OOC", "NT", "OVERTIME"];

/** Lagets resultat ur sträckornas resultat. */
export function relayTeamResult(legCount: number, legs: readonly RelayLegOutcome[]): RelayTeamResult {
  const byLeg = new Map(legs.map((leg) => [leg.leg, leg]));
  let currentLeg: number | undefined;
  let completedLegs = 0;
  let total = 0;
  const failures = new Set<StoredResultStatus>();
  for (let leg = 1; leg <= legCount; leg += 1) {
    const outcome = byLeg.get(leg);
    if (!outcome?.status) { currentLeg ??= leg; continue; }
    completedLegs += 1;
    if (outcome.status !== "OK") { failures.add(outcome.status); continue; }
    if (outcome.elapsedMs === undefined || !Number.isSafeInteger(outcome.elapsedMs) || outcome.elapsedMs < 0) {
      throw new Error("Godkänd sträcka saknar giltig sträcktid");
    }
    total += outcome.elapsedMs;
  }
  const failure = TEAM_FAILURE_ORDER.find((status) => failures.has(status));
  const restarted = legs.some((leg) => leg.restarted === true);
  const base = { completedLegs, restarted, ...(currentLeg === undefined ? {} : { currentLeg }) };
  if (failure) return { status: failure, ...base };
  if (currentLeg !== undefined) return { status: "RUNNING", ...base };
  return { status: "OK", elapsedMs: total, ...base };
}

export interface RelayTeamRankingCandidate {
  readonly key: string;
  readonly result: RelayTeamResult;
}

export interface RelayTeamRanking {
  readonly key: string;
  readonly position?: number;
  readonly timeBehindMs?: number;
}

/**
 * Hur lag som deltagit i omstart placeras (steg 47, ADR-0174). `AFTER_NORMAL` (förval, SOFT TR 5.8.2):
 * efter lagen som bara haft vanliga växlingar, sinsemellan efter summan av sträcktiderna.
 * `BY_TIME`: alla godkända lag efter summan av sträcktiderna.
 */
export type RelayRestartRanking = "AFTER_NORMAL" | "BY_TIME";

/**
 * Placering bland godkända lag efter lagets tid (summan av sträcktiderna); lika tid ger samma
 * placering. Ordning: placerade lag (med förvalet först lag utan omstart, sedan lag som deltagit i
 * omstart, med fortlöpande placering), lag som är ute (flest avklarade sträckor först), sedan
 * underkända lag.
 */
export function rankRelayTeams(candidates: readonly RelayTeamRankingCandidate[],
  options: { readonly restartRanking?: RelayRestartRanking } = {}): RelayTeamRanking[] {
  const compareKey = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const separate = (options.restartRanking ?? "AFTER_NORMAL") === "AFTER_NORMAL";
  const tier = (result: RelayTeamResult) => separate && result.restarted ? 1 : 0;
  const ranked = candidates.filter((candidate) => candidate.result.status === "OK")
    .sort((left, right) => tier(left.result) - tier(right.result) || left.result.elapsedMs! - right.result.elapsedMs! ||
      compareKey(left.key, right.key));
  const positions = new Map<string, { position: number; timeBehindMs: number }>();
  let previous: string | undefined;
  let position = 0;
  for (const [index, candidate] of ranked.entries()) {
    const elapsed = candidate.result.elapsedMs!;
    const key = `${tier(candidate.result)}:${elapsed}`;
    if (key !== previous) position = index + 1;
    positions.set(candidate.key, { position, timeBehindMs: elapsed - ranked[0]!.result.elapsedMs! });
    previous = key;
  }
  const group = (result: RelayTeamResult) => result.status === "OK" ? 0 : result.status === "RUNNING" ? 1 : 2;
  return [...candidates].sort((left, right) => {
    const difference = group(left.result) - group(right.result);
    if (difference !== 0) return difference;
    if (left.result.status === "OK") return tier(left.result) - tier(right.result) ||
      left.result.elapsedMs! - right.result.elapsedMs! || compareKey(left.key, right.key);
    if (left.result.status === "RUNNING") return right.result.completedLegs - left.result.completedLegs || compareKey(left.key, right.key);
    return compareResultStatuses(left.result.status as StoredResultStatus, right.result.status as StoredResultStatus) ||
      compareKey(left.key, right.key);
  }).map((candidate) => ({ key: candidate.key, ...(positions.get(candidate.key) ?? {}) }));
}

export interface RelayLegRankingCandidate {
  readonly key: string;
  readonly leg: number;
  readonly status: StoredResultStatus;
  readonly elapsedMs?: number;
  readonly courseVersionId: string;
}

export interface RelayLegRanking {
  readonly key: string;
  readonly leg: number;
  readonly rankingState: ClassRankingState;
  readonly position?: number;
  readonly timeBehindMs?: number;
}

/** Sträckresultat: varje sträcka rankas för sig efter sträcktid, med samma regler som en individuell klass. */
export function rankRelayLegs(candidates: readonly RelayLegRankingCandidate[]): RelayLegRanking[] {
  const legs = [...new Set(candidates.map((candidate) => candidate.leg))].sort((left, right) => left - right);
  return legs.flatMap((leg) => rankClassResults(candidates.filter((candidate) => candidate.leg === leg)
    .map(({ key, status, elapsedMs, courseVersionId }) => ({ key, status, courseVersionId,
      ...(elapsedMs === undefined ? {} : { elapsedMs }) })))
    .map((ranking) => ({ ...ranking, leg })));
}
