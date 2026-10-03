import { describe, expect, it } from "vitest";
import {
  createDidNotFinishResult,
  DID_NOT_FINISH_POLICY_VERSION,
  DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
  DidNotFinishError,
  resolveManualDidNotFinishResultHead,
  type EvaluationResult,
  type ManualDidNotFinishDecisionReference,
  type ManualDidNotFinishResultHead
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";

const ok: EvaluationResult = {
  status: "OK",
  reason: "COMPLETE",
  entryId,
  classId,
  courseVersionId,
  startTime: "2026-09-01T10:00:00.000Z",
  finishTime: "2026-09-01T10:01:00.000Z",
  elapsedMs: 60_000,
  missingControls: [],
  extraPunches: [99],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
};

const explanations = { missingControls: [] as number[], extraPunches: [] as number[], splits: [] as never[] };

const technicalSources: readonly EvaluationResult[] = [
  ok,
  { ...ok, status: "MP", reason: "MISSING_CONTROL", missingControls: [32] },
  { ...ok, status: "MP", reason: "WRONG_ORDER" },
  { status: "MP", reason: "MISSING_START", entryId, classId, courseVersionId, ...explanations },
  {
    status: "MP", reason: "MISSING_FINISH", entryId, classId, courseVersionId,
    startTime: "2026-09-01T10:00:00.000Z", ...explanations
  },
  {
    status: "MP", reason: "INVALID_TIME_ORDER", entryId, classId, courseVersionId,
    startTime: "invalid-start", finishTime: "invalid-finish", ...explanations
  }
];

describe("createDidNotFinishResult", () => {
  it.each(technicalSources)("skapar endast DNF-identitet från en strikt teknisk %#-källa", (source) => {
    const result = createDidNotFinishResult(source);
    expect(result).toEqual({ status: "DNF", reason: "DID_NOT_FINISH", entryId, classId, courseVersionId });
    expect(Object.keys(result).sort()).toEqual([
      "classId", "courseVersionId", "entryId", "reason", "status"
    ]);
    expect(result).not.toHaveProperty("startTime");
    expect(result).not.toHaveProperty("finishTime");
    expect(result).not.toHaveProperty("elapsedMs");
    expect(result).not.toHaveProperty("missingControls");
    expect(result).not.toHaveProperty("extraPunches");
    expect(result).not.toHaveProperty("splits");
  });

  it.each([
    [{ ...ok, status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD" }, "UNSUPPORTED_SOURCE_STATUS"],
    [{ ...ok, status: "OK", reason: "MANUAL_APPROVAL" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, status: "MP", reason: "COMPLETE" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, entryId: "not-a-uuid" }, "INVALID_SOURCE_IDENTITY"],
    [{ ...ok, elapsedMs: 59_999 }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, missingControls: [32] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, status: "MP", reason: "MISSING_CONTROL", missingControls: [] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, missingControls: [0] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 1 }] }, "INVALID_SOURCE_SHAPE"],
    [{
      status: "MP", reason: "MISSING_FINISH", entryId, classId, courseVersionId,
      startTime: "2026-09-01T10:00:00.000Z", missingControls: [31], extraPunches: [], splits: []
    }, "INVALID_SOURCE_SHAPE"]
  ])("avvisar en motsägande eller manuell runtimekälla", (source, code) => {
    expectDidNotFinishError(() => createDidNotFinishResult(source as EvaluationResult), code);
  });

  it("exponerar den låsta beslutspolicyversionen", () => {
    expect(DID_NOT_FINISH_POLICY_VERSION).toBe("did-not-finish-v1");
  });
});

function head(id: string, revision: number, value = id): ManualDidNotFinishResultHead<string> {
  return { resultRevisionId: id, revision, value };
}

function decision(
  overrides: Partial<ManualDidNotFinishDecisionReference<string>> = {}
): ManualDidNotFinishDecisionReference<string> {
  return {
    id: "decision",
    targetResultRevisionId: "target",
    targetResultRevision: 1,
    didNotFinishResultRevisionId: "dnf",
    didNotFinishResultRevision: 2,
    didNotFinishResultHead: {
      ...head("dnf", 2, "frozen-dnf"),
      didNotFinishDecisionId: "decision"
    },
    withdrawal: null,
    ...overrides
  };
}

function withdrawal(
  overrides: Partial<NonNullable<ManualDidNotFinishDecisionReference<string>["withdrawal"]>> = {}
): NonNullable<ManualDidNotFinishDecisionReference<string>["withdrawal"]> {
  return {
    id: "withdrawal",
    didNotFinishDecisionId: "decision",
    withdrawnResultRevisionId: "dnf",
    withdrawnResultRevision: 2,
    expectedLatestResultRevisionId: "dnf",
    expectedLatestResultRevision: 2,
    restorationSourceResultRevisionId: "target",
    restorationSourceResultRevision: 1,
    restorationResultRevisionId: "restoration",
    restorationResultRevision: 3,
    restorationResultHead: {
      ...head("restoration", 3, "restored-result"),
      didNotFinishWithdrawalId: "withdrawal"
    },
    ...overrides
  };
}

