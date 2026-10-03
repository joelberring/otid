import { describe, expect, it } from "vitest";
import {
  createOutOfCompetitionResult,
  OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
  OutOfCompetitionError,
  resolveManualOutOfCompetitionResultHead,
  type EvaluationResult,
  type ManualOutOfCompetitionDecisionReference,
  type ManualOutOfCompetitionResultHead
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

describe("createOutOfCompetitionResult", () => {
  it.each(technicalSources)("deep-kopierar en strikt teknisk %#-källa och ändrar bara status/reason", (source) => {
    const result = createOutOfCompetitionResult(source);
    expect(result).toEqual({
      ...source,
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      missingControls: [...source.missingControls],
      extraPunches: [...source.extraPunches],
      splits: source.splits.map((split) => ({ ...split }))
    });
    expect(result.missingControls).not.toBe(source.missingControls);
    expect(result.extraPunches).not.toBe(source.extraPunches);
    expect(result.splits).not.toBe(source.splits);
    if (source.splits[0]) expect(result.splits[0]).not.toBe(source.splits[0]);
  });

  it.each([
    [{ ...ok, status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD" }, "UNSUPPORTED_SOURCE_STATUS"],
    [{ ...ok, status: "OK", reason: "MANUAL_APPROVAL" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, status: "MP", reason: "COMPLETE" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, entryId: "not-a-uuid" }, "INVALID_SOURCE_IDENTITY"],
    [{ ...ok, elapsedMs: 59_999 }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, missingControls: [32] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, status: "MP", reason: "MISSING_CONTROL", missingControls: [] }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, extra: true }, "INVALID_SOURCE_SHAPE"],
    [{ ...ok, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 1 }] }, "INVALID_SOURCE_SHAPE"],
    [{
      status: "MP", reason: "INVALID_TIME_ORDER", entryId, classId, courseVersionId,
      startTime: "x".repeat(65), finishTime: "invalid-finish", ...explanations
    }, "INVALID_SOURCE_SHAPE"],
    [{
      status: "MP", reason: "MISSING_FINISH", entryId, classId, courseVersionId,
      startTime: "2026-09-01T10:00:00.000Z", missingControls: [31], extraPunches: [], splits: []
    }, "INVALID_SOURCE_SHAPE"]
  ])("avvisar motsägande, manuell eller icke-canonical runtimekälla", (source, code) => {
    expectOutOfCompetitionError(() => createOutOfCompetitionResult(source as EvaluationResult), code);
  });

  it("exponerar den låsta policyversionen", () => {
    expect(OUT_OF_COMPETITION_DECISION_POLICY_VERSION).toBe("out-of-competition-v1");
  });
});

function head(id: string, revision: number, value = id): ManualOutOfCompetitionResultHead<string> {
  return { resultRevisionId: id, revision, value };
}

function decision(
  overrides: Partial<ManualOutOfCompetitionDecisionReference<string>> = {}
): ManualOutOfCompetitionDecisionReference<string> {
  return {
    id: "decision",
    targetResultRevisionId: "target",
    targetResultRevision: 1,
    outOfCompetitionResultRevisionId: "ooc",
    outOfCompetitionResultRevision: 2,
    outOfCompetitionResultHead: {
      ...head("ooc", 2, "frozen-ooc"),
      notCompetingDecisionId: "decision"
    },
    ...overrides
  };
}

