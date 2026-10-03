import { describe, expect, it } from "vitest";
import {
  createManuallyApprovedResult,
  MANUAL_RESULT_APPROVAL_POLICY_VERSION,
  MANUAL_RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION,
  resolveManualResultApprovalResultHead,
  ResultApprovalError,
  type EvaluationResult,
  type ManualResultApprovalDecisionReference,
  type ManualResultApprovalResultHead
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";

const timedMp: EvaluationResult = {
  status: "MP",
  reason: "MISSING_CONTROL",
  entryId,
  classId,
  courseVersionId,
  startTime: "2026-09-01T10:00:00.000Z",
  finishTime: "2026-09-01T10:01:00.000Z",
  elapsedMs: 60_000,
  missingControls: [32],
  extraPunches: [99],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
};

function head(id: string, revision: number, value = id): ManualResultApprovalResultHead<string> {
  return { resultRevisionId: id, revision, value };
}

function decision(
  withdrawal: ManualResultApprovalDecisionReference<string>["withdrawal"] = null
): ManualResultApprovalDecisionReference<string> {
  return {
    id: "decision",
    targetResultRevisionId: "target",
    approvedResultHead: head("approval", 2, "frozen-approval"),
    withdrawal
  };
}

describe("createManuallyApprovedResult", () => {
  it.each([
    timedMp,
    { ...timedMp, reason: "WRONG_ORDER" as const, missingControls: [] }
  ])("deep-kopierar tidskomplett %s utan att fabricera fakta", (source) => {
    const approved = createManuallyApprovedResult(source);
    expect(approved).toEqual({ ...source, status: "OK", reason: "MANUAL_APPROVAL" });
    expect(approved.missingControls).not.toBe(source.missingControls);
    expect(approved.extraPunches).not.toBe(source.extraPunches);
    expect(approved.splits).not.toBe(source.splits);
  });

  it.each([
    [{ ...timedMp, status: "OK" }, "UNSUPPORTED_SOURCE_STATUS"],
    [{ ...timedMp, reason: "MISSING_START", startTime: undefined }, "UNSUPPORTED_SOURCE_REASON"],
    [{ ...timedMp, finishTime: "2026-09-01T10:01:01.000Z" }, "INVALID_SOURCE_TIME"],
    [{ ...timedMp, startTime: "2026-09-01 10:00:00" }, "INVALID_SOURCE_TIME"],
    [{ ...timedMp, entryId: "not-a-uuid" }, "INVALID_SOURCE_IDENTITY"],
    [{ ...timedMp, missingControls: [0] }, "INVALID_SOURCE_EXPLANATION"],
    [{ ...timedMp, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 29_999 }] }, "INVALID_SOURCE_SPLITS"]
  ])("avvisar en icke-godkännbar MP-källa fail closed", (source, code) => {
    expectApprovalError(() => createManuallyApprovedResult(source as EvaluationResult), code);
  });
});

describe("resolveManualResultApprovalResultHead", () => {
  it("använder normalt huvud utan beslut men persistent approval över senare teknik", () => {
    expect(resolveManualResultApprovalResultHead(head("normal", 1), null)).toMatchObject({
      source: "RESULT_HEAD", resultHead: head("normal", 1)
    });
    expect(resolveManualResultApprovalResultHead(head("later-technical", 3), decision())).toEqual({
      state: "ACTIVE_RESULT",
      source: "MANUAL_RESULT_APPROVAL",
      resultHead: head("approval", 2, "frozen-approval"),
      decisionId: "decision",
      underlyingResultHead: head("later-technical", 3)
    });
  });

  it("släpper bara overlayn för exakt restaureringsrevision eller senare huvud", () => {
    const withdrawn = decision({
      id: "withdrawal",
      resultApprovalDecisionId: "decision",
      approvedResultRevisionId: "approval",
      restorationResultRevisionId: "restored",
      restorationResultRevision: 4
    });
    expect(resolveManualResultApprovalResultHead(head("restored", 4), withdrawn)).toMatchObject({
      source: "RESULT_HEAD", resultHead: head("restored", 4)
    });
    expect(resolveManualResultApprovalResultHead(head("technical", 5), withdrawn)).toMatchObject({
      source: "RESULT_HEAD", resultHead: head("technical", 5)
    });
  });

  it("avvisar fallback och bruten withdrawalproveniens", () => {
    const withdrawal = {
      id: "withdrawal",
      resultApprovalDecisionId: "decision",
      approvedResultRevisionId: "approval",
      restorationResultRevisionId: "restored",
      restorationResultRevision: 4
    };
    expectApprovalError(
      () => resolveManualResultApprovalResultHead(head("old", 3), decision(withdrawal)),
      "WITHDRAWAL_RESULT_MISMATCH"
    );
    expectApprovalError(
      () => resolveManualResultApprovalResultHead(head("restored", 4), decision({
        ...withdrawal,
        resultApprovalDecisionId: "other"
      })),
      "WITHDRAWAL_DECISION_MISMATCH"
    );
  });

  it("exponerar de två separata policyversionerna", () => {
    expect(MANUAL_RESULT_APPROVAL_POLICY_VERSION).toBe("manual-result-approval-v1");
    expect(MANUAL_RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION).toBe("manual-result-approval-withdrawal-v1");
  });
});

function expectApprovalError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den motsägande approvalprojektionen skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(ResultApprovalError);
    if (error instanceof ResultApprovalError) expect(error.code).toBe(code);
  }
}
