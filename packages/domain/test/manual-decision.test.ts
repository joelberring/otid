import { describe, expect, it } from "vitest";
import {
  applyManualDecision, manualDecisionReadiness, resolveResultHistory,
  type DecisionRevision, type EvaluationResult, type ManualDecisionContext, type ResultOutcome, type RevisionCause
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";
const readoutId = "40000000-0000-4000-8000-000000000004";

function timed(status: "OK" | "MP", finish = "2026-09-12T10:20:00.000Z"): EvaluationResult {
  return { status, reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL", entryId, classId, courseVersionId,
    startTime: "2026-09-12T10:00:00.000Z", finishTime: finish, elapsedMs: Date.parse(finish) - Date.parse("2026-09-12T10:00:00.000Z"),
    missingControls: status === "OK" ? [] : [32], extraPunches: [],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }] };
}

function revision(number: number, cause: RevisionCause, evaluation: ResultOutcome, withReadout = cause === "CARD_READOUT"): DecisionRevision {
  return { revision: number, cause, evaluation, readoutId: withReadout ? readoutId : null };
}

const context: ManualDecisionContext = { entryId, classId, courseVersionId, startRule: "PUNCH",
  headStartPunchedAt: "2026-09-12T10:00:00.000Z", isCurrent: () => true };

describe("resolveResultHistory (ADR-0173 beslut 1)", () => {
  it("låter disk ligga kvar över en senare avläsning tills den tas bort", () => {
    const read = revision(1, "CARD_READOUT", timed("OK"));
    const dsq = revision(2, "MANUAL_DISQUALIFICATION", { ...timed("OK"), entryId, classId, courseVersionId, status: "DSQ", reason: "MANUAL_DISQUALIFICATION" });
    const later = revision(3, "CARD_READOUT", timed("OK", "2026-09-12T10:30:00.000Z"));
    const history = resolveResultHistory([read, dsq, later]);
    expect(history).toMatchObject({ head: later, effective: dsq, governing: "DSQ", restore: later });
    const withdrawn = applyManualDecision(history, { kind: "WITHDRAW" }, context);
    expect(withdrawn).toMatchObject({ ok: true, cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL", outcome: later.evaluation });
    const after = resolveResultHistory([read, dsq, later, revision(4, "MANUAL_DISQUALIFICATION_WITHDRAWAL", later.evaluation)]);
    expect(after).toMatchObject({ governing: "NONE", effective: { revision: 4 } });
  });

  it("ersätter ej start och rättad tid med en senare avläsning", () => {
    const dns = revision(1, "MANUAL_DID_NOT_START", { status: "DNS", reason: "DID_NOT_START", entryId, classId, courseVersionId });
    expect(resolveResultHistory([dns]).governing).toBe("DNS");
    expect(resolveResultHistory([dns, revision(2, "CARD_READOUT", timed("OK"))]).governing).toBe("NONE");
    const withdrawn = resolveResultHistory([dns, revision(2, "MANUAL_DID_NOT_START_WITHDRAWAL", dns.evaluation)]);
    expect(withdrawn).toMatchObject({ governing: "NONE", noActiveResult: true, effective: null });
  });

  it("återställer källan när en rättad måltid tas bort", () => {
    const read = revision(1, "CARD_READOUT", timed("OK"));
    const corrected = applyManualDecision(resolveResultHistory([read]), { kind: "FINISH_TIME", finishTime: "2026-09-12T10:25:00.000Z" }, context);
    expect(corrected).toMatchObject({ ok: true, cause: "MANUAL_FINISH_TIME_CORRECTION",
      outcome: { finishTime: "2026-09-12T10:25:00.000Z", elapsedMs: 1_500_000 } });
    if (!corrected.ok) throw new Error("rättning");
    const history = resolveResultHistory([read, revision(2, corrected.cause, corrected.outcome)]);
    expect(history).toMatchObject({ governing: "FINISH_TIME", restore: read });
    expect(applyManualDecision(history, { kind: "WITHDRAW" }, context)).toMatchObject({
      ok: true, cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", outcome: read.evaluation });
  });
});

describe("applyManualDecision", () => {
  const read = revision(1, "CARD_READOUT", timed("MP"));

  it("ger bara ej start utan resultat och godkänner bara felstämpling", () => {
    expect(applyManualDecision(resolveResultHistory([]), { kind: "DID_NOT_START" }, context)).toMatchObject({ ok: true,
      cause: "MANUAL_DID_NOT_START", outcome: { status: "DNS" } });
    const history = resolveResultHistory([read]);
    expect(applyManualDecision(history, { kind: "DID_NOT_START" }, context)).toEqual({ ok: false, readiness: "HAS_RESULT" });
    expect(applyManualDecision(history, { kind: "APPROVE_MANUALLY" }, context)).toMatchObject({ ok: true,
      outcome: { status: "OK", reason: "MANUAL_APPROVAL" } });
    expect(applyManualDecision(history, { kind: "WITHOUT_TIMING" }, context)).toEqual({ ok: false, readiness: "UNSUPPORTED_RESULT" });
  });

  it("avvisar ett nytt beslut ovanpå ett gällande och ett inaktuellt underlag", () => {
    const dnf = revision(2, "MANUAL_DID_NOT_FINISH", { status: "DNF", reason: "DID_NOT_FINISH", entryId, classId, courseVersionId });
    expect(applyManualDecision(resolveResultHistory([read, dnf]), { kind: "DISQUALIFIED" }, context))
      .toEqual({ ok: false, readiness: "ACTIVE_DID_NOT_FINISH" });
    expect(applyManualDecision(resolveResultHistory([read]), { kind: "DISQUALIFIED" }, { ...context, isCurrent: () => false }))
      .toEqual({ ok: false, readiness: "STALE_RESULT" });
    expect(applyManualDecision(resolveResultHistory([read]), { kind: "WITHDRAW" }, context))
      .toEqual({ ok: false, readiness: "NO_ACTIVE_DECISION" });
  });

  it("prövar rättad starttid mot startsätt och sträcktider", () => {
    const history = resolveResultHistory([revision(1, "CARD_READOUT", timed("OK"))]);
    expect(applyManualDecision(history, { kind: "START_TIME", startTime: "2026-09-12T10:01:00.000Z" }, context))
      .toMatchObject({ ok: true, outcome: { startTime: "2026-09-12T10:01:00.000Z", elapsedMs: 1_140_000 } });
    expect(applyManualDecision(history, { kind: "START_TIME", startTime: "2026-09-12T10:11:00.000Z" }, context))
      .toEqual({ ok: false, readiness: "INVALID_TIME" });
    expect(applyManualDecision(history, { kind: "START_TIME", startTime: "2026-09-12T10:01:00.000Z" }, { ...context, startRule: "FIXED" }))
      .toEqual({ ok: false, readiness: "NOT_PUNCH_START" });
    expect(manualDecisionReadiness(history, context)).toMatchObject({ FINISH_TIME: "READY", START_TIME: "READY",
      DID_NOT_START: "HAS_RESULT", WITHDRAW: "NO_ACTIVE_DECISION" });
  });
});
