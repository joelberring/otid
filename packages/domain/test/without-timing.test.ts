import { describe, expect, it } from "vitest";
import {
  createWithoutTimingResult,
  WITHOUT_TIMING_DECISION_POLICY_VERSION,
  WithoutTimingError,
  type EvaluationResult,
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

function expectWithoutTimingError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Ogiltig utan-tidtagning-operation accepterades");
  } catch (error) {
    expect(error).toBeInstanceOf(WithoutTimingError);
    expect((error as WithoutTimingError).code).toBe(code);
  }
}
