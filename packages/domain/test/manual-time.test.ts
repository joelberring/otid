import { describe, expect, it } from "vitest";
import {
  applyManualDecision, manualDecisionReadiness, resolveManualTimes, resolveResultHistory,
  type DecisionRevision, type EvaluationResult, type ManualDecisionContext, type ResultOutcome, type RevisionCause
} from "../src";

/** Steg 31: manuell tid, godkända kontroller och beslut som ligger kvar över en ny avläsning. */
const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";
const readoutId = "40000000-0000-4000-8000-000000000004";
const ids = { entryId, classId, courseVersionId };
const start = "2026-09-12T10:00:00.000Z";

function timed(status: "OK" | "MP", missing: number[] = status === "OK" ? [] : [32], finish = "2026-09-12T10:20:00.000Z"): EvaluationResult {
  return { status, reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL", ...ids, startTime: start, finishTime: finish,
    elapsedMs: Date.parse(finish) - Date.parse(start), missingControls: missing, extraPunches: [],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }] };
}
const missingFinish: EvaluationResult = { status: "MP", reason: "MISSING_FINISH", ...ids, startTime: start,
  missingControls: [], extraPunches: [], splits: [] };

function revision(number: number, cause: RevisionCause, evaluation: ResultOutcome, withReadout = cause === "CARD_READOUT" || cause === "EXPLICIT_RECALCULATION"): DecisionRevision {
  return { revision: number, cause, evaluation, readoutId: withReadout ? readoutId : null };
}
function apply(revisions: DecisionRevision[], decision: Parameters<typeof applyManualDecision>[1], context: ManualDecisionContext) {
  return applyManualDecision(resolveResultHistory(revisions), decision, context);
}

const context: ManualDecisionContext = { ...ids, startRule: "PUNCH", headStartPunchedAt: start, isCurrent: () => true,
  knownStartTime: start };
/** Som resultatmotorn: stämplingarna 31 och 32 med de nya tiderna. */
const evaluateWithTimes = (startTime: string, finishTime: string): EvaluationResult => ({ status: "OK", reason: "COMPLETE", ...ids,
  startTime, finishTime, elapsedMs: Date.parse(finishTime) - Date.parse(startTime), missingControls: [], extraPunches: [],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: Date.parse("2026-09-12T10:10:00.000Z") - Date.parse(startTime), legMs: 0 }] });

