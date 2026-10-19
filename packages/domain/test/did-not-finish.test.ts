import { describe, expect, it } from "vitest";
import {
  createDidNotFinishResult,
  DID_NOT_FINISH_POLICY_VERSION,
  DidNotFinishError,
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

function expectDidNotFinishError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den ogiltiga DNF-källan skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(DidNotFinishError);
    if (error instanceof DidNotFinishError) expect(error.code).toBe(code);
  }
}
