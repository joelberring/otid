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

  it("exports NT (deltog utan tid) as NotCompeting without time at the IOF boundary (steg 35)", () => {
    const resultList = source("result-list-export.ts");
    expect(resultList).not.toContain("saknar sanningsenlig IOF 3.0-mappning");
    // Steg 38: med avläsning har NotCompeting sträcktiderna fram till sista stämplade kontrollen, aldrig tid.
    expect(resultList).toContain('row.evaluation.status === "NT" ? statusOnly ? { ...shared, status: "OOC", expectedControls: [], splits: [] }');
    expect(resultList).toContain(': { ...shared, status: "OOC", ...partial }');
    const finalization = source("result-finalization-basis.ts");
    expect(finalization).not.toContain('revisionState.governing === "NT"');
    expect(finalization).toContain('if (result.status === "NT") return { ...identity, status: "OOC", ...(result.splits.length === 0 ? { expectedControls: [], splits: [] } : partial) };');
  });

});
