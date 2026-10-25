import {
  applyManualDecision, controlApprovalSource, resolveResultHistory, type DecisionRevision, type GoverningDecision, type ManualDecision,
  type ManualDecisionContext
} from "./manual-decision";
import type { EvaluationResult, ResultOutcome, RevisionCause } from "./types";

/**
 * Steg 44: ett manuellt beslut följer med när resultatet räknas om (redigerad bana, ny starttid, ny lottning). Beslutet
 * fattades mot den gamla tekniska revisionen och bär dess banversion och underlag; ligger det kvar orört får klassen
 * blandade banversioner och fastställandet stoppas. Här tas beslutet bort och läggs på nytt ovanpå den nya tekniska
 * revisionen, med samma innehåll (tider, orsak, godkända kontroller). Rent och utan I/O: anroparen skriver stegen.
 */
export interface CarriedDecisionRevision extends DecisionRevision {
  readonly note?: string | null;
}

export interface DecisionCarryStep {
  readonly cause: RevisionCause;
  readonly outcome: ResultOutcome;
  readonly engineVersion: string;
  readonly note: string | null;
}

export type DecisionCarry =
  | { readonly kind: "NONE" }
  /** Stegen i ordning: först återtagandena (översta beslutet först), sedan besluten på nytt (understa först). */
  | { readonly kind: "CARRIED"; readonly decisions: number; readonly steps: readonly DecisionCarryStep[] }
  /** Beslutet går inte att lägga på det nya resultatet (t.ex. en godkänd kontroll som inte finns på banan längre). */
  | { readonly kind: "NOT_CARRIED"; readonly governing: GoverningDecision };

/** Beslut som ligger ovanpå ett resultat och kan följa med. Ej start är själva huvudet och följer inte med. */
const CARRIED: ReadonlySet<GoverningDecision> = new Set<GoverningDecision>(["DSQ", "APPROVAL", "DNF", "OOC", "NT", "FINISH_TIME",
  "START_TIME", "MANUAL_TIME", "CONTROL_APPROVAL", "MP_CONFIRMED"]);
/** Beslut som bara godtar en felstämpling; blir det nya resultatet godkänt behövs de inte och tas bara bort. */
const MISPUNCH_ACCEPTANCE: ReadonlySet<GoverningDecision> = new Set<GoverningDecision>(["APPROVAL", "CONTROL_APPROVAL",
  "MP_CONFIRMED"]);

/** Löparens beslut med samma innehåll som det lagrade, eller undefined om det inte går att återskapa. */
function decisionFor(revision: CarriedDecisionRevision, below: CarriedDecisionRevision | null, fixedStart: boolean):
  ManualDecision | undefined {
  const outcome = revision.evaluation as EvaluationResult;
  const note = revision.note ?? undefined;
  switch (revision.cause) {
    case "MANUAL_DISQUALIFICATION": return { kind: "DISQUALIFIED", reason: note };
    case "MANUAL_RESULT_APPROVAL": return { kind: "APPROVE_MANUALLY", note };
    case "MANUAL_DID_NOT_FINISH": return { kind: "DID_NOT_FINISH", note };
    case "MANUAL_OUT_OF_COMPETITION": return { kind: "OUT_OF_COMPETITION" };
    case "MANUAL_WITHOUT_TIMING": return { kind: "WITHOUT_TIMING" };
    case "MANUAL_MISPUNCH_CONFIRMATION": return { kind: "CONFIRM_MISPUNCH", note };
    case "MANUAL_FINISH_TIME_CORRECTION":
      return typeof outcome.finishTime === "string" ? { kind: "FINISH_TIME", finishTime: outcome.finishTime } : undefined;
    case "MANUAL_PUNCH_START_TIME_CORRECTION":
      return typeof outcome.startTime === "string" ? { kind: "START_TIME", startTime: outcome.startTime } : undefined;
    case "MANUAL_TIME": {
      // Måltiden står kvar. Starten följer löparens kända start (flyttad starttid, ny lottning) när beslutet använde
      // den; en egen starttid i beslutet står kvar.
      if (typeof outcome.startTime !== "string" || typeof outcome.finishTime !== "string") return undefined;
      // Utan avläsning under beslutet: i en klass med lottad start var starten den lottade.
      const belowStart = (below?.evaluation as EvaluationResult | undefined)?.startTime;
      const knownStart = typeof belowStart === "string" ? Date.parse(belowStart) === Date.parse(outcome.startTime) : fixedStart;
      return { kind: "MANUAL_TIME", note: note ?? "", status: outcome.status === "MP" ? "MP" : "OK",
        ...(knownStart ? {} : { startTime: outcome.startTime }), finishTime: outcome.finishTime };
    }
    case "MANUAL_CONTROL_APPROVAL": {
      // De godkända kontrollerna: de som saknades under beslutet men inte efter (alla, när resultatet blev godkänt).
      const before = [...((below?.evaluation as EvaluationResult | undefined)?.missingControls ?? [])];
      if (outcome.status === "MP") {
        for (const code of outcome.missingControls) {
          const index = before.indexOf(code);
          if (index >= 0) before.splice(index, 1);
        }
      }
      return before.length > 0 ? { kind: "APPROVE_CONTROLS", controls: before, note: note ?? "" } : undefined;
    }
    default: return undefined;
  }
}

