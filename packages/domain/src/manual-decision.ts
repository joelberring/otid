import { createDidNotStartResult } from "./did-not-start";
import { createDidNotFinishResult } from "./did-not-finish";
import { createDisqualifiedResult, type DisqualifiableResult } from "./result-disqualification";
import { createManuallyApprovedResult } from "./result-approval";
import { createOutOfCompetitionResult } from "./out-of-competition";
import { createWithoutTimingResult } from "./without-timing";
import { correctPunchedStartTime, type PunchedStartTimeCorrectableResult } from "./manual-punch-start-time-correction";
import { rescoreRogaining } from "./rogaining";
import { withMaxTime } from "./max-time";
import type { EvaluationResult, ResultOutcome, RevisionCause } from "./types";

/**
 * Ett statusflöde (ADR-0173 beslut 1). Arrangörens beslut om en löpare och regeln för vilket resultat som gäller
 * räknas här, rent och utan I/O, ur löparens resultatrevisioner. Varje beslut och varje återtagande blir en ny
 * revision; inget skrivs över.
 */
export type ManualDecision =
  | { readonly kind: "DID_NOT_START" }
  | { readonly kind: "DID_NOT_FINISH" }
  | { readonly kind: "DISQUALIFIED"; readonly reason?: string | undefined }
  | { readonly kind: "OUT_OF_COMPETITION" }
  | { readonly kind: "WITHOUT_TIMING" }
  | { readonly kind: "APPROVE_MANUALLY" }
  | { readonly kind: "FINISH_TIME"; readonly finishTime: string }
  | { readonly kind: "START_TIME"; readonly startTime: string }
  | { readonly kind: "WITHDRAW" };
export type ManualDecisionKind = ManualDecision["kind"];
export const MANUAL_DECISION_KINDS = ["DID_NOT_START", "DID_NOT_FINISH", "DISQUALIFIED", "OUT_OF_COMPETITION",
  "WITHOUT_TIMING", "APPROVE_MANUALLY", "FINISH_TIME", "START_TIME", "WITHDRAW"] as const satisfies readonly ManualDecisionKind[];

/** Beslutet som styr löparens gällande resultat. */
export type GoverningDecision = "NONE" | "DNS" | "CHECKIN_DNS" | "DSQ" | "APPROVAL" | "DNF" | "OOC" | "NT" | "FINISH_TIME" | "START_TIME";

/** Varför ett beslut inte kan fattas just nu (samma koder som arbetsytans besked). */
export type ManualDecisionReadiness =
  | "READY" | "HAS_RESULT" | "NO_ACTIVE_RESULT" | "UNSUPPORTED_RESULT" | "STALE_RESULT" | "NOT_PUNCH_START"
  | "NO_ACTIVE_DECISION" | "INVALID_TIME" | "ACTIVE_DID_NOT_START" | "ACTIVE_DISQUALIFICATION" | "ACTIVE_APPROVAL"
  | "ACTIVE_DID_NOT_FINISH" | "ACTIVE_OUT_OF_COMPETITION" | "ACTIVE_WITHOUT_TIMING";

/** Det en revision behöver visa för regeln: ordning, orsak, utfall och om den bygger på en avläsning. */
export interface DecisionRevision {
  readonly revision: number;
  readonly cause: RevisionCause;
  readonly evaluation: ResultOutcome;
  readonly readoutId: string | null;
}

/** Beslut som ligger kvar ovanpå senare tekniska revisioner tills de tas bort. */
const OVERLAY_DECISIONS: Partial<Record<RevisionCause, GoverningDecision>> = {
  MANUAL_DISQUALIFICATION: "DSQ", MANUAL_RESULT_APPROVAL: "APPROVAL", MANUAL_DID_NOT_FINISH: "DNF",
  MANUAL_OUT_OF_COMPETITION: "OOC", MANUAL_WITHOUT_TIMING: "NT"
};
const OVERLAY_WITHDRAWALS: ReadonlySet<RevisionCause> = new Set<RevisionCause>(["MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL_WITHDRAWAL", "MANUAL_DID_NOT_FINISH_WITHDRAWAL", "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
  "MANUAL_WITHOUT_TIMING_WITHDRAWAL"]);
