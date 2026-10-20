import { createDidNotStartResult } from "./did-not-start";
import { createDisqualifiedResult, type DisqualifiableResult } from "./result-disqualification";
import { createManuallyApprovedResult } from "./result-approval";
import { createOutOfCompetitionResult } from "./out-of-competition";
import { createWithoutTimingResult } from "./without-timing";
import { correctPunchedStartTime, type PunchedStartTimeCorrectableResult } from "./manual-punch-start-time-correction";
import { rescoreRogaining } from "./rogaining";
import { withMaxTime } from "./max-time";
import { approveMissingControls, manualTimeOutcome, type ManualTimeContext, type ManualTimeInput } from "./manual-time";
import type { EvaluationResult, ResultOutcome, RevisionCause } from "./types";

/**
 * Ett statusflöde (ADR-0173 beslut 1). Arrangörens beslut om en löpare och regeln för vilket resultat som gäller
 * räknas här, rent och utan I/O, ur löparens resultatrevisioner. Varje beslut och varje återtagande blir en ny
 * revision; inget skrivs över.
 */
export type ManualDecision =
  | { readonly kind: "DID_NOT_START" }
  | { readonly kind: "DID_NOT_FINISH"; readonly note?: string | undefined }
  | { readonly kind: "DISQUALIFIED"; readonly reason?: string | undefined }
  | { readonly kind: "OUT_OF_COMPETITION" }
  | { readonly kind: "WITHOUT_TIMING" }
  | { readonly kind: "APPROVE_MANUALLY"; readonly note?: string | undefined }
  | { readonly kind: "FINISH_TIME"; readonly finishTime: string }
  | { readonly kind: "START_TIME"; readonly startTime: string }
  /** Steg 31: manuell tid, med eller utan avläsning, med arrangörens orsak. */
  | ({ readonly kind: "MANUAL_TIME"; readonly note: string } & ManualTimeInput)
  /** Steg 31: godkänn valda saknade kontroller, med arrangörens orsak. */
  | { readonly kind: "APPROVE_CONTROLS"; readonly controls: readonly number[]; readonly note: string }
  | { readonly kind: "WITHDRAW" };
export type ManualDecisionKind = ManualDecision["kind"];
export const MANUAL_DECISION_KINDS = ["DID_NOT_START", "DID_NOT_FINISH", "DISQUALIFIED", "OUT_OF_COMPETITION",
  "WITHOUT_TIMING", "APPROVE_MANUALLY", "FINISH_TIME", "START_TIME", "MANUAL_TIME", "APPROVE_CONTROLS",
  "WITHDRAW"] as const satisfies readonly ManualDecisionKind[];

/** Beslutet som styr löparens gällande resultat. */
export type GoverningDecision = "NONE" | "DNS" | "CHECKIN_DNS" | "DSQ" | "APPROVAL" | "DNF" | "OOC" | "NT" | "FINISH_TIME" |
  "START_TIME" | "MANUAL_TIME" | "CONTROL_APPROVAL";

/** Varför ett beslut inte kan fattas just nu (samma koder som arbetsytans besked). */
export type ManualDecisionReadiness =
  | "READY" | "HAS_RESULT" | "NO_ACTIVE_RESULT" | "UNSUPPORTED_RESULT" | "STALE_RESULT" | "NOT_PUNCH_START"
  | "NO_ACTIVE_DECISION" | "INVALID_TIME" | "INVALID_CONTROL" | "ACTIVE_DID_NOT_START" | "ACTIVE_DISQUALIFICATION"
  | "ACTIVE_APPROVAL" | "ACTIVE_DID_NOT_FINISH" | "ACTIVE_OUT_OF_COMPETITION" | "ACTIVE_WITHOUT_TIMING" | "ACTIVE_MANUAL_TIME";

/** Det en revision behöver visa för regeln: ordning, orsak, utfall och om den bygger på en avläsning. */
export interface DecisionRevision {
  readonly revision: number;
  readonly cause: RevisionCause;
  readonly evaluation: ResultOutcome;
  readonly readoutId: string | null;
}

/**
 * Beslut som ligger kvar ovanpå senare tekniska revisioner (ny avläsning, omräkning) tills de tas bort. Steg 31: även
 * rättad mål- och starttid, manuell tid och godkända kontroller ligger kvar. Beslut kan ligga på varandra (godkänn
 * fler kontroller); ett återtagande tar bort det översta.
 */
