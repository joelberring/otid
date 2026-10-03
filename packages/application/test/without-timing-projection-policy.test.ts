import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
}

describe("TASK 006M projection policy", () => {
  it("publishes current format 7 from the central NT overlay", () => {
    const results = source("results.ts");
    expect(results).toContain("resolveStoredResultHeadStates(tx, raceId, rows)");
    expect(results).toContain("withoutTimingDecisionId: schema.resultRevisions.withoutTimingDecisionId");
    expect(results).toMatch(/publicResultListResponseSchema\.parse\(\{\s*formatVersion: 7,/);
  });

  it("fails Snapshot and finalization closed instead of inventing IOF status", () => {
    const resultList = source("result-list-export.ts");
    expect(resultList).toContain("state.withoutTiming?.withdrawal === null");
    expect(resultList).toContain("saknar sanningsenlig IOF 3.0-mappning");
    const finalization = source("result-finalization.ts");
    expect(finalization).toContain("revisionState.withoutTiming?.withdrawal === null");
    expect(finalization).toContain('blockers.add("INVALID_RESULT_REVISION")');
    expect(finalization).not.toContain('status: "NT"');
  });

  it("exposes history format 10 with decision, withdrawal and exact target provenance", () => {
    const history = source("readout-result-history.ts");
    expect(history.match(/formatVersion: 10/g)?.length).toBe(3);
    expect(history).toContain('kind: "MANUAL_WITHOUT_TIMING" as const');
    expect(history).toContain('kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL" as const');
    expect(history).toContain("withoutTimingDecisionId: decision.id");
    expect(history).toContain("targetResultRevisionId: decision.targetResultRevisionId");
    expect(history).toContain("withoutTimingWithdrawalId: withdrawal.id");
  });
});
