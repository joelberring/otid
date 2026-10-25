import { describe, expect, it } from "vitest";
import {
  applyManualDecision, carryManualDecisions, resolveResultHistory,
  type CarriedDecisionRevision, type EvaluationResult, type ManualDecisionContext, type ResultOutcome, type RevisionCause
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const oldVersion = "30000000-0000-4000-8000-000000000003";
const newVersion = "30000000-0000-4000-8000-000000000033";
const readoutId = "40000000-0000-4000-8000-000000000004";

function technical(courseVersionId: string, missing: number[]): EvaluationResult {
  return { status: missing.length === 0 ? "OK" : "MP", reason: missing.length === 0 ? "COMPLETE" : "MISSING_CONTROL", entryId, classId,
    courseVersionId, startTime: "2026-09-12T10:00:00.000Z", finishTime: "2026-09-12T10:20:00.000Z", elapsedMs: 1_200_000,
    missingControls: missing, extraPunches: [], splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }] };
}

function row(number: number, cause: RevisionCause, evaluation: ResultOutcome, note: string | null = null): CarriedDecisionRevision {
  return { revision: number, cause, evaluation, readoutId: cause === "CARD_READOUT" || cause === "EXPLICIT_RECALCULATION" ? readoutId : null,
    note };
}

const contextFor = (courseVersionId: string, knownStartTime = "2026-09-12T10:00:00.000Z"): ManualDecisionContext => ({ entryId,
  classId, courseVersionId, startRule: "PUNCH", headStartPunchedAt: knownStartTime, knownStartTime, isCurrent: () => true });

/** Lägger till beslutet som en revision, som arbetsytan gör. */
function decide(rows: CarriedDecisionRevision[], decision: Parameters<typeof applyManualDecision>[1], note: string | null = null) {
  const result = applyManualDecision(resolveResultHistory(rows), decision, contextFor(oldVersion));
  if (!result.ok) throw new Error(result.readiness);
  return [...rows, row(rows.length + 1, result.cause, result.outcome, note)];
}

describe("steg 44: carryManualDecisions", () => {
  it("lägger godkända kontroller (två beslut) på nytt mot den nya banversionen", () => {
    let rows = [row(1, "CARD_READOUT", technical(oldVersion, [32, 34]))];
    rows = decide(rows, { kind: "APPROVE_CONTROLS", controls: [32], note: "Borta" }, "Borta");
    rows = decide(rows, { kind: "APPROVE_CONTROLS", controls: [34], note: "Också borta" }, "Också borta");
    rows = [...rows, row(4, "EXPLICIT_RECALCULATION", technical(newVersion, [32, 34]))];
    const carry = carryManualDecisions(rows, contextFor(newVersion));
    if (carry.kind !== "CARRIED") throw new Error(carry.kind);
    expect(carry.decisions).toBe(2);
    expect(carry.steps.map((step) => [step.cause, step.outcome.status, step.note])).toEqual([
      ["MANUAL_CONTROL_APPROVAL_WITHDRAWAL", "MP", null], ["MANUAL_CONTROL_APPROVAL_WITHDRAWAL", "MP", null],
      ["MANUAL_CONTROL_APPROVAL", "MP", "Borta"], ["MANUAL_CONTROL_APPROVAL", "OK", "Också borta"]]);
    expect(carry.steps.slice(2).every((step) => "courseVersionId" in step.outcome && step.outcome.courseVersionId === newVersion))
      .toBe(true);
    // Efteråt gäller det sista beslutet, och "Ta bort beslutet" lämnar det första (på nya banan).
    const after = resolveResultHistory([...rows, ...carry.steps.map((step, index) => row(5 + index, step.cause, step.outcome))]);
    expect(after).toMatchObject({ governing: "CONTROL_APPROVAL", effective: { revision: 8 }, restore: { revision: 7 } });
  });

  it("tar bara bort ett godkännande som inte behövs när det nya resultatet är godkänt", () => {
    let rows = [row(1, "CARD_READOUT", technical(oldVersion, [32]))];
    rows = decide(rows, { kind: "APPROVE_MANUALLY", note: "Borta" }, "Borta");
    rows = [...rows, row(3, "EXPLICIT_RECALCULATION", technical(newVersion, []))];
    const carry = carryManualDecisions(rows, contextFor(newVersion));
    expect(carry).toMatchObject({ kind: "CARRIED", decisions: 1, steps: [{ cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" }] });
  });

  it("lämnar beslutet orört när det inte går att lägga på det nya resultatet", () => {
    let rows = [row(1, "CARD_READOUT", technical(oldVersion, [32]))];
    rows = decide(rows, { kind: "APPROVE_CONTROLS", controls: [32], note: "Borta" }, "Borta");
    rows = [...rows, row(3, "EXPLICIT_RECALCULATION", technical(newVersion, [35]))];
    expect(carryManualDecisions(rows, contextFor(newVersion))).toEqual({ kind: "NOT_CARRIED", governing: "CONTROL_APPROVAL" });
  });

  it("gör inget utan beslut eller utan nytt tekniskt resultat ovanpå", () => {
    const read = row(1, "CARD_READOUT", technical(oldVersion, []));
    expect(carryManualDecisions([read, row(2, "EXPLICIT_RECALCULATION", technical(newVersion, []))], contextFor(newVersion)))
      .toEqual({ kind: "NONE" });
    const decided = decide([read], { kind: "DID_NOT_FINISH", note: "Bröt" }, "Bröt");
    expect(carryManualDecisions(decided, contextFor(newVersion))).toEqual({ kind: "NONE" });
  });

  it("låter måltiden stå kvar och starten följa den nya starttiden för en manuell tid", () => {
    let rows = [row(1, "CARD_READOUT", technical(oldVersion, []))];
    rows = decide(rows, { kind: "MANUAL_TIME", status: "OK", finishTime: "2026-09-12T10:25:00.000Z", note: "Mål saknas" }, "Mål saknas");
    const moved = { ...technical(newVersion, []), startTime: "2026-09-12T10:05:00.000Z", elapsedMs: 900_000 };
    rows = [...rows, row(3, "EXPLICIT_RECALCULATION", moved)];
    const carry = carryManualDecisions(rows, contextFor(newVersion, "2026-09-12T10:05:00.000Z"));
    if (carry.kind !== "CARRIED") throw new Error(carry.kind);
    expect(carry.steps.at(-1)).toMatchObject({ cause: "MANUAL_TIME", note: "Mål saknas", outcome: {
      startTime: "2026-09-12T10:05:00.000Z", finishTime: "2026-09-12T10:25:00.000Z", elapsedMs: 1_200_000, courseVersionId: newVersion } });
  });
});