const OVERLAY_DECISIONS: Partial<Record<RevisionCause, GoverningDecision>> = {
  MANUAL_DISQUALIFICATION: "DSQ", MANUAL_RESULT_APPROVAL: "APPROVAL", MANUAL_DID_NOT_FINISH: "DNF",
  MANUAL_OUT_OF_COMPETITION: "OOC", MANUAL_WITHOUT_TIMING: "NT", MANUAL_FINISH_TIME_CORRECTION: "FINISH_TIME",
  MANUAL_PUNCH_START_TIME_CORRECTION: "START_TIME", MANUAL_TIME: "MANUAL_TIME", MANUAL_CONTROL_APPROVAL: "CONTROL_APPROVAL"
};
const OVERLAY_WITHDRAWALS: ReadonlySet<RevisionCause> = new Set<RevisionCause>(["MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL_WITHDRAWAL", "MANUAL_DID_NOT_FINISH_WITHDRAWAL", "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
  "MANUAL_WITHOUT_TIMING_WITHDRAWAL", "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL",
  "MANUAL_TIME_WITHDRAWAL", "MANUAL_CONTROL_APPROVAL_WITHDRAWAL", "MANUAL_RESULT_REMOVED"]);
/** Beslut som är själva resultathuvudet: en senare avläsning ersätter dem. */
const HEAD_DECISIONS: Partial<Record<RevisionCause, GoverningDecision>> = {
  MANUAL_DID_NOT_START: "DNS", START_CHECKIN_DID_NOT_START: "CHECKIN_DNS"
};
/** Orsaken på återtagandets revision, per beslut som tas bort. */
const WITHDRAWAL_CAUSE: Partial<Record<GoverningDecision, RevisionCause>> = {
  DNS: "MANUAL_DID_NOT_START_WITHDRAWAL", DSQ: "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  APPROVAL: "MANUAL_RESULT_APPROVAL_WITHDRAWAL", DNF: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  OOC: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", NT: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  FINISH_TIME: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", START_TIME: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL",
  MANUAL_TIME: "MANUAL_TIME_WITHDRAWAL", CONTROL_APPROVAL: "MANUAL_CONTROL_APPROVAL_WITHDRAWAL"
};
/** Ingen avläsning eller ej start: resultatet är borttaget (ej start borttaget, manuellt beslut utan avläsning borttaget). */
const NO_RESULT_BASES: ReadonlySet<RevisionCause> = new Set<RevisionCause>(["MANUAL_DID_NOT_START_WITHDRAWAL", "MANUAL_RESULT_REMOVED"]);
/** Orsaker som bedömer en avläsning direkt och därför kan vara underlag för ett nytt beslut. */
export const TECHNICAL_CAUSES: ReadonlySet<RevisionCause> = new Set<RevisionCause>(["CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION", "UNKNOWN_READOUT_RESOLUTION", "READOUT_REREAD"]);
/** Orsaker som är ett beslut eller ett återtagande (de enda som påverkar vilket resultat som gäller). */
export const DECISION_CAUSES: readonly RevisionCause[] = [...Object.keys(OVERLAY_DECISIONS), ...OVERLAY_WITHDRAWALS,
  ...Object.keys(HEAD_DECISIONS), "MANUAL_DID_NOT_START_WITHDRAWAL"] as RevisionCause[];
/** Beslut som lägger en manuell tid ovanpå avläsningen (deltagarkortet: "Manuell tid"). */
export const MANUAL_TIME_GOVERNING: ReadonlySet<GoverningDecision> = new Set<GoverningDecision>(["FINISH_TIME", "START_TIME", "MANUAL_TIME"]);

export const MANUAL_DECISION_ENGINE_VERSIONS: Record<Exclude<ManualDecisionKind, "WITHDRAW">, string> = {
  DID_NOT_START: "did-not-start-v1", DID_NOT_FINISH: "did-not-finish-v1", DISQUALIFIED: "manual-disqualification-v1",
  OUT_OF_COMPETITION: "out-of-competition-v1", WITHOUT_TIMING: "without-timing-v1",
  APPROVE_MANUALLY: "manual-result-approval-v1", FINISH_TIME: "manual-finish-time-correction-v1",
  START_TIME: "manual-punch-start-time-correction-v1", MANUAL_TIME: "manual-time-v1", APPROVE_CONTROLS: "manual-control-approval-v1"
};
export const MANUAL_WITHDRAWAL_ENGINE_VERSION = "manual-decision-withdrawal-v1";

