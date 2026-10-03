import { describe, expect, it } from "vitest";
import {
  createDisqualifiedResult,
  resolveManualDisqualificationResultHead,
  ResultDisqualificationError,
  type DisqualifiableResult,
  type ManualDisqualificationDecisionReference,
  type ManualDisqualificationResultHead
} from "../src";

const entryId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000003";

const ok: DisqualifiableResult = {
  status: "OK",
  reason: "COMPLETE",
  entryId,
  classId,
  courseVersionId,
  startTime: "2026-08-31T10:00:00.000Z",
  finishTime: "2026-08-31T10:01:00.000Z",
  elapsedMs: 60_000,
  missingControls: [],
  extraPunches: [99],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
};

function head(id: string, revision: number, value = id): ManualDisqualificationResultHead<string> {
  return { resultRevisionId: id, revision, value };
}

function decision(
  withdrawal: ManualDisqualificationDecisionReference<string>["withdrawal"] = null
): ManualDisqualificationDecisionReference<string> {
  return {
    id: "decision",
    targetResultRevisionId: "target",
    disqualifiedResultHead: head("dsq", 2, "frozen-dsq"),
    withdrawal
  };
}

describe("createDisqualifiedResult", () => {
  const explanations = { missingControls: [45], extraPunches: [99], splits: [] };
  const mpSources: readonly [string, DisqualifiableResult][] = [
    ["MISSING_START", { status: "MP", reason: "MISSING_START", entryId, classId, courseVersionId, ...explanations }],
    ["MISSING_FINISH", { status: "MP", reason: "MISSING_FINISH", entryId, classId, courseVersionId,
      startTime: "2026-08-31T10:00:00.000Z", ...explanations }],
    ["INVALID_TIME_ORDER", { status: "MP", reason: "INVALID_TIME_ORDER", entryId, classId, courseVersionId,
      startTime: "2026-08-31T10:01:00.000Z", finishTime: "2026-08-31T10:00:00.000Z", ...explanations }],
    ["MISSING_CONTROL", { ...ok, status: "MP", reason: "MISSING_CONTROL", missingControls: [45] }],
    ["WRONG_ORDER", { ...ok, status: "MP", reason: "WRONG_ORDER" }]
  ];

  it.each([["OK", ok] as const, ...mpSources])(
    "kopierar alla källfakta exakt för %s och ändrar bara status/orsak",
    (_name, source) => {
    const result = createDisqualifiedResult(source);
    expect(result).toEqual({ ...source, status: "DSQ", reason: "MANUAL_DISQUALIFICATION" });
    expect(result.missingControls).not.toBe(source.missingControls);
    expect(result.extraPunches).not.toBe(source.extraPunches);
    expect(result.splits).not.toBe(source.splits);
    }
  );

  it.each([
    [{ ...ok, status: "UNKNOWN_CARD" }, "UNSUPPORTED_SOURCE_STATUS"],
    [{ ...ok, status: "MP", reason: "COMPLETE" }, "INVALID_SOURCE_REASON"],
    [{ ...ok, entryId: " " }, "INVALID_SOURCE_IDENTITY"]
  ])("avvisar en runtimeogiltig lagrad källa", (source, code) => {
    expect(() => createDisqualifiedResult(source as DisqualifiableResult)).toThrowError(ResultDisqualificationError);
    try {
      createDisqualifiedResult(source as DisqualifiableResult);
    } catch (error) {
      expect((error as ResultDisqualificationError).code).toBe(code);
    }
  });
});

describe("resolveManualDisqualificationResultHead", () => {
  it("väljer normalt huvud utan beslut och NO_ACTIVE_RESULT utan huvud", () => {
    expect(resolveManualDisqualificationResultHead(null, null)).toEqual({ state: "NO_ACTIVE_RESULT" });
    expect(resolveManualDisqualificationResultHead(head("normal", 1), null)).toEqual({
      state: "ACTIVE_RESULT",
      source: "RESULT_HEAD",
      resultHead: head("normal", 1)
    });
  });

  it("håller den frysta DSQ-revisionen aktiv över ett senare tekniskt huvud", () => {
    expect(resolveManualDisqualificationResultHead(head("later", 3), decision())).toEqual({
      state: "ACTIVE_RESULT",
      source: "MANUAL_DISQUALIFICATION",
      resultHead: head("dsq", 2, "frozen-dsq"),
      decisionId: "decision",
      underlyingResultHead: head("later", 3)
    });
  });

  it("accepterar exakt restaureringshuvud och senare tekniskt huvud efter withdrawal", () => {
    const withdrawn = decision({
      id: "withdrawal",
      resultDisqualificationDecisionId: "decision",
      disqualifiedResultRevisionId: "dsq",
      restorationResultRevisionId: "restored",
      restorationResultRevision: 4
    });
    expect(resolveManualDisqualificationResultHead(head("restored", 4), withdrawn)).toMatchObject({
      source: "RESULT_HEAD", resultHead: head("restored", 4)
    });
    expect(resolveManualDisqualificationResultHead(head("technical", 5), withdrawn)).toMatchObject({
      source: "RESULT_HEAD", resultHead: head("technical", 5)
    });
  });

  it("avvisar historisk fallback och bruten withdrawalprovenans", () => {
    const baseWithdrawal = {
      id: "withdrawal",
      resultDisqualificationDecisionId: "decision",
      disqualifiedResultRevisionId: "dsq",
      restorationResultRevisionId: "restored",
      restorationResultRevision: 4
    };
    expect(() => resolveManualDisqualificationResultHead(head("old", 3), decision(baseWithdrawal)))
      .toThrowError(ResultDisqualificationError);
    expect(() => resolveManualDisqualificationResultHead(head("restored", 4), decision({
      ...baseWithdrawal,
      resultDisqualificationDecisionId: "other"
    }))).toThrowError(ResultDisqualificationError);
  });
});
