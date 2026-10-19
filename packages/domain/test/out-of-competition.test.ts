import { describe, expect, it } from "vitest";
import {
  createOutOfCompetitionResult,
  OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
  OutOfCompetitionError,
  type EvaluationResult,
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

function expectOutOfCompetitionError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den ogiltiga OOC-källan skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(OutOfCompetitionError);
    if (error instanceof OutOfCompetitionError) expect(error.code).toBe(code);
  }
}