export interface ResultHistory<T extends DecisionRevision> {
  /** Senaste revisionen, eller null utan revisioner. */
  readonly head: T | null;
  /** Revisionen som gäller (ett kvarliggande beslut eller huvudet), eller null utan gällande resultat. */
  readonly effective: T | null;
  readonly governing: GoverningDecision;
  /** Ej start eller ett manuellt resultat utan avläsning har tagits bort och inget resultat finns under. */
  readonly noActiveResult: boolean;
  /** Det som ett återtagande återställer; null betyder att inget resultat finns kvar. */
  readonly restore: T | null;
  /** Senaste tekniska bedömningen av en avläsning som ett nytt beslut kan bygga på (under eventuella beslut). */
  readonly technical: T | null;
}

/** Senaste tekniska revision i stapeln under besluten; ett återtagande hoppas över (det återställer den). */
function latestTechnical<T extends DecisionRevision>(bases: readonly T[]): T | null {
  for (let index = bases.length - 1; index >= 0; index -= 1) {
    const revision = bases[index]!;
    if (OVERLAY_WITHDRAWALS.has(revision.cause) && revision.cause !== "MANUAL_RESULT_REMOVED") continue;
    return TECHNICAL_CAUSES.has(revision.cause) && revision.readoutId !== null ? revision : null;
  }
  return null;
}

/**
 * Regeln för vilket resultat som gäller, ur alla revisioner i stigande ordning. Disk, godkännande, brutit, utom
 * tävlan, utan tidtagning och (steg 31) rättad eller manuell tid och godkända kontroller ligger kvar ovanpå senare
 * avläsningar tills de tas bort. Ej start är själva huvudet. Ett återtagande återställer underlaget, utan omräkning.
 */
export function resolveResultHistory<T extends DecisionRevision>(revisions: readonly T[]): ResultHistory<T> {
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  const bases: T[] = [];
  const overlays: T[] = [];
  for (const revision of ordered) {
    if (OVERLAY_DECISIONS[revision.cause]) { overlays.push(revision); continue; }
    if (OVERLAY_WITHDRAWALS.has(revision.cause)) overlays.pop();
    // Ej start borttaget ersätter beslutet i stapeln; innehållet är det som låg under.
    else if (revision.cause === "MANUAL_DID_NOT_START_WITHDRAWAL") bases.pop();
    bases.push(revision);
  }
  const head = ordered.at(-1) ?? null;
  const base = bases.at(-1) ?? null;
  const noResultBase = base !== null && NO_RESULT_BASES.has(base.cause);
  const technical = latestTechnical(bases);
  const overlay = overlays.at(-1);
  if (overlay) {
    return { head, effective: overlay, governing: OVERLAY_DECISIONS[overlay.cause]!, noActiveResult: false,
      restore: overlays.at(-2) ?? (noResultBase ? null : base), technical };
  }
  if (!base) return { head, effective: null, governing: "NONE", noActiveResult: false, restore: null, technical };
  if (noResultBase) return { head, effective: null, governing: "NONE", noActiveResult: true, restore: null, technical };
  const governing = HEAD_DECISIONS[base.cause] ?? "NONE";
  return { head, effective: base, governing, noActiveResult: false, restore: governing === "NONE" ? null : bases.at(-2) ?? null,
    technical };
}

/** Det som avgör om ett beslut kan fattas, utöver revisionerna. */
export interface ManualDecisionContext {
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
  readonly startRule: "FIXED" | "PUNCH";
  /** Bygger revisionen på löparens nuvarande underlag (ADR-0169 beslut 1)? */
  readonly isCurrent: (revision: DecisionRevision) => boolean;
  /** Avläsningens startstämpling för den tekniska revisionens avläsning (rättad starttid). */
  readonly headStartPunchedAt?: string | null;
  /** Klassens maxtid (PLAN.md steg 25): en rättad tid avgör om resultatet är godkänt eller över maxtid. */
  readonly maxTimeMinutes?: number | null | undefined;
  /** Steg 31: löparens kända start för en manuell tid (lottad tid, annars startstämplingen i senaste avläsningen). */
  readonly knownStartTime?: string | null | undefined;
  /** Steg 31: senaste avläsningen bedömd med manuella tider (resultatmotorn); saknas utan avläsning. */
  readonly evaluateWithTimes?: ManualTimeContext["evaluateWithTimes"];
}

