import { describe, expect, it } from "vitest";
import {
  createWithoutTimingResult,
  resolveManualWithoutTimingResultHead,
  WITHOUT_TIMING_DECISION_POLICY_VERSION,
  WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION,
  WithoutTimingError,
  type EvaluationResult,
  type ManualWithoutTimingDecisionReference,
  type ManualWithoutTimingResultHead
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";
const ok: EvaluationResult = {
  status: "OK", reason: "COMPLETE", entryId, classId, courseVersionId,
  startTime: "2026-09-01T10:00:00.000Z", finishTime: "2026-09-01T10:01:00.000Z", elapsedMs: 60_000,
  missingControls: [], extraPunches: [], splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
};

describe("createWithoutTimingResult", () => {
  it("skapar ett rent status-only NT från strikt tekniskt OK/COMPLETE", () => {
    expect(createWithoutTimingResult(ok)).toEqual({ status: "NT", reason: "WITHOUT_TIMING", entryId, classId, courseVersionId });
  });

  it.each([
    [{ ...ok, status: "MP", reason: "MISSING_CONTROL", missingControls: [31] }, "UNSUPPORTED_SOURCE_STATUS"],
    [{ ...ok, reason: "MANUAL_APPROVAL" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, entryId: "invalid" }, "INVALID_SOURCE_IDENTITY"],
    [{ ...ok, elapsedMs: 59_999 }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, missingControls: [31] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, extra: true }, "INVALID_SOURCE_SHAPE"]
  ])("avvisar allt som inte är exakt direkt tekniskt OK/COMPLETE", (source, code) => {
    expectWithoutTimingError(() => createWithoutTimingResult(source as EvaluationResult), code);
  });

  it("exponerar den låsta policyversionen", () => {
    expect(WITHOUT_TIMING_DECISION_POLICY_VERSION).toBe("without-timing-v1");
  });
});

function head(id: string, revision: number, value = id): ManualWithoutTimingResultHead<string> {
  return { resultRevisionId: id, revision, value };
}

function decision(overrides: Partial<ManualWithoutTimingDecisionReference<string>> = {}): ManualWithoutTimingDecisionReference<string> {
  return {
    id: "decision", targetResultRevisionId: "target", targetResultRevision: 1,
    withoutTimingResultRevisionId: "nt", withoutTimingResultRevision: 2,
    withoutTimingResultHead: { ...head("nt", 2, "frozen-nt"), withoutTimingDecisionId: "decision" },
    withdrawal: null,
    ...overrides
  };
}

describe("resolveManualWithoutTimingResultHead", () => {
  it("bevarar den permanenta NT-övertäckningen över senare fysiska huvuden", () => {
    expect(resolveManualWithoutTimingResultHead(null, null)).toEqual({ state: "NO_ACTIVE_RESULT" });
    expect(resolveManualWithoutTimingResultHead(head("technical", 1), null)).toEqual({
      state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: head("technical", 1)
    });
    expect(resolveManualWithoutTimingResultHead(head("later", 3), decision())).toEqual({
      state: "ACTIVE_RESULT", source: "MANUAL_WITHOUT_TIMING",
      resultHead: { ...head("nt", 2, "frozen-nt"), withoutTimingDecisionId: "decision" },
      decisionId: "decision", targetResultRevisionId: "target", underlyingResultHead: head("later", 3)
    });
  });

  it("återställer utan senare teknik och väljer aldrig target genom fallback", () => {
    const withdrawn = decision({
      withdrawal: {
        id: "withdrawal", withoutTimingDecisionId: "decision",
        withdrawnResultRevisionId: "nt", withdrawnResultRevision: 2,
        expectedLatestResultRevisionId: "nt", expectedLatestResultRevision: 2,
        restorationSourceResultRevisionId: "target", restorationSourceResultRevision: 1,
        restorationResultRevisionId: "restoration", restorationResultRevision: 3,
        restorationResultHead: { ...head("restoration", 3, "restored"), withoutTimingWithdrawalId: "withdrawal" }
      }
    });
    expect(resolveManualWithoutTimingResultHead(head("restoration", 3, "restored"), withdrawn)).toEqual({
      state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: head("restoration", 3, "restored")
    });
    expectWithoutTimingError(
      () => resolveManualWithoutTimingResultHead(head("target", 1), withdrawn),
      "WITHDRAWAL_RESULT_MISMATCH"
    );
  });

  it("återställer en exakt senare teknisk källa och avvisar bruten reciprocal provenance", () => {
    const withdrawn = decision({
      withdrawal: {
        id: "withdrawal", withoutTimingDecisionId: "decision",
        withdrawnResultRevisionId: "nt", withdrawnResultRevision: 2,
        expectedLatestResultRevisionId: "later", expectedLatestResultRevision: 4,
        restorationSourceResultRevisionId: "later", restorationSourceResultRevision: 4,
        restorationResultRevisionId: "restoration", restorationResultRevision: 5,
        restorationResultHead: { ...head("restoration", 5, "restored"), withoutTimingWithdrawalId: "withdrawal" }
      }
    });
    expect(resolveManualWithoutTimingResultHead(head("later-after", 6), withdrawn)).toEqual({
      state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: head("later-after", 6)
    });
    expectWithoutTimingError(
      () => resolveManualWithoutTimingResultHead(head("restoration", 5), decision({
        withdrawal: { ...withdrawn.withdrawal!, restorationSourceResultRevisionId: "target", restorationSourceResultRevision: 1 }
      })),
      "WITHDRAWAL_SOURCE_MISMATCH"
    );
  });

  it.each([
    [null, decision(), "WITHOUT_TIMING_RESULT_MISMATCH"],
    [head("target", 1), decision(), "WITHOUT_TIMING_RESULT_MISMATCH"],
    [head("nt", 2), decision({ withoutTimingResultHead: { ...head("nt", 2), withoutTimingDecisionId: "other" } }), "WITHOUT_TIMING_RESULT_MISMATCH"],
    [head("nt", 3), decision({ withoutTimingResultRevision: 3, withoutTimingResultHead: { ...head("nt", 3), withoutTimingDecisionId: "decision" } }), "WITHOUT_TIMING_RESULT_MISMATCH"]
  ])("fail-closed vid korrupt permanent NT-provenans", (selected, invalidDecision, code) => {
    expectWithoutTimingError(() => resolveManualWithoutTimingResultHead(selected, invalidDecision), code);
  });

  it("exponerar den låsta withdrawal-policyversionen", () => {
    expect(WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION).toBe("without-timing-withdrawal-v1");
  });
});

function expectWithoutTimingError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Ogiltig utan-tidtagning-operation accepterades");
  } catch (error) {
    expect(error).toBeInstanceOf(WithoutTimingError);
    expect((error as WithoutTimingError).code).toBe(code);
  }
}