/** Kontrollerna som fortfarande saknas i det nya resultatet (en förekomst per kod). */
function stillMissing(controls: readonly number[], missing: readonly number[]): number[] {
  const remaining = [...missing];
  return controls.filter((code) => {
    const index = remaining.indexOf(code);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

/**
 * Stegen som flyttar löparens kvarliggande beslut till den senaste tekniska revisionen. `revisions` är alla löparens
 * revisioner i stigande ordning, där den nya tekniska revisionen är den senaste. `context` gäller det nya underlaget.
 */
export function carryManualDecisions<T extends CarriedDecisionRevision>(revisions: readonly T[],
  context: ManualDecisionContext, options: { readonly withoutReadout?: boolean } = {}): DecisionCarry {
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  let rows: CarriedDecisionRevision[] = ordered;
  let history = resolveResultHistory(rows);
  if (!CARRIED.has(history.governing)) return { kind: "NONE" };
  const technical = history.technical;
  // Bara när det finns ett nytt tekniskt resultat ovanpå beslutet, eller (utan avläsning, t.ex. borttappad bricka) när
  // anroparen vet att beslutet bygger på ett äldre underlag: då läggs det på nytt mot det nya.
  const withoutReadout = options.withoutReadout === true;
  if (withoutReadout ? technical !== null || ordered.some((row) => row.readoutId !== null)
    : !technical || technical !== ordered.at(-1)) return { kind: "NONE" };
  const governing = history.governing;
  const steps: DecisionCarryStep[] = [];
  const append = (step: DecisionCarryStep) => {
    steps.push(step);
    rows = [...rows, { revision: rows.at(-1)!.revision + 1, cause: step.cause, evaluation: step.outcome, readoutId: null,
      note: step.note }];
    history = resolveResultHistory(rows);
  };
  // 1. Ta bort besluten (översta först). Det som återställs är det gamla underlaget, så det prövas inte mot det nya.
  const removed: { revision: CarriedDecisionRevision; below: CarriedDecisionRevision | null }[] = [];
  while (CARRIED.has(history.governing)) {
    const decision = history.effective!;
    const withdrawal = applyManualDecision(history, { kind: "WITHDRAW" }, { ...context, isCurrent: () => true });
    if (!withdrawal.ok || (withdrawal.cause === "MANUAL_RESULT_REMOVED") !== withoutReadout) return { kind: "NOT_CARRIED", governing };
    const before = resolveResultHistory(ordered.filter((row) => row.revision < decision.revision));
    removed.unshift({ revision: decision, below: before.effective });
    append({ cause: withdrawal.cause, outcome: withdrawal.outcome, engineVersion: withdrawal.engineVersion, note: null });
  }
  if (removed.length === 0 || history.technical !== technical) return { kind: "NOT_CARRIED", governing };
  // 2. Lägg besluten på nytt (understa först) mot det nya underlaget.
  const technicalStatus = technical ? (technical.evaluation as EvaluationResult).status : undefined;
  for (const { revision, below } of removed) {
    let decision = decisionFor(revision, below, withoutReadout && context.startRule === "FIXED");
    if (decision?.kind === "APPROVE_CONTROLS") {
      const source = controlApprovalSource(history, context);
      const controls = typeof source === "string" ? [] : stillMissing(decision.controls, source.outcome.missingControls);
      decision = controls.length > 0 ? { ...decision, controls } : undefined;
    }
    const kind = resolveResultHistory([revision]).governing;
    const outcome = decision ? applyManualDecision(history, decision, context) : undefined;
    if (!outcome?.ok) {
      // Godkänt utan beslutet: felstämplingen som godtogs finns inte längre.
      if ((technicalStatus === "OK" || technicalStatus === "OVERTIME") && MISPUNCH_ACCEPTANCE.has(kind)) break;
      return { kind: "NOT_CARRIED", governing };
    }
    append({ cause: outcome.cause, outcome: outcome.outcome, engineVersion: outcome.engineVersion,
      note: revision.note ?? null });
  }
  return { kind: "CARRIED", decisions: removed.length, steps };
}
