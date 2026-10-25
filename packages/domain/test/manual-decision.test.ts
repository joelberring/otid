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
    // Steg 35: "Deltog utan tid" går även på en felstämplad avläsning och har aldrig tid; steg 38: sträcktiderna står kvar.
    expect(applyManualDecision(history, { kind: "WITHOUT_TIMING" }, context)).toEqual({ ok: true, cause: "MANUAL_WITHOUT_TIMING",
      outcome: { status: "NT", reason: "WITHOUT_TIMING", entryId, classId, courseVersionId, startTime: "2026-09-12T10:00:00.000Z",
        splits: timed("MP").splits }, engineVersion: "without-timing-v1", source: read });
  });

  it("ger disk, utom tävlan och deltog utan tid även utan avläsning (steg 35)", () => {
    const none = resolveResultHistory([]);
    const empty = { entryId, classId, courseVersionId, missingControls: [], extraPunches: [], splits: [] };
    expect(applyManualDecision(none, { kind: "DISQUALIFIED", reason: "Genade" }, context)).toMatchObject({ ok: true,
      cause: "MANUAL_DISQUALIFICATION", outcome: { status: "DSQ", reason: "MANUAL_DISQUALIFICATION", ...empty }, source: null });
    expect(applyManualDecision(none, { kind: "OUT_OF_COMPETITION" }, context)).toMatchObject({ ok: true,
      cause: "MANUAL_OUT_OF_COMPETITION", outcome: { status: "OOC", reason: "OUT_OF_COMPETITION", ...empty }, source: null });
    const nt = applyManualDecision(none, { kind: "WITHOUT_TIMING" }, context);
    expect(nt).toMatchObject({ ok: true, cause: "MANUAL_WITHOUT_TIMING", outcome: { status: "NT" }, source: null });
    expect(manualDecisionReadiness(none, context)).toMatchObject({ DID_NOT_START: "READY", DID_NOT_FINISH: "READY",
      DISQUALIFIED: "READY", OUT_OF_COMPETITION: "READY", WITHOUT_TIMING: "READY", APPROVE_MANUALLY: "NO_ACTIVE_RESULT" });
    if (!nt.ok) throw new Error("deltog utan tid");
    // Tas beslutet bort blir det inget resultat (som manuell tid utan avläsning).
    const decided = resolveResultHistory([revision(1, nt.cause, nt.outcome)]);
    expect(decided).toMatchObject({ governing: "NT", restore: null });
    expect(applyManualDecision(decided, { kind: "WITHDRAW" }, context)).toMatchObject({ ok: true, cause: "MANUAL_RESULT_REMOVED" });
    // Utom tävlan på en avläsning behåller tiden.
    const ooc = applyManualDecision(resolveResultHistory([revision(1, "CARD_READOUT", timed("OK"))]), { kind: "OUT_OF_COMPETITION" }, context);
    expect(ooc).toMatchObject({ ok: true, outcome: { status: "OOC", elapsedMs: 1_200_000 } });
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

describe("steg 38: bekräfta felstämplad och sträcktider vid brutit", () => {
  const missingFinish: EvaluationResult = { status: "MP", reason: "MISSING_FINISH", entryId, classId, courseVersionId,
    startTime: "2026-09-12T10:00:00.000Z", missingControls: [], extraPunches: [], splits: [] };
  const partial = [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 },
    { controlCode: 32, occurrence: 1, elapsedMs: 900_000, legMs: 300_000 }];
  /** Avläsningen bedömd med ett mål långt efter starten: stämplingarna efter starten får sina tider. */
  const withReadout: ManualDecisionContext = { ...context, evaluateWithTimes: (startTime, finishTime) => ({ ...missingFinish,
    reason: "MISSING_CONTROL", startTime, finishTime, elapsedMs: Date.parse(finishTime) - Date.parse(startTime), missingControls: [33],
    splits: partial }) };

  it("bekräftar en felstämpling med samma utfall, ligger kvar över en ny avläsning och tas bort med ett återtagande", () => {
    const read = revision(1, "CARD_READOUT", timed("MP"));
    const confirmed = applyManualDecision(resolveResultHistory([read]), { kind: "CONFIRM_MISPUNCH", note: "Kontrollerat" }, context);
    expect(confirmed).toEqual({ ok: true, cause: "MANUAL_MISPUNCH_CONFIRMATION", outcome: read.evaluation,
      engineVersion: "mispunch-confirmation-v1", source: read });
    if (!confirmed.ok) throw new Error("bekräftelse");
    const later = revision(3, "CARD_READOUT", timed("MP", "2026-09-12T10:21:00.000Z"));
    const history = resolveResultHistory([read, revision(2, confirmed.cause, confirmed.outcome), later]);
    expect(history).toMatchObject({ governing: "MP_CONFIRMED", effective: { revision: 2 }, restore: later });
    expect(manualDecisionReadiness(history, context)).toMatchObject({ CONFIRM_MISPUNCH: "ACTIVE_MISPUNCH_CONFIRMATION",
      DID_NOT_FINISH: "ACTIVE_MISPUNCH_CONFIRMATION", WITHDRAW: "READY" });
    expect(applyManualDecision(history, { kind: "WITHDRAW" }, context)).toMatchObject({ ok: true,
      cause: "MANUAL_MISPUNCH_CONFIRMATION_WITHDRAWAL", outcome: later.evaluation });
    // Bara en felstämplad löpare kan bekräftas.
    expect(applyManualDecision(resolveResultHistory([revision(1, "CARD_READOUT", timed("OK"))]), { kind: "CONFIRM_MISPUNCH" }, context))
      .toEqual({ ok: false, readiness: "UNSUPPORTED_RESULT" });
  });

  it("brutit, disk och utom tävlan utan målstämpling får sträcktiderna fram till sista stämplade kontrollen", () => {
    const history = resolveResultHistory([revision(1, "CARD_READOUT", missingFinish)]);
    expect(applyManualDecision(history, { kind: "DID_NOT_FINISH" }, withReadout)).toMatchObject({ ok: true,
      outcome: { status: "DNF", startTime: "2026-09-12T10:00:00.000Z", splits: partial } });
    const dnf = applyManualDecision(history, { kind: "DID_NOT_FINISH" }, withReadout);
    expect(dnf.ok && "finishTime" in dnf.outcome).toBe(false);
    expect(applyManualDecision(history, { kind: "DISQUALIFIED" }, withReadout)).toMatchObject({ ok: true,
      outcome: { status: "DSQ", splits: partial } });
    expect(applyManualDecision(history, { kind: "OUT_OF_COMPETITION" }, withReadout)).toMatchObject({ ok: true,
      outcome: { status: "OOC", splits: partial } });
    // Med mål är det bedömningens sträcktider; utan avläsning bara status.
    expect(applyManualDecision(resolveResultHistory([revision(1, "CARD_READOUT", timed("MP"))]), { kind: "DID_NOT_FINISH" }, context))
      .toMatchObject({ ok: true, outcome: { status: "DNF", splits: timed("MP").splits } });
    expect(applyManualDecision(resolveResultHistory([]), { kind: "DID_NOT_FINISH" }, context)).toEqual({ ok: true,
      cause: "MANUAL_DID_NOT_FINISH", outcome: { status: "DNF", reason: "DID_NOT_FINISH", entryId, classId, courseVersionId },
      engineVersion: "did-not-finish-v1", source: null });
  });
});

describe("steg 45: disk och utom tävlan ovanpå en manuell tid", () => {
  it("lägger disk och utom tävlan på den manuella tiden, och borttaget återställer den manuella tiden", () => {
    const read = revision(1, "CARD_READOUT", timed("MP"));
    const manual = revision(2, "MANUAL_TIME", { ...timed("OK", "2026-09-12T10:25:00.000Z") });
    const history = resolveResultHistory([read, manual]);
    expect(history.governing).toBe("MANUAL_TIME");
    const dsq = applyManualDecision(history, { kind: "DISQUALIFIED" }, context);
    expect(dsq).toMatchObject({ ok: true, cause: "MANUAL_DISQUALIFICATION", outcome: { status: "DSQ", elapsedMs: 1_500_000 } });
    const ooc = applyManualDecision(history, { kind: "OUT_OF_COMPETITION" }, context);
    expect(ooc).toMatchObject({ ok: true, cause: "MANUAL_OUT_OF_COMPETITION", outcome: { status: "OOC", elapsedMs: 1_500_000 } });
    expect(manualDecisionReadiness(history, context)).toMatchObject({ DISQUALIFIED: "READY", OUT_OF_COMPETITION: "READY",
      DID_NOT_FINISH: "ACTIVE_MANUAL_TIME" });
    if (!dsq.ok) throw new Error("disk");
    const stacked = resolveResultHistory([read, manual, revision(3, dsq.cause, dsq.outcome)]);
    expect(stacked.governing).toBe("DSQ");
    const withdrawn = applyManualDecision(stacked, { kind: "WITHDRAW" }, context);
    expect(withdrawn).toMatchObject({ ok: true, cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL", outcome: { status: "OK", elapsedMs: 1_500_000 } });
    if (!withdrawn.ok) throw new Error("ta bort");
    expect(resolveResultHistory([read, manual, revision(3, dsq.cause, dsq.outcome), revision(4, withdrawn.cause, withdrawn.outcome)]).governing)
      .toBe("MANUAL_TIME");
  });
});