describe("resolveManualDidNotFinishResultHead", () => {
  it("väljer normalt huvud utan beslut och NO_ACTIVE_RESULT utan huvud", () => {
    expect(resolveManualDidNotFinishResultHead(null, null)).toEqual({ state: "NO_ACTIVE_RESULT" });
    expect(resolveManualDidNotFinishResultHead(head("normal", 1), null)).toEqual({
      state: "ACTIVE_RESULT",
      source: "RESULT_HEAD",
      resultHead: head("normal", 1)
    });
  });

  it("håller den frysta DNF-revisionen aktiv över ett senare tekniskt huvud", () => {
    expect(resolveManualDidNotFinishResultHead(head("later", 3), decision())).toEqual({
      state: "ACTIVE_RESULT",
      source: "MANUAL_DID_NOT_FINISH",
      resultHead: {
        ...head("dnf", 2, "frozen-dnf"),
        didNotFinishDecisionId: "decision"
      },
      decisionId: "decision",
      targetResultRevisionId: "target",
      underlyingResultHead: head("later", 3)
    });
  });

  it("avslutar DNF med exakt originaltarget när ingen senare teknik finns", () => {
    expect(resolveManualDidNotFinishResultHead(
      head("restoration", 3, "restored-result"),
      decision({ withdrawal: withdrawal() })
    )).toEqual({
      state: "ACTIVE_RESULT",
      source: "RESULT_HEAD",
      resultHead: head("restoration", 3, "restored-result")
    });
  });

  it("avslutar DNF med exakt senare tekniskt huvud och accepterar ett senare normalt huvud", () => {
    const laterWithdrawal = withdrawal({
      expectedLatestResultRevisionId: "technical-4",
      expectedLatestResultRevision: 4,
      restorationSourceResultRevisionId: "technical-4",
      restorationSourceResultRevision: 4,
      restorationResultRevisionId: "restoration-5",
      restorationResultRevision: 5,
      restorationResultHead: {
        ...head("restoration-5", 5),
        didNotFinishWithdrawalId: "withdrawal"
      }
    });
    expect(resolveManualDidNotFinishResultHead(
      head("technical-6", 6),
      decision({ withdrawal: laterWithdrawal })
    )).toEqual({
      state: "ACTIVE_RESULT",
      source: "RESULT_HEAD",
      resultHead: head("technical-6", 6)
    });
  });

  it.each([
    ["fel decision", withdrawal({ didNotFinishDecisionId: "other" }), "WITHDRAWAL_DECISION_MISMATCH"],
    ["fel DNF-target", withdrawal({ withdrawnResultRevisionId: "other" }), "WITHDRAWAL_RESULT_MISMATCH"],
    ["fallback till originaltarget", withdrawal(), "WITHDRAWAL_RESULT_MISMATCH", head("target", 1)],
    ["hopp över senare teknisk källa", withdrawal({
      expectedLatestResultRevisionId: "technical-4",
      expectedLatestResultRevision: 4
    }), "WITHDRAWAL_SOURCE_MISMATCH"],
    ["senare tekniskt huvud återanvänder target-id", withdrawal({
      expectedLatestResultRevisionId: "target",
      expectedLatestResultRevision: 4,
      restorationSourceResultRevisionId: "target",
      restorationSourceResultRevision: 4,
      restorationResultRevisionId: "restoration-5",
      restorationResultRevision: 5,
      restorationResultHead: {
        ...head("restoration-5", 5),
        didNotFinishWithdrawalId: "withdrawal"
      }
    }), "WITHDRAWAL_SOURCE_MISMATCH", head("restoration-5", 5)],
    ["fel reciprocal restoration", withdrawal({
      restorationResultHead: { ...head("restoration", 3), didNotFinishWithdrawalId: "other" }
    }), "WITHDRAWAL_RESULT_MISMATCH"],
    ["restoration utan direkt succession", withdrawal({
      restorationResultRevision: 4,
      restorationResultHead: { ...head("restoration", 4), didNotFinishWithdrawalId: "withdrawal" }
    }), "WITHDRAWAL_RESULT_MISMATCH"],
    ["restoration återanvänder target-id", withdrawal({
      restorationResultRevisionId: "target",
      restorationResultHead: { ...head("target", 3), didNotFinishWithdrawalId: "withdrawal" }
    }), "WITHDRAWAL_SOURCE_MISMATCH"]
  ])("avvisar korrupt withdrawalprovenans: %s", (_name, corruptWithdrawal, code, selected = head("restoration", 3)) => {
    expectDidNotFinishError(
      () => resolveManualDidNotFinishResultHead(selected, decision({ withdrawal: corruptWithdrawal })),
      code
    );
  });

  it.each([
    ["fel reciprocal decision", decision({
      didNotFinishResultHead: { ...head("dnf", 2), didNotFinishDecisionId: "other" }
    })],
    ["fel reciprocal revisions-id", decision({
      didNotFinishResultHead: { ...head("other", 2), didNotFinishDecisionId: "decision" }
    })],
    ["revision utan direkt succession", decision({ didNotFinishResultRevision: 3,
      didNotFinishResultHead: { ...head("dnf", 3), didNotFinishDecisionId: "decision" } })],
    ["samma target och DNF", decision({ targetResultRevisionId: "dnf" })]
  ])("avvisar korrupt provenans: %s", (_name, corruptDecision) => {
    expectDidNotFinishError(
      () => resolveManualDidNotFinishResultHead(head("later", 4), corruptDecision),
      "DID_NOT_FINISH_RESULT_MISMATCH"
    );
  });

  it("avvisar ogiltiga fysiska resultathuvuden fail closed", () => {
    expectDidNotFinishError(
      () => resolveManualDidNotFinishResultHead(head("", 1), null),
      "INVALID_RESULT_HEAD"
    );
    expectDidNotFinishError(
      () => resolveManualDidNotFinishResultHead(head("normal", 1), decision({ targetResultRevision: 0 })),
      "INVALID_DID_NOT_FINISH_DECISION"
    );
  });

  it("exponerar den låsta withdrawalpolicyversionen", () => {
    expect(DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION).toBe("did-not-finish-withdrawal-v1");
  });
});

function expectDidNotFinishError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den ogiltiga DNF-källan skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(DidNotFinishError);
    if (error instanceof DidNotFinishError) expect(error.code).toBe(code);
  }
}
