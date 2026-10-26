import type { RelayLegOutcome } from "./relay";
import type { StoredResultStatus } from "./result-status-order";
import type { EvaluationReadout } from "./types";

/**
 * Steg 48 (ADR-0174 beslut 6–7): flera löpare per sträcka och teamsprint. Rena funktioner.
 *
 * Parallell sträcka (ungdomsstafett): 2–4 löpare i samma lag springer sträckan samtidigt, var och en med egen bricka.
 * - Växlar när: `FIRST` (första i mål) eller `LAST` (sista i mål: när alla löpare har ett resultat, den senaste måltiden
 *   bland dem som gått i mål).
 * - Godkänt när: `ALL` (alla är godkända) eller `ANY` (minst en är godkänd).
 * Sträckans tid för laget är tiden från sträckans start till växlingen.
 */
export type RelayChangeoverRule = "FIRST" | "LAST";
export type RelayApprovalRule = "ALL" | "ANY";

export const RELAY_MAX_PARALLEL_RUNNERS = 4;

export interface RelayParallelRunner {
  /** Löparens resultat; saknas = ute. */
  readonly status?: StoredResultStatus;
  /** Löparens måltid (även felstämplad); saknas = inte i mål. */
  readonly finishTime?: string;
}

const FAILURE_ORDER: readonly StoredResultStatus[] = ["DSQ", "MP", "DNF", "DNS", "OOC", "NT", "OVERTIME"];

function worst(statuses: readonly StoredResultStatus[]): StoredResultStatus | undefined {
  return FAILURE_ORDER.find((status) => statuses.includes(status));
}

/** Lagets växling ut från sträckan. En löpare utan resultat räknas som ute. */
export function relayParallelChangeover(rule: RelayChangeoverRule, runners: readonly RelayParallelRunner[]): string | undefined {
  const finishes = runners.flatMap((runner) => runner.finishTime !== undefined && Number.isFinite(Date.parse(runner.finishTime))
    ? [runner.finishTime] : []);
  if (finishes.length === 0) return undefined;
  const sorted = [...finishes].sort((left, right) => Date.parse(left) - Date.parse(right));
  if (rule === "FIRST") return sorted[0];
  if (runners.some((runner) => runner.status === undefined)) return undefined;
  return sorted.at(-1);
}

/**
 * Sträckans resultat för laget. Godkänt kräver en känd växling och start (sträcktiden = växling − start). Vid `ANY` räcker
 * en godkänd löpare; är ingen godkänd när alla har resultat gäller den värsta statusen. Vid `ALL` gör en underkänd löpare
 * sträckan underkänd direkt.
 */
export function relayParallelLegOutcome(input: {
  readonly leg: number;
  readonly changeover: RelayChangeoverRule;
  readonly approval: RelayApprovalRule;
  readonly legStart?: string;
  readonly restarted?: boolean;
  readonly runners: readonly RelayParallelRunner[];
}): RelayLegOutcome {
  const base = { leg: input.leg, ...(input.restarted ? { restarted: true } : {}) };
  const statuses = input.runners.flatMap((runner) => runner.status === undefined ? [] : [runner.status]);
  const allDone = statuses.length === input.runners.length;
  const changeover = relayParallelChangeover(input.changeover, input.runners);
  const elapsed = changeover !== undefined && input.legStart !== undefined ? Date.parse(changeover) - Date.parse(input.legStart) : undefined;
  const okTimed = (): RelayLegOutcome => elapsed !== undefined && elapsed >= 0 ? { ...base, status: "OK", elapsedMs: elapsed } : base;
  if (input.approval === "ALL") {
    const failure = worst(statuses);
    if (failure) return { ...base, status: failure };
    return allDone ? okTimed() : base;
  }
  if (statuses.includes("OK")) return okTimed();
  if (!allDone) return base;
  return { ...base, status: worst(statuses) ?? "MP" };
}

/**
 * Teamsprint: en löpare springer flera sträckor med samma bricka. Brickan läses ut efter löparens sista sträcka och delas
 * vid växlingsstämplingarna: del j slutar vid löparens j:e växlingsstämpling (eller vid målstämplingen om delen är lagets
 * sista sträcka). Stämplingar vid växlingskontrollen inom `DOUBLE_PUNCH_MS` räknas som en.
 */
export interface TeamSprintPart {
  /** Delens nummer bland löparens sträckor (1 = löparens första sträcka). */
  readonly part: number;
  /** Antal sträckor löparen springer. */
  readonly parts: number;
  /** Växlingskontrollens kod. */
  readonly changeoverCode: number;
  /** Delen är lagets sista sträcka och slutar vid målstämplingen. */
  readonly endsAtFinish: boolean;
}

const DOUBLE_PUNCH_MS = 60_000;

/** Växlingsstämplingarna på brickan, i tidsordning, med dubbelstämplingar borttagna. */
export function teamSprintChangeovers(readout: EvaluationReadout, changeoverCode: number): string[] {
  const times = readout.punches.filter((punch) => punch.code === changeoverCode).map((punch) => punch.punchedAt)
    .filter((time) => Number.isFinite(Date.parse(time))).sort((left, right) => Date.parse(left) - Date.parse(right));
  const result: string[] = [];
  for (const time of times) {
    if (result.length > 0 && Date.parse(time) - Date.parse(result.at(-1)!) < DOUBLE_PUNCH_MS) continue;
    result.push(time);
  }
  return result;
}

/** Hur många växlingsstämplingar löparens bricka behöver och har. */
export function teamSprintChangeoverProblem(readout: EvaluationReadout, part: TeamSprintPart):
  { readonly needed: number; readonly found: number } | undefined {
  const needed = part.parts - (part.endsAtFinish ? 1 : 0);
  const found = teamSprintChangeovers(readout, part.changeoverCode).length;
  return found < needed ? { needed, found } : undefined;
}

/**
 * Löparens del av avläsningen för en sträcka: stämplingarna mellan föregående och denna dels växlingsstämpling och målet
 * vid växlingsstämplingen (eller målstämplingen). Saknas växlingsstämplingen som avslutar delen får delen inget mål
 * (felstämplad, saknat mål) – med `teamSprintChangeoverProblem` som tydligt besked.
 */
export function teamSprintReadoutPart(readout: EvaluationReadout, part: TeamSprintPart): EvaluationReadout {
  const changeovers = teamSprintChangeovers(readout, part.changeoverCode);
  const fromMs = part.part === 1 ? -Infinity : changeovers[part.part - 2] !== undefined ? Date.parse(changeovers[part.part - 2]!) : Infinity;
  const end = part.part === part.parts && part.endsAtFinish ? readout.finishPunchedAt : changeovers[part.part - 1];
  const toMs = end !== undefined ? Date.parse(end) : Infinity;
  const punches = readout.punches.filter((punch) => {
    const ms = Date.parse(punch.punchedAt);
    return punch.code !== part.changeoverCode && ms > fromMs && ms <= toMs;
  });
  // Delen har ingen egen startstämpling (sträckans start gäller) och mål bara vid växlingen eller lagets mål.
  return { cardNumber: readout.cardNumber, punches,
    ...(readout.readAt !== undefined ? { readAt: readout.readAt } : {}),
    ...(readout.checkPunchedAt !== undefined ? { checkPunchedAt: readout.checkPunchedAt } : {}),
    ...(readout.clearPunchedAt !== undefined ? { clearPunchedAt: readout.clearPunchedAt } : {}),
    ...(end !== undefined && fromMs !== Infinity ? { finishPunchedAt: end } : {}) };
}