describe("manuell tid (steg 31)", () => {
  it("räknar ut start och mål ur måltid, löptid eller båda", () => {
    expect(resolveManualTimes({ status: "OK", finishTime: "2026-09-12T10:30:00Z" }, start)).toEqual({ startTime: start,
      finishTime: "2026-09-12T10:30:00.000Z", elapsedMs: 1_800_000 });
    expect(resolveManualTimes({ status: "OK", elapsedMs: 600_000 }, start)?.finishTime).toBe("2026-09-12T10:10:00.000Z");
    expect(resolveManualTimes({ status: "OK", finishTime: "2026-09-12T10:30:00Z", elapsedMs: 600_000 }, null)?.startTime)
      .toBe("2026-09-12T10:20:00.000Z");
    expect(resolveManualTimes({ status: "OK", startTime: "2026-09-12T10:05:00Z", finishTime: "2026-09-12T10:30:00Z" }, start)?.elapsedMs)
      .toBe(1_500_000);
    expect(resolveManualTimes({ status: "OK", finishTime: "2026-09-12T09:59:00Z" }, start)).toBeUndefined();
    expect(resolveManualTimes({ status: "OK", finishTime: "2026-09-12T10:30:00Z" }, null)).toBeUndefined();
    expect(resolveManualTimes({ status: "OK", startTime: start, finishTime: "2026-09-12T10:30:00Z", elapsedMs: 1 }, null)).toBeUndefined();
  });

  it("rättar en saknad målstämpling med avläsningen och lägger tiden ovanpå", () => {
    const read = revision(1, "CARD_READOUT", missingFinish);
    // Förr: "Rätta observerad måltid" gick inte vid saknad målstämpling.
    expect(apply([read], { kind: "FINISH_TIME", finishTime: "2026-09-12T10:30:00Z" }, context)).toEqual({ ok: false,
      readiness: "UNSUPPORTED_RESULT" });
    const manual = apply([read], { kind: "MANUAL_TIME", status: "OK", note: "Glömde stämpla mål", finishTime: "2026-09-12T10:30:00Z" },
      { ...context, evaluateWithTimes });
    expect(manual).toMatchObject({ ok: true, cause: "MANUAL_TIME", source: null, outcome: { status: "OK", reason: "COMPLETE",
      elapsedMs: 1_800_000, splits: [{ controlCode: 31, elapsedMs: 600_000 }] } });
    if (!manual.ok) throw new Error("manuell tid");
    const stored = revision(2, manual.cause, manual.outcome);
    expect(resolveResultHistory([read, stored])).toMatchObject({ governing: "MANUAL_TIME", effective: stored, restore: read });
    expect(apply([read, stored], { kind: "WITHDRAW" }, context)).toMatchObject({ ok: true, cause: "MANUAL_TIME_WITHDRAWAL",
      outcome: missingFinish });
  });

  it("godkänner eller felstämplar enligt arrangören och ger maxtid", () => {
    const read = revision(1, "CARD_READOUT", timed("MP"));
    const mp = (startTime: string, finishTime: string): EvaluationResult => ({ ...timed("MP"), startTime, finishTime,
      elapsedMs: Date.parse(finishTime) - Date.parse(startTime) });
    expect(apply([read], { kind: "MANUAL_TIME", status: "OK", note: "x", finishTime: "2026-09-12T10:30:00Z" },
      { ...context, evaluateWithTimes: mp })).toMatchObject({ ok: true, outcome: { status: "OK", reason: "COMPLETE", missingControls: [] } });
    expect(apply([read], { kind: "MANUAL_TIME", status: "MP", note: "x", finishTime: "2026-09-12T10:30:00Z" },
      { ...context, evaluateWithTimes: mp })).toMatchObject({ ok: true, outcome: { status: "MP", missingControls: [32] } });
    expect(apply([read], { kind: "MANUAL_TIME", status: "OK", note: "x", finishTime: "2026-09-12T11:30:00Z" },
      { ...context, maxTimeMinutes: 60 })).toMatchObject({ ok: true, outcome: { status: "OVERTIME", reason: "MAX_TIME_EXCEEDED" } });
  });

  it("fungerar utan avläsning och lämnar inget resultat när den tas bort", () => {
    const noReadout = { ...context, knownStartTime: null };
    expect(apply([], { kind: "MANUAL_TIME", status: "OK", note: "Tappade brickan", finishTime: "2026-09-12T10:30:00Z" }, noReadout))
      .toEqual({ ok: false, readiness: "INVALID_TIME" });
    const manual = apply([], { kind: "MANUAL_TIME", status: "OK", note: "Tappade brickan", startTime: start,
      finishTime: "2026-09-12T10:30:00Z" }, noReadout);
    expect(manual).toMatchObject({ ok: true, outcome: { status: "OK", elapsedMs: 1_800_000, missingControls: [], splits: [] } });
    if (!manual.ok) throw new Error("manuell tid");
    const stored = revision(1, manual.cause, manual.outcome);
    const removed = apply([stored], { kind: "WITHDRAW" }, noReadout);
    expect(removed).toMatchObject({ ok: true, cause: "MANUAL_RESULT_REMOVED", outcome: { status: "MP", reason: "MISSING_START" } });
    if (!removed.ok) throw new Error("borttagen");
    const after = resolveResultHistory([stored, revision(2, removed.cause, removed.outcome)]);
    expect(after).toMatchObject({ governing: "NONE", noActiveResult: true, effective: null });
    // Därefter går ej start, brutit och en ny manuell tid.
    expect(manualDecisionReadiness(after, noReadout)).toMatchObject({ DID_NOT_START: "READY", DID_NOT_FINISH: "READY",
      MANUAL_TIME: "READY", DISQUALIFIED: "NO_ACTIVE_RESULT" });
  });

  it("brutit utan avläsning", () => {
    expect(apply([], { kind: "DID_NOT_FINISH" }, context)).toMatchObject({ ok: true, cause: "MANUAL_DID_NOT_FINISH", source: null,
      outcome: { status: "DNF", reason: "DID_NOT_FINISH", entryId } });
    const dnf = revision(1, "MANUAL_DID_NOT_FINISH", { status: "DNF", reason: "DID_NOT_FINISH", ...ids });
    expect(apply([dnf], { kind: "WITHDRAW" }, context)).toMatchObject({ ok: true, cause: "MANUAL_RESULT_REMOVED" });
  });
});

