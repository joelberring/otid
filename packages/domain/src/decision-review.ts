import { OVERLAY_GOVERNING, resolveResultHistory, type DecisionRevision, type GoverningDecision } from "./manual-decision";
import type { EvaluationResult } from "./types";

/**
 * Steg 45: ett beslut som döljer en ny avläsning. Beslut ligger kvar ovanpå senare avläsningar (steg 31), så en löpare
 * som satts som brutit utan bricka står kvar som brutit när brickan sedan kopplas, fast avläsningen ger godkänt. Samma
 * sak när en bekräftad felstämpling blir godkänd för att en kontroll sätts ur funktion. Det är inte fel, men arrangören
 * behöver se det: deltagarkortet, kopplingskvittot och "Beslut att se över" visar vad avläsningen ger.
 */
export interface DecisionReview {
  /** Beslutet som gäller. */
  readonly decision: Exclude<GoverningDecision, "NONE" | "DNS" | "CHECKIN_DNS">;
  /** Det avläsningen ger. */
  readonly status: "OK" | "MP" | "OVERTIME";
  readonly elapsedMs?: number;
}

const sameTechnical = (left: EvaluationResult, right: EvaluationResult) =>
  left.status === right.status && left.elapsedMs === right.elapsedMs;

/**
 * Beskedet, eller undefined. Bara när en teknisk bedömning har kommit efter beslutet och skiljer sig från den som beslutet
 * fattades på (eller beslutet fattades utan avläsning). Samma avläsning igen ger alltså inget besked.
 */
export function decisionHidingReadout<T extends DecisionRevision>(revisions: readonly T[]): DecisionReview | undefined {
  const history = resolveResultHistory(revisions);
  const decision = history.effective;
  const technical = history.technical;
  if (!decision || !technical || !OVERLAY_GOVERNING.has(history.governing) || technical.revision <= decision.revision) return undefined;
  const outcome = technical.evaluation as EvaluationResult;
  if (outcome.status !== "OK" && outcome.status !== "MP" && outcome.status !== "OVERTIME") return undefined;
  const before = resolveResultHistory(revisions.filter((revision) => revision.revision < decision.revision)).technical;
  if (before && sameTechnical(before.evaluation as EvaluationResult, outcome)) return undefined;
  return { decision: history.governing as DecisionReview["decision"], status: outcome.status,
    ...(outcome.elapsedMs !== undefined && outcome.status !== "MP" ? { elapsedMs: outcome.elapsedMs } : {}) };
}