export type ManualDecisionOutcome<T extends DecisionRevision = DecisionRevision> =
  | { readonly ok: true; readonly cause: RevisionCause; readonly outcome: ResultOutcome; readonly engineVersion: string;
    readonly source: T | null }
  | { readonly ok: false; readonly readiness: Exclude<ManualDecisionReadiness, "READY"> };

const ACTIVE_READINESS: Partial<Record<GoverningDecision, Exclude<ManualDecisionReadiness, "READY">>> = {
  DNS: "ACTIVE_DID_NOT_START", CHECKIN_DNS: "ACTIVE_DID_NOT_START", DSQ: "ACTIVE_DISQUALIFICATION",
  APPROVAL: "ACTIVE_APPROVAL", DNF: "ACTIVE_DID_NOT_FINISH", OOC: "ACTIVE_OUT_OF_COMPETITION", NT: "ACTIVE_WITHOUT_TIMING",
  FINISH_TIME: "ACTIVE_MANUAL_TIME", START_TIME: "ACTIVE_MANUAL_TIME", MANUAL_TIME: "ACTIVE_MANUAL_TIME",
  CONTROL_APPROVAL: "ACTIVE_APPROVAL"
};

function fail(readiness: Exclude<ManualDecisionReadiness, "READY">): { ok: false; readiness: Exclude<ManualDecisionReadiness, "READY"> } {
  return { ok: false, readiness };
}