/** Beslut som är själva resultathuvudet: en senare avläsning ersätter dem. */
const HEAD_DECISIONS: Partial<Record<RevisionCause, GoverningDecision>> = {
  MANUAL_DID_NOT_START: "DNS", START_CHECKIN_DID_NOT_START: "CHECKIN_DNS",
  MANUAL_FINISH_TIME_CORRECTION: "FINISH_TIME", MANUAL_PUNCH_START_TIME_CORRECTION: "START_TIME"
};
/** Orsaken på återtagandets revision, per beslut som tas bort. */
const WITHDRAWAL_CAUSE: Partial<Record<GoverningDecision, RevisionCause>> = {
  DNS: "MANUAL_DID_NOT_START_WITHDRAWAL", DSQ: "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  APPROVAL: "MANUAL_RESULT_APPROVAL_WITHDRAWAL", DNF: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  OOC: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", NT: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  FINISH_TIME: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", START_TIME: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"
};
/** Orsaker som bedömer en avläsning direkt och därför kan vara underlag för ett nytt beslut. */
export const TECHNICAL_CAUSES: ReadonlySet<RevisionCause> = new Set<RevisionCause>(["CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "UNKNOWN_READOUT_RESOLUTION"]);
/** Orsaker som är ett beslut eller ett återtagande (de enda som påverkar vilket resultat som gäller). */
export const DECISION_CAUSES: readonly RevisionCause[] = [...Object.keys(OVERLAY_DECISIONS), ...OVERLAY_WITHDRAWALS,
  ...Object.keys(HEAD_DECISIONS), "MANUAL_DID_NOT_START_WITHDRAWAL", "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL",
  "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"] as RevisionCause[];

export const MANUAL_DECISION_ENGINE_VERSIONS: Record<Exclude<ManualDecisionKind, "WITHDRAW">, string> = {
  DID_NOT_START: "did-not-start-v1", DID_NOT_FINISH: "did-not-finish-v1", DISQUALIFIED: "manual-disqualification-v1",
  OUT_OF_COMPETITION: "out-of-competition-v1", WITHOUT_TIMING: "without-timing-v1",
  APPROVE_MANUALLY: "manual-result-approval-v1", FINISH_TIME: "manual-finish-time-correction-v1",
  START_TIME: "manual-punch-start-time-correction-v1"
};
export const MANUAL_WITHDRAWAL_ENGINE_VERSION = "manual-decision-withdrawal-v1";

export interface ResultHistory<T extends DecisionRevision> {
  /** Senaste revisionen, eller null utan revisioner. */
  readonly head: T | null;
  /** Revisionen som gäller (ett kvarliggande beslut eller huvudet), eller null utan gällande resultat. */
  readonly effective: T | null;
  readonly governing: GoverningDecision;
  /** Ej start har tagits bort och inget resultat finns under. */
  readonly noActiveResult: boolean;
  /** Det som ett återtagande återställer; null betyder att inget resultat finns kvar (ej start tas bort). */
  readonly restore: T | null;
}

/**
 * Regeln för vilket resultat som gäller, ur alla revisioner i stigande ordning. Disk, godkännande, brutit, utom
 * tävlan och utan tidtagning ligger kvar ovanpå senare avläsningar tills de tas bort. Ej start och rättad tid är
 * själva huvudet. Ett återtagande återställer underlaget, utan omräkning.
 */
export function resolveResultHistory<T extends DecisionRevision>(revisions: readonly T[]): ResultHistory<T> {
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  const bases: T[] = [];
  let overlay: T | null = null;
  for (const revision of ordered) {
    if (OVERLAY_DECISIONS[revision.cause]) { overlay = revision; continue; }
    if (OVERLAY_WITHDRAWALS.has(revision.cause)) overlay = null;
    if (revision.cause === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" ||
      revision.cause === "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" || revision.cause === "MANUAL_DID_NOT_START_WITHDRAWAL") {
      // Återtagandet ersätter beslutet i stapeln; innehållet är det som låg under.
      bases.pop();
    }
    bases.push(revision);
  }
  const head = ordered.at(-1) ?? null;
  const base = bases.at(-1) ?? null;
  if (overlay) return { head, effective: overlay, governing: OVERLAY_DECISIONS[overlay.cause]!, noActiveResult: false, restore: base };
  if (!base) return { head, effective: null, governing: "NONE", noActiveResult: false, restore: null };
  if (base.cause === "MANUAL_DID_NOT_START_WITHDRAWAL") {
    return { head, effective: null, governing: "NONE", noActiveResult: true, restore: null };
  }
  const governing = HEAD_DECISIONS[base.cause] ?? "NONE";
  return { head, effective: base, governing, noActiveResult: false, restore: governing === "NONE" ? null : bases.at(-2) ?? null };
}

/** Det som avgör om ett beslut kan fattas, utöver revisionerna. */
export interface ManualDecisionContext {
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
  readonly startRule: "FIXED" | "PUNCH";
  /** Bygger revisionen på löparens nuvarande underlag (ADR-0169 beslut 1)? */
  readonly isCurrent: (revision: DecisionRevision) => boolean;
  /** Avläsningens startstämpling för huvudets avläsning (rättad starttid). */
  readonly headStartPunchedAt?: string | null;
  /** Klassens maxtid (PLAN.md steg 25): en rättad tid avgör om resultatet är godkänt eller över maxtid. */
  readonly maxTimeMinutes?: number | null | undefined;
}

export type ManualDecisionOutcome<T extends DecisionRevision = DecisionRevision> =
  | { readonly ok: true; readonly cause: RevisionCause; readonly outcome: ResultOutcome; readonly engineVersion: string;
    readonly source: T | null }
  | { readonly ok: false; readonly readiness: Exclude<ManualDecisionReadiness, "READY"> };

const ACTIVE_READINESS: Partial<Record<GoverningDecision, Exclude<ManualDecisionReadiness, "READY">>> = {
  DNS: "ACTIVE_DID_NOT_START", CHECKIN_DNS: "ACTIVE_DID_NOT_START", DSQ: "ACTIVE_DISQUALIFICATION",
  APPROVAL: "ACTIVE_APPROVAL", DNF: "ACTIVE_DID_NOT_FINISH", OOC: "ACTIVE_OUT_OF_COMPETITION", NT: "ACTIVE_WITHOUT_TIMING"
};

function fail(readiness: Exclude<ManualDecisionReadiness, "READY">): { ok: false; readiness: Exclude<ManualDecisionReadiness, "READY"> } {
  return { ok: false, readiness };
}

/** Ett tekniskt OK/MP-huvud för rätt deltagare, klass och bana. */
function technicalHead<T extends DecisionRevision>(history: ResultHistory<T>, context: ManualDecisionContext):
  { revision: T; outcome: EvaluationResult } | Exclude<ManualDecisionReadiness, "READY"> {
  if (history.governing !== "NONE") {
    return ACTIVE_READINESS[history.governing] ?? "UNSUPPORTED_RESULT";
  }
  const head = history.head;
  if (!head || history.noActiveResult) return "NO_ACTIVE_RESULT";
  const outcome = head.evaluation as EvaluationResult;
  if (!TECHNICAL_CAUSES.has(head.cause) || head.readoutId === null ||
    (outcome.status !== "OK" && outcome.status !== "OVERTIME" && outcome.status !== "MP")) {
    return "UNSUPPORTED_RESULT";
  }
  if (outcome.entryId !== context.entryId || outcome.classId !== context.classId ||
    outcome.courseVersionId !== context.courseVersionId || !context.isCurrent(head)) return "STALE_RESULT";
  return { revision: head, outcome };
}

function timed(outcome: EvaluationResult): outcome is EvaluationResult & { startTime: string; finishTime: string; elapsedMs: number } {
  return typeof outcome.startTime === "string" && typeof outcome.finishTime === "string" &&
    typeof outcome.elapsedMs === "number" && Number.isSafeInteger(outcome.elapsedMs);
}

/** Senaste matchade kontrollens löptid, eller null utan sträcktider. */
export function latestMatchedSplitElapsedMs(outcome: EvaluationResult): number | null {
  if (outcome.splits.length === 0) return null;
  const elapsed = Math.max(...outcome.splits.map((split) => split.elapsedMs));
  return Number.isSafeInteger(elapsed) ? elapsed : null;
}

function guarded<T>(build: () => T): T | undefined {
  try { return build(); } catch { return undefined; }
}

/**
 * Prövar ett beslut mot löparens revisioner och ger den nya revisionens innehåll, eller koden för varför det inte
 * går. Anroparen har låst löparen och kontrollerat att huvudet är det arrangören såg.
 */
export function applyManualDecision<T extends DecisionRevision>(history: ResultHistory<T>, decision: ManualDecision,
  context: ManualDecisionContext): ManualDecisionOutcome<T> {
  const engineVersion = decision.kind === "WITHDRAW" ? MANUAL_WITHDRAWAL_ENGINE_VERSION : MANUAL_DECISION_ENGINE_VERSIONS[decision.kind];
  const done = (cause: RevisionCause, outcome: ResultOutcome | undefined, source: T | null): ManualDecisionOutcome<T> =>
    outcome ? { ok: true, cause, outcome, engineVersion, source } : fail("UNSUPPORTED_RESULT");
  switch (decision.kind) {
    case "DID_NOT_START":
      if (history.head !== null) return fail("HAS_RESULT");
      return done("MANUAL_DID_NOT_START", createDidNotStartResult(context), null);
    case "WITHDRAW": {
      const cause = WITHDRAWAL_CAUSE[history.governing];
      if (!cause || !history.effective) return fail("NO_ACTIVE_DECISION");
      if (history.governing === "DNS") {
        // Ej start utan resultat under: löparen räknas som anmäld igen (ingen gällande revision).
        return done(cause, history.restore?.evaluation ?? history.effective.evaluation, history.restore);
      }
      if (!history.restore) return fail("NO_ACTIVE_RESULT");
      if (!context.isCurrent(history.restore)) return fail("STALE_RESULT");
      return done(cause, history.restore.evaluation, history.restore);
    }
    default: break;
  }
  const head = technicalHead(history, context);
  if (typeof head === "string") return fail(head);
  const { revision, outcome } = head;
  switch (decision.kind) {
    case "DISQUALIFIED":
      return done("MANUAL_DISQUALIFICATION", guarded(() => createDisqualifiedResult(outcome as DisqualifiableResult)), revision);
    case "APPROVE_MANUALLY":
      if (outcome.status !== "MP") return fail("UNSUPPORTED_RESULT");
      return done("MANUAL_RESULT_APPROVAL", guarded(() => createManuallyApprovedResult(outcome)), revision);
    case "DID_NOT_FINISH":
      return done("MANUAL_DID_NOT_FINISH", guarded(() => createDidNotFinishResult(outcome)), revision);
    case "OUT_OF_COMPETITION":
      return done("MANUAL_OUT_OF_COMPETITION", guarded(() => createOutOfCompetitionResult(outcome)), revision);
    case "WITHOUT_TIMING":
      if (outcome.status !== "OK" || outcome.reason !== "COMPLETE") return fail("UNSUPPORTED_RESULT");
      return done("MANUAL_WITHOUT_TIMING", guarded(() => createWithoutTimingResult(outcome)), revision);
    case "FINISH_TIME": {
      if (!timed(outcome)) return fail("UNSUPPORTED_RESULT");
      const finishMs = Date.parse(decision.finishTime);
      const elapsedMs = finishMs - Date.parse(outcome.startTime);
      const lastSplit = latestMatchedSplitElapsedMs(outcome);
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0 || finishMs === Date.parse(outcome.finishTime) ||
        (lastSplit !== null && elapsedMs < lastSplit)) return fail("INVALID_TIME");
      // Rogaining: ny löptid ger nytt straff (ADR-0170 beslut 5).
      // Maxtid (PLAN.md steg 25): den rättade löptiden avgör om resultatet är godkänt eller över maxtid.
      return done("MANUAL_FINISH_TIME_CORRECTION", withMaxTime({ ...outcome, finishTime: new Date(finishMs).toISOString(), elapsedMs,
        ...(outcome.rogaining ? { rogaining: rescoreRogaining(outcome.rogaining, elapsedMs) } : {}) },
      outcome.rogaining ? undefined : context.maxTimeMinutes), revision);
    }
    case "START_TIME": {
      if (context.startRule !== "PUNCH") return fail("NOT_PUNCH_START");
      if (!timed(outcome) || !context.headStartPunchedAt ||
        Date.parse(context.headStartPunchedAt) !== Date.parse(outcome.startTime)) return fail("UNSUPPORTED_RESULT");
      const startMs = Date.parse(decision.startTime);
      const corrected = Number.isFinite(startMs)
        ? guarded(() => correctPunchedStartTime(outcome as PunchedStartTimeCorrectableResult, new Date(startMs).toISOString()))
        : undefined;
      return corrected ? done("MANUAL_PUNCH_START_TIME_CORRECTION",
        withMaxTime(corrected, corrected.rogaining ? undefined : context.maxTimeMinutes), revision) : fail("INVALID_TIME");
    }
  }
}

/** Varje besluts beredskap för arbetsytans meny (samma prövning som när beslutet sparas). */
export function manualDecisionReadiness<T extends DecisionRevision>(history: ResultHistory<T>, context: ManualDecisionContext):
  Record<Exclude<ManualDecisionKind, "FINISH_TIME" | "START_TIME">, ManualDecisionReadiness> & { FINISH_TIME: ManualDecisionReadiness;
    START_TIME: ManualDecisionReadiness } {
  const readiness = (decision: ManualDecision): ManualDecisionReadiness => {
    const result = applyManualDecision(history, decision, context);
    return result.ok || result.readiness === "INVALID_TIME" ? "READY" : result.readiness;
  };
  // Tidsrättningarna prövas utan ny tid; bara en ogiltig tid skiljer dem från "READY".
  const probe = "1970-01-01T00:00:00.000Z";
  return { DID_NOT_START: readiness({ kind: "DID_NOT_START" }), DID_NOT_FINISH: readiness({ kind: "DID_NOT_FINISH" }),
    DISQUALIFIED: readiness({ kind: "DISQUALIFIED" }), OUT_OF_COMPETITION: readiness({ kind: "OUT_OF_COMPETITION" }),
    WITHOUT_TIMING: readiness({ kind: "WITHOUT_TIMING" }), APPROVE_MANUALLY: readiness({ kind: "APPROVE_MANUALLY" }),
    FINISH_TIME: readiness({ kind: "FINISH_TIME", finishTime: probe }), START_TIME: readiness({ kind: "START_TIME", startTime: probe }),
    WITHDRAW: readiness({ kind: "WITHDRAW" }) };
}
