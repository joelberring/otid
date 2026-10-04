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
 *
 * Lagets tid är summan av sträcktiderna. Utan masstarter efter sträcka 1 och utan omstart
 * är det samma sak som sista sträckans måltid minus första start. Ett lag är godkänt först
 * när alla sträckor är godkända; en felstämplad, diskad, bruten eller ej startad sträcka gör
 * laget orankat.
 */
export type RelayStartMethod = "MASS_START" | "CHANGEOVER" | "RESTART";

export const RELAY_MAX_LEGS = 20;

export interface RelayLegRule {
  readonly leg: number;
  readonly startMethod: RelayStartMethod;
  /** Masstart- eller omstartstid. Saknas för växling. */
  readonly startTime?: string;
}

export type RelayLegRuleProblem =
  | "TOO_FEW_LEGS"
  | "TOO_MANY_LEGS"
  | "LEG_NUMBERS"
  | "FIRST_LEG_NOT_MASS_START"
  | "MISSING_START_TIME"
  | "UNEXPECTED_START_TIME"
  | "INVALID_START_TIME";

/** Kontrollerar sträckorna: 2–20 sträckor numrerade 1..n, sträcka 1 masstart, tider där de behövs. */
export function relayLegRuleProblem(rules: readonly RelayLegRule[]): RelayLegRuleProblem | undefined {
  if (rules.length < 2) return "TOO_FEW_LEGS";
  if (rules.length > RELAY_MAX_LEGS) return "TOO_MANY_LEGS";
  const sorted = [...rules].sort((left, right) => left.leg - right.leg);
  if (sorted.some((rule, index) => rule.leg !== index + 1)) return "LEG_NUMBERS";
  if (sorted[0]!.startMethod !== "MASS_START") return "FIRST_LEG_NOT_MASS_START";
  for (const rule of sorted) {
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

/** Sträckans starttid givet föregående sträckas måltid (om den är känd). */
export function relayLegStartTime(rule: RelayLegRule, previousLegFinish: string | undefined): string | undefined {
  switch (rule.startMethod) {
    case "MASS_START": return rule.startTime;
    case "CHANGEOVER": return previousLegFinish;
    case "RESTART":
      if (rule.startTime === undefined) return previousLegFinish;
      return previousLegFinish !== undefined && ms(previousLegFinish) < ms(rule.startTime) ? previousLegFinish : rule.startTime;
  }
}

/** Startade sträckan i en omstart (och inte vid växling)? */
export function relayLegRestarted(rule: RelayLegRule, previousLegFinish: string | undefined): boolean {
  return rule.startMethod === "RESTART" && rule.startTime !== undefined &&
    (previousLegFinish === undefined || ms(previousLegFinish) >= ms(rule.startTime));
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
}

/** Underkända lagstatusar i den ordning de gäller när flera sträckor är underkända. */
const TEAM_FAILURE_ORDER: readonly StoredResultStatus[] = ["DSQ", "MP", "DNF", "DNS", "OOC", "NT"];

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
  const base = { completedLegs, ...(currentLeg === undefined ? {} : { currentLeg }) };
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
 * Placering bland godkända lag efter lagets tid; lika tid ger samma placering. Ordning:
 * placerade lag, lag som är ute (flest avklarade sträckor först), sedan underkända lag.
 */
export function rankRelayTeams(candidates: readonly RelayTeamRankingCandidate[]): RelayTeamRanking[] {
  const compareKey = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const ranked = candidates.filter((candidate) => candidate.result.status === "OK")
    .sort((left, right) => left.result.elapsedMs! - right.result.elapsedMs! || compareKey(left.key, right.key));
  const positions = new Map<string, { position: number; timeBehindMs: number }>();
  let previous: number | undefined;
  let position = 0;
  for (const [index, candidate] of ranked.entries()) {
    const elapsed = candidate.result.elapsedMs!;
    if (elapsed !== previous) position = index + 1;
    positions.set(candidate.key, { position, timeBehindMs: elapsed - ranked[0]!.result.elapsedMs! });
    previous = elapsed;
  }
  const group = (result: RelayTeamResult) => result.status === "OK" ? 0 : result.status === "RUNNING" ? 1 : 2;
  return [...candidates].sort((left, right) => {
    const difference = group(left.result) - group(right.result);
    if (difference !== 0) return difference;
    if (left.result.status === "OK") return left.result.elapsedMs! - right.result.elapsedMs! || compareKey(left.key, right.key);
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

/**
 * Lagets varianter per sträcka (gafflad stafettbana). En sträcka med bestämd variant får den;
 * övriga sträckor roteras över banans varianter med lagets ordningsnummer, så att lag i följd
 * springer varianterna i olika ordning och varje variant används lika ofta över lagen.
 */
export function relayTeamVariants(input: {
  readonly variantCodes: readonly string[];
  readonly legCount: number;
  /** Lagets ordningsnummer i klassen (0 för första laget). */
  readonly teamIndex: number;
  readonly fixedVariants?: ReadonlyMap<number, string>;
}): Map<number, string> {
  const variants = new Map<number, string>();
  const valid = new Set(input.variantCodes);
  const open: number[] = [];
  for (let leg = 1; leg <= input.legCount; leg += 1) {
    const fixed = input.fixedVariants?.get(leg);
    if (fixed !== undefined && valid.has(fixed)) variants.set(leg, fixed);
    else open.push(leg);
  }
  const count = input.variantCodes.length;
  if (count === 0) return variants;
  for (const [index, leg] of open.entries()) {
    variants.set(leg, input.variantCodes[((input.teamIndex % count) + index) % count]!);
  }
  return variants;
}
