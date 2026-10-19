import { describe, expect, it } from "vitest";
import {
  createDisqualifiedResult,
  ResultDisqualificationError,
  type DisqualifiableResult,
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

