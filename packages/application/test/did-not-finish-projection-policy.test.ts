import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
}

describe("TASK 006I/006J/006K/006M DNF projection policy", () => {
  it("publishes current format 7 from the centrally resolved DNF head", () => {
    const results = source("results.ts");
    expect(results).toContain("resolveStoredResultHeadStates(tx, raceId, rows)");
    // Steg 51: svaret prövas mot format 7 (raderna var för sig i `publicRow`).
    expect(results).toMatch(/publicResultListResponseV7Schema\.parse\(\{\s*formatVersion: 7,/);
  });

  it("keeps Snapshot DNF status-only at the IOF boundary", () => {
    const resultList = source("result-list-export.ts");
    // Steg 38: DNF utan sträcktider är bara status; med avläsning sträcktider fram till sista stämplade kontrollen.
    expect(resultList).toContain('(row.evaluation.status === "DNF" || row.evaluation.status === "NT") && storedSplits.length === 0');
    expect(resultList).toContain('? statusOnly ? { ...shared, status: "DNF" } : { ...shared, status: "DNF", ...partial }');
    expect(resultList).toContain('if (result.status === "DNF" || result.status === "OOC")');
  });

  it("freezes current format 9 provenance including withdrawals and the absolute selected head", () => {
    const finalization = source("result-finalization.ts") + source("result-finalization-basis.ts");
    expect(finalization).toContain('kind: "MANUAL_DECISION"');
    expect(finalization).toContain("absoluteResultRevisionId: absoluteRevision.id");
    expect(finalization).toContain("absoluteResultRevision: absoluteRevision.revision");
    expect(finalization).toContain("underlyingResultRevisionId: revisionState.underlyingId");
    expect(finalization).toContain('if (result.status === "DNF") return result.splits.length === 0 ? { ...identity, status: "DNF" }');
    expect(finalization.match(/formatVersion: 9/g)?.length).toBe(4);
  });
});
