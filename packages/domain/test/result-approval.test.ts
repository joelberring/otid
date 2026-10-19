import { describe, expect, it } from "vitest";
import {
  createManuallyApprovedResult,
  ResultApprovalError,
  type EvaluationResult,
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

function expectApprovalError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den motsägande approvalprojektionen skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(ResultApprovalError);
    if (error instanceof ResultApprovalError) expect(error.code).toBe(code);
  }
}
