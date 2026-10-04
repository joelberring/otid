import { describe, expect, it } from "vitest";
import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import { availableStatusChoices, isStatusChoice } from "./participant-status-choices";

const id = "10000000-0000-4000-8000-000000000001";
const common = { formatVersion: 1 as const, raceId: id, entryId: id, history: [], entryVersion: 1, currentClassId: id,
  snapshotVersion: 3, generatedAt: "2026-10-04T12:00:00.000Z", timeZone: "Europe/Stockholm" };
const active = (status: "OK" | "MP" | "DSQ", governingDecision: "NONE" | "DSQ" | "APPROVAL"): AdministratorEffectiveResultResponse => ({
  ...common, state: "ACTIVE_RESULT", selectedRevision: { id, revision: 2 }, resultClass: { id, name: "H21" },
  resultSnapshotVersion: 3, resultCurrent: true, governingDecision,
  result: status === "DSQ" ? { revision: 2, status, reason: "MANUAL_DISQUALIFICATION" }
    : status === "MP" ? { revision: 2, status, reason: "MISSING_CONTROL" }
      : { revision: 2, status, reason: governingDecision === "APPROVAL" ? "MANUAL_APPROVAL" : "COMPLETE", elapsedMs: 1000 }
} as AdministratorEffectiveResultResponse);

describe("Ändra status", () => {
  it("erbjuder godkännande bara för felstämplade utan beslut", () => {
    expect(availableStatusChoices(active("MP", "NONE"))).toEqual(["APPROVAL", "DNF", "DSQ", "OOC", "NT", "RECALCULATION"]);
    expect(availableStatusChoices(active("OK", "NONE"))).toEqual(["DNF", "DSQ", "OOC", "NT", "RECALCULATION"]);
  });
  it("ett gällande beslut kan bara tas bort", () => {
    expect(availableStatusChoices(active("DSQ", "DSQ"))).toEqual(["DSQ_WITHDRAWAL", "RECALCULATION"]);
    expect(availableStatusChoices(active("OK", "APPROVAL"))).toEqual(["APPROVAL_WITHDRAWAL", "RECALCULATION"]);
  });
  it("utan resultat kan löparen markeras som ej start", () => {
    expect(availableStatusChoices({ ...common, state: "NO_PUBLISHED_RESULT", selectedRevision: null })).toEqual(["DNS"]);
    expect(availableStatusChoices(undefined)).toEqual([]);
    expect(isStatusChoice("APPROVAL")).toBe(true);
    expect(isStatusChoice("")).toBe(false);
  });
});
