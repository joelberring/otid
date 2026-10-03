import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
}

describe("TASK 006I/006J/006K/006M DNF projection policy", () => {
  it("publishes current format 7 from the centrally resolved DNF head", () => {
    const results = source("results.ts");
    expect(results).toContain("resolveStoredResultHeadStates(tx, raceId, rows)");
    expect(results).toContain("didNotFinishDecisionId: schema.resultRevisions.didNotFinishDecisionId");
    expect(results).toMatch(/publicResultListResponseSchema\.parse\(\{\s*formatVersion: 7,/);
  });

  it("keeps Snapshot DNF status-only at the IOF boundary", () => {
    const resultList = source("result-list-export.ts");
    expect(resultList).toContain('row.evaluation.status === "DNS" || row.evaluation.status === "DNF"');
    expect(resultList).toContain('? { ...shared, status: "DNF" }');
    expect(resultList).toContain('if (result.status === "DNF" || result.status === "OOC")');
  });

  it("exposes current format 10 readout history with immutable withdrawal provenance", () => {
    const history = source("readout-result-history.ts");
    expect(history.match(/formatVersion: 10/g)?.length).toBe(3);
    expect(history).toContain('kind: "MANUAL_DID_NOT_FINISH" as const');
    expect(history).toContain('kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const');
    expect(history).toContain("didNotFinishDecisionId: decision.id");
    expect(history).toContain("targetResultRevisionId: decision.targetResultRevisionId");
    expect(history).toContain("restorationSourceResultRevisionId: withdrawal.restoredFromResultRevisionId");
  });

  it("freezes current format 9 provenance including withdrawals and the absolute selected head", () => {
    const finalization = source("result-finalization.ts");
    expect(finalization).toContain('kind: "MANUAL_DID_NOT_FINISH"');
    expect(finalization).toContain('kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL"');
    expect(finalization).toContain("absoluteResultRevisionId: revisionState.selectedHead.id");
    expect(finalization).toContain("absoluteResultRevision: revisionState.selectedHead.revision");
    expect(finalization).toContain("didNotFinishWithdrawalId: revisionState.didNotFinish.withdrawal.id");
    expect(finalization).toContain('if (result.status === "DNF") return { ...identity, status: "DNF" }');
    expect(finalization.match(/formatVersion: 9/g)?.length).toBe(4);
  });
});