describe("beslut överlever en ny avläsning (steg 31)", () => {
  it("rättad måltid och manuell tid ligger kvar över en ny avläsning och en omräkning", () => {
    const read = revision(1, "CARD_READOUT", timed("OK"));
    const corrected = revision(2, "MANUAL_FINISH_TIME_CORRECTION", timed("OK", [], "2026-09-12T10:25:00.000Z"));
    const again = revision(3, "CARD_READOUT", timed("OK"));
    const recalculated = revision(4, "EXPLICIT_RECALCULATION", timed("OK"));
    expect(resolveResultHistory([read, corrected, again, recalculated])).toMatchObject({ governing: "FINISH_TIME",
      effective: corrected, restore: recalculated, technical: recalculated });
    const withdrawn = apply([read, corrected, again, recalculated], { kind: "WITHDRAW" }, context);
    expect(withdrawn).toMatchObject({ ok: true, cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", source: recalculated });
  });

  it("ej start ersätts fortfarande av en avläsning, och vanliga fall är oförändrade", () => {
    const dns = revision(1, "MANUAL_DID_NOT_START", { status: "DNS", reason: "DID_NOT_START", ...ids });
    const read = revision(2, "CARD_READOUT", timed("OK"));
    expect(resolveResultHistory([dns, read])).toMatchObject({ governing: "NONE", effective: read, technical: read });
    const dsq = revision(3, "MANUAL_DISQUALIFICATION", { ...timed("OK"), ...ids, status: "DSQ", reason: "MANUAL_DISQUALIFICATION" } as ResultOutcome);
    const withdrawal = revision(4, "MANUAL_DISQUALIFICATION_WITHDRAWAL", read.evaluation);
    expect(resolveResultHistory([dns, read, dsq])).toMatchObject({ governing: "DSQ", effective: dsq, restore: read });
    expect(resolveResultHistory([dns, read, dsq, withdrawal])).toMatchObject({ governing: "NONE", effective: withdrawal, technical: read });
  });

  it("efter ett borttaget beslut kan ett nytt fattas på avläsningen", () => {
    const read = revision(1, "CARD_READOUT", timed("OK"));
    const dsq = revision(2, "MANUAL_DISQUALIFICATION", { ...timed("OK"), ...ids, status: "DSQ", reason: "MANUAL_DISQUALIFICATION" } as ResultOutcome);
    const withdrawal = revision(3, "MANUAL_DISQUALIFICATION_WITHDRAWAL", read.evaluation);
    expect(apply([read, dsq, withdrawal], { kind: "FINISH_TIME", finishTime: "2026-09-12T10:21:00Z" }, context))
      .toMatchObject({ ok: true, source: read });
  });
});

describe("godkänn valda kontroller (steg 31)", () => {
  const read = revision(1, "CARD_READOUT", timed("MP", [32, 34]));

  it("godkänner en kontroll i taget och blir godkänd när inget saknas", () => {
    const first = apply([read], { kind: "APPROVE_CONTROLS", controls: [32], note: "Stämplade med nålen" }, context);
    expect(first).toMatchObject({ ok: true, cause: "MANUAL_CONTROL_APPROVAL", outcome: { status: "MP", missingControls: [34] } });
    if (!first.ok) throw new Error("första");
    const partial = revision(2, first.cause, first.outcome);
    expect(resolveResultHistory([read, partial])).toMatchObject({ governing: "CONTROL_APPROVAL" });
    const second = apply([read, partial], { kind: "APPROVE_CONTROLS", controls: [34], note: "Stationen registrerade inte" }, context);
    expect(second).toMatchObject({ ok: true, outcome: { status: "OK", reason: "MANUAL_APPROVAL", elapsedMs: 1_200_000 } });
    if (!second.ok) throw new Error("andra");
    const full = revision(3, second.cause, second.outcome);
    // Återtagandet tar bort det senaste godkännandet; det första ligger kvar.
    expect(apply([read, partial, full], { kind: "WITHDRAW" }, context)).toMatchObject({ ok: true,
      cause: "MANUAL_CONTROL_APPROVAL_WITHDRAWAL", outcome: { status: "MP", missingControls: [34] } });
    expect(apply([read, partial, full], { kind: "APPROVE_CONTROLS", controls: [34], note: "x" }, context))
      .toEqual({ ok: false, readiness: "ACTIVE_APPROVAL" });
  });

  it("avvisar en kontroll som inte saknas och ett resultat utan tid", () => {
    expect(apply([read], { kind: "APPROVE_CONTROLS", controls: [33], note: "x" }, context)).toEqual({ ok: false, readiness: "INVALID_CONTROL" });
    expect(apply([revision(1, "CARD_READOUT", missingFinish)], { kind: "APPROVE_CONTROLS", controls: [32], note: "x" }, context))
      .toEqual({ ok: false, readiness: "UNSUPPORTED_RESULT" });
    expect(manualDecisionReadiness(resolveResultHistory([revision(1, "CARD_READOUT", missingFinish)]), context))
      .toMatchObject({ APPROVE_CONTROLS: "UNSUPPORTED_RESULT", APPROVE_MANUALLY: "UNSUPPORTED_RESULT", MANUAL_TIME: "READY" });
  });
});
