import { describe, expect, it } from "vitest";
import type { EvaluationResult } from "@o-tid/domain";
import { evaluationHash } from "../src/hash";

describe("evaluationHash", () => {
  it("hashar canonical JSON av hela runtimevaliderade bedömningen", () => {
    const evaluation: EvaluationResult = {
      status: "UNKNOWN_CARD",
      reason: "UNKNOWN_CARD",
      missingControls: [],
      extraPunches: [45],
      splits: []
    };
    const reordered = {
      splits: [],
      extraPunches: [45],
      missingControls: [],
      reason: "UNKNOWN_CARD",
      status: "UNKNOWN_CARD"
    } as const satisfies EvaluationResult;

    expect(evaluationHash(reordered)).toBe(evaluationHash(evaluation));
    expect(evaluationHash({ ...evaluation, extraPunches: [46] })).not.toBe(evaluationHash(evaluation));
    expect(evaluationHash(evaluation)).toMatch(/^[a-f0-9]{64}$/);
  });
});