/** Den tekniska OK/MP-bedömningen för rätt deltagare, klass och bana som ett nytt beslut bygger på. */
function technicalHead<T extends DecisionRevision>(history: ResultHistory<T>, context: ManualDecisionContext):
  { revision: T; outcome: EvaluationResult } | Exclude<ManualDecisionReadiness, "READY"> {
  if (history.governing !== "NONE") {
    return ACTIVE_READINESS[history.governing] ?? "UNSUPPORTED_RESULT";
  }
  const technical = history.technical;
  if (!technical || history.noActiveResult) return "NO_ACTIVE_RESULT";
  // En senare revision än den tekniska som inte är ett återtagande (t.ex. flytt till kortare bana) går inte att bygga på.
  if (history.effective && history.effective !== technical && !OVERLAY_WITHDRAWALS.has(history.effective.cause)) {
    return "UNSUPPORTED_RESULT";
  }
  const outcome = technical.evaluation as EvaluationResult;
  if (outcome.status !== "OK" && outcome.status !== "OVERTIME" && outcome.status !== "MP") return "UNSUPPORTED_RESULT";
  if (outcome.entryId !== context.entryId || outcome.classId !== context.classId ||
    outcome.courseVersionId !== context.courseVersionId || !context.isCurrent(technical)) return "STALE_RESULT";
  return { revision: technical, outcome };
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

/** Utfallet när ett manuellt resultat utan avläsning tas bort: ingen tid och inga kontroller (som "start saknas"). */
function removedOutcome(context: ManualDecisionContext): EvaluationResult {
  return { status: "MP", reason: "MISSING_START", entryId: context.entryId, classId: context.classId,
    courseVersionId: context.courseVersionId, missingControls: [], extraPunches: [], splits: [] };
}

/**
 * Felstämplingen som "Godkänn valda kontroller" utgår från: den tekniska bedömningen, eller ett tidigare delvis
 * godkännande som fortfarande är felstämplat.
 */
export function controlApprovalSource<T extends DecisionRevision>(history: ResultHistory<T>, context: ManualDecisionContext):
  { revision: T; outcome: EvaluationResult } | Exclude<ManualDecisionReadiness, "READY"> {
  if (history.governing === "CONTROL_APPROVAL" && history.effective) {
    const outcome = history.effective.evaluation as EvaluationResult;
    return outcome.status === "MP" ? { revision: history.effective, outcome } : "ACTIVE_APPROVAL";
  }
  const head = technicalHead(history, context);
  if (typeof head === "string") return head;
  return head.outcome.status === "MP" && timed(head.outcome) &&
    (head.outcome.reason === "MISSING_CONTROL" || head.outcome.reason === "WRONG_ORDER") ? head : "UNSUPPORTED_RESULT";
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
  const identity = { entryId: context.entryId, classId: context.classId, courseVersionId: context.courseVersionId };
  switch (decision.kind) {
    case "DID_NOT_START":
      // Ett borttaget resultat (ej start eller manuellt beslut utan avläsning) kan bli ej start igen.
      if (history.head !== null && !(history.noActiveResult && history.governing === "NONE")) return fail("HAS_RESULT");
      return done("MANUAL_DID_NOT_START", createDidNotStartResult(context), null);
    case "WITHDRAW": {
      const cause = WITHDRAWAL_CAUSE[history.governing];
      if (!cause || !history.effective) return fail("NO_ACTIVE_DECISION");
      if (history.governing === "DNS") {
        // Ej start utan resultat under: löparen räknas som anmäld igen (ingen gällande revision).
        return done(cause, history.restore?.evaluation ?? history.effective.evaluation, history.restore);
      }
      // Steg 31: ett beslut utan avläsning under (manuell tid, brutit) tas bort och lämnar inget resultat.
      if (!history.restore) return done("MANUAL_RESULT_REMOVED", removedOutcome(context), null);
      if (!context.isCurrent(history.restore)) return fail("STALE_RESULT");
      return done(cause, history.restore.evaluation, history.restore);
    }
    case "MANUAL_TIME": {
      // Steg 31: manuell tid med eller utan avläsning. Bedöms mot nuvarande bana; ett äldre underlag spelar ingen roll.
      if (history.governing !== "NONE") return fail(ACTIVE_READINESS[history.governing] ?? "UNSUPPORTED_RESULT");
      const outcome = manualTimeOutcome(decision, context.knownStartTime, { ...identity, maxTimeMinutes: context.maxTimeMinutes,
        evaluateWithTimes: context.evaluateWithTimes });
      return outcome ? done("MANUAL_TIME", outcome, null) : fail("INVALID_TIME");
    }
    case "APPROVE_CONTROLS": {
      const source = controlApprovalSource(history, context);
      if (typeof source === "string") return fail(source);
      const approved = guarded(() => approveMissingControls(source.outcome, decision.controls));
      return approved ? done("MANUAL_CONTROL_APPROVAL", approved, source.revision) : fail("INVALID_CONTROL");
    }
    case "DID_NOT_FINISH": {
      // Steg 31: brutit går även utan avläsning (borttappad bricka) och oavsett om avläsningen är inaktuell.
      if (history.governing !== "NONE") return fail(ACTIVE_READINESS[history.governing] ?? "UNSUPPORTED_RESULT");
      const head = technicalHead(history, context);
      return done("MANUAL_DID_NOT_FINISH", { status: "DNF", reason: "DID_NOT_FINISH", ...identity },
        typeof head === "string" ? null : head.revision);
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
  Record<ManualDecisionKind, ManualDecisionReadiness> {
  const readiness = (decision: ManualDecision): ManualDecisionReadiness => {
    const result = applyManualDecision(history, decision, context);
    return result.ok || result.readiness === "INVALID_TIME" || result.readiness === "INVALID_CONTROL" ? "READY" : result.readiness;
  };
  // Tidsrättningarna prövas utan ny tid och godkännandet utan kontroller; bara det skiljer dem från "READY".
  const probe = "1970-01-01T00:00:00.000Z";
  return { DID_NOT_START: readiness({ kind: "DID_NOT_START" }), DID_NOT_FINISH: readiness({ kind: "DID_NOT_FINISH" }),
    DISQUALIFIED: readiness({ kind: "DISQUALIFIED" }), OUT_OF_COMPETITION: readiness({ kind: "OUT_OF_COMPETITION" }),
    WITHOUT_TIMING: readiness({ kind: "WITHOUT_TIMING" }), APPROVE_MANUALLY: readiness({ kind: "APPROVE_MANUALLY" }),
    FINISH_TIME: readiness({ kind: "FINISH_TIME", finishTime: probe }), START_TIME: readiness({ kind: "START_TIME", startTime: probe }),
    MANUAL_TIME: readiness({ kind: "MANUAL_TIME", status: "OK", note: "-", finishTime: probe, elapsedMs: -1 }),
    APPROVE_CONTROLS: readiness({ kind: "APPROVE_CONTROLS", controls: [], note: "-" }),
    WITHDRAW: readiness({ kind: "WITHDRAW" }) };
}
