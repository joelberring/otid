import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
}

describe("TASK 006M projection policy", () => {
  it("publishes current format 7 from the central NT overlay", () => {
    const results = source("results.ts");
    expect(results).toContain("resolveStoredResultHeadStates(tx, raceId, rows)");
    expect(results).toMatch(/publicResultListResponseSchema\.parse\(\{\s*formatVersion: 7,/);
  });

  it("fails Snapshot and finalization closed instead of inventing IOF status", () => {
    const resultList = source("result-list-export.ts");
    expect(resultList).toContain('state.governing === "NT"');
    expect(resultList).toContain("saknar sanningsenlig IOF 3.0-mappning");
    const finalization = source("result-finalization.ts") + source("result-finalization-basis.ts");
    expect(finalization).toContain('revisionState.governing === "NT"');
    expect(finalization).toContain('blockers.add("INVALID_RESULT_REVISION")');
    expect(finalization).not.toContain('status: "NT"');
  });

});