describe("resolveManualOutOfCompetitionResultHead", () => {
  it("väljer normalt huvud utan beslut och NO_ACTIVE_RESULT utan huvud", () => {
    expect(resolveManualOutOfCompetitionResultHead(null, null)).toEqual({ state: "NO_ACTIVE_RESULT" });
    expect(resolveManualOutOfCompetitionResultHead(head("normal", 1), null)).toEqual({
      state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: head("normal", 1)
    });
  });

  it.each([head("ooc", 2, "physical-ooc"), head("later-technical", 3)])(
    "håller den frysta OOC-revisionen aktiv över ett giltigt fysiskt huvud",
    (selected) => {
      expect(resolveManualOutOfCompetitionResultHead(selected, decision())).toEqual({
        state: "ACTIVE_RESULT",
        source: "MANUAL_OUT_OF_COMPETITION",
        resultHead: { ...head("ooc", 2, "frozen-ooc"), notCompetingDecisionId: "decision" },
        decisionId: "decision",
        targetResultRevisionId: "target",
        underlyingResultHead: selected
      });
    }
  );

  it.each([
    ["saknat fysiskt huvud", null, decision(), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["fallback till target", head("target", 1), decision(), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["senare huvud återanvänder target-id", head("target", 3), decision(), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["fel reciprocal decision", head("ooc", 2), decision({
      outOfCompetitionResultHead: { ...head("ooc", 2), notCompetingDecisionId: "other" }
    }), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["fel reciprocal result-id", head("ooc", 2), decision({
      outOfCompetitionResultHead: { ...head("other", 2), notCompetingDecisionId: "decision" }
    }), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["revision utan direkt succession", head("ooc", 3), decision({
      outOfCompetitionResultRevision: 3,
      outOfCompetitionResultHead: { ...head("ooc", 3), notCompetingDecisionId: "decision" }
    }), "OUT_OF_COMPETITION_RESULT_MISMATCH"],
    ["samma target och OOC", head("ooc", 2), decision({ targetResultRevisionId: "ooc" }),
      "OUT_OF_COMPETITION_RESULT_MISMATCH"]
  ])("avvisar korrupt provenans: %s", (_name, selected, corruptDecision, code) => {
    expectOutOfCompetitionError(
      () => resolveManualOutOfCompetitionResultHead(selected, corruptDecision),
      code
    );
  });

  it("avvisar ogiltiga identiteter fail closed", () => {
    expectOutOfCompetitionError(
      () => resolveManualOutOfCompetitionResultHead(head("", 1), null),
      "INVALID_RESULT_HEAD"
    );
    expectOutOfCompetitionError(
      () => resolveManualOutOfCompetitionResultHead(head("ooc", 2), decision({ targetResultRevision: 0 })),
      "INVALID_OUT_OF_COMPETITION_DECISION"
    );
  });

  it("släpper endast den reciproka restaureringen efter explicit OOC-återtagande", () => {
    const withdrawal = {
      id: "withdrawal",
      notCompetingDecisionId: "decision",
      withdrawnResultRevisionId: "ooc",
      withdrawnResultRevision: 2,
      expectedLatestResultRevisionId: "ooc",
      expectedLatestResultRevision: 2,
      restorationSourceResultRevisionId: "target",
      restorationSourceResultRevision: 1,
      restorationResultRevisionId: "restoration",
      restorationResultRevision: 3,
      restorationResultHead: {
        ...head("restoration", 3, "restored"),
        notCompetingWithdrawalId: "withdrawal"
      }
    };
    expect(resolveManualOutOfCompetitionResultHead(head("restoration", 3, "restored"), decision({ withdrawal })))
      .toEqual({ state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: head("restoration", 3, "restored") });
    expectOutOfCompetitionError(
      () => resolveManualOutOfCompetitionResultHead(head("ooc", 2), decision({ withdrawal })),
      "WITHDRAWAL_RESULT_MISMATCH"
    );
  });

  it("avvisar withdrawal som söker bakåt eller bryter reciprocal provenance", () => {
    const withdrawal = {
      id: "withdrawal",
      notCompetingDecisionId: "decision",
      withdrawnResultRevisionId: "ooc",
      withdrawnResultRevision: 2,
      expectedLatestResultRevisionId: "later",
      expectedLatestResultRevision: 4,
      restorationSourceResultRevisionId: "target",
      restorationSourceResultRevision: 1,
      restorationResultRevisionId: "restoration",
      restorationResultRevision: 5,
      restorationResultHead: {
        ...head("restoration", 5),
        notCompetingWithdrawalId: "withdrawal"
      }
    };
    expectOutOfCompetitionError(
      () => resolveManualOutOfCompetitionResultHead(head("restoration", 5), decision({ withdrawal })),
      "WITHDRAWAL_SOURCE_MISMATCH"
    );
  });
});

function expectOutOfCompetitionError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den ogiltiga OOC-källan skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(OutOfCompetitionError);
    if (error instanceof OutOfCompetitionError) expect(error.code).toBe(code);
  }
}
