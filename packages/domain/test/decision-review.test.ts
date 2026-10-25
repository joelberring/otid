import { describe, expect, it } from "vitest";
import { decisionHidingReadout, type DecisionRevision, type EvaluationResult, type ResultOutcome, type RevisionCause } from "../src";

const ids = { entryId: "10000000-0000-4000-8000-000000000001", classId: "20000000-0000-4000-8000-000000000002",
  courseVersionId: "30000000-0000-4000-8000-000000000003" };

function read(status: "OK" | "MP", elapsedMs = 2_712_000): EvaluationResult {
  return { status, reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL", ...ids, startTime: "2026-10-25T10:00:00.000Z",
    finishTime: new Date(Date.parse("2026-10-25T10:00:00.000Z") + elapsedMs).toISOString(), elapsedMs,
    missingControls: status === "OK" ? [] : [32], extraPunches: [], splits: [] };
}
const rev = (revision: number, cause: RevisionCause, evaluation: ResultOutcome, readoutId: string | null = null): DecisionRevision =>
  ({ revision, cause, evaluation, readoutId });
const dnf = { status: "DNF", reason: "DID_NOT_FINISH", ...ids } as ResultOutcome;

describe("beslut som döljer en ny avläsning (steg 45)", () => {
  it("brutit utan bricka, sedan kopplas brickan och avläsningen ger godkänd", () => {
    expect(decisionHidingReadout([rev(1, "MANUAL_DID_NOT_FINISH", dnf), rev(2, "UNKNOWN_READOUT_RESOLUTION", read("OK"), "r1")]))
      .toEqual({ decision: "DNF", status: "OK", elapsedMs: 2_712_000 });
  });

  it("bekräftad felstämpling som blir godkänd vid omräkning", () => {
    const confirmed = { ...read("MP") } as ResultOutcome;
    expect(decisionHidingReadout([rev(1, "CARD_READOUT", read("MP"), "r1"), rev(2, "MANUAL_MISPUNCH_CONFIRMATION", confirmed),
      rev(3, "EXPLICIT_RECALCULATION", read("OK"), "r1")])).toEqual({ decision: "MP_CONFIRMED", status: "OK", elapsedMs: 2_712_000 });
  });

  it("inget besked när avläsningen är samma som beslutet fattades på, eller när beslutet är nyast", () => {
    const dsq = { ...read("OK"), status: "DSQ", reason: "MANUAL_DISQUALIFICATION" } as ResultOutcome;
    expect(decisionHidingReadout([rev(1, "CARD_READOUT", read("OK"), "r1"), rev(2, "MANUAL_DISQUALIFICATION", dsq),
      rev(3, "CARD_READOUT", read("OK"), "r2")])).toBeUndefined();
    expect(decisionHidingReadout([rev(1, "CARD_READOUT", read("OK"), "r1"), rev(2, "MANUAL_DISQUALIFICATION", dsq)])).toBeUndefined();
    expect(decisionHidingReadout([rev(1, "CARD_READOUT", read("OK"), "r1")])).toBeUndefined();
    // Borttaget beslut: avläsningen gäller igen.
    expect(decisionHidingReadout([rev(1, "MANUAL_DID_NOT_FINISH", dnf), rev(2, "CARD_READOUT", read("OK"), "r1"),
      rev(3, "MANUAL_DID_NOT_FINISH_WITHDRAWAL", read("OK"), "r1")])).toBeUndefined();
  });

  it("ny avläsning med annan tid under en rättad måltid, och felstämplad utan tid", () => {
    const corrected = { ...read("OK", 2_460_000) } as ResultOutcome;
    expect(decisionHidingReadout([rev(1, "CARD_READOUT", read("OK", 2_400_000), "r1"), rev(2, "MANUAL_FINISH_TIME_CORRECTION", corrected),
      rev(3, "CARD_READOUT", read("OK", 2_520_000), "r2")])).toEqual({ decision: "FINISH_TIME", status: "OK", elapsedMs: 2_520_000 });
    expect(decisionHidingReadout([rev(1, "MANUAL_DID_NOT_FINISH", dnf), rev(2, "CARD_READOUT", read("MP"), "r1")]))
      .toEqual({ decision: "DNF", status: "MP" });
  });
});
