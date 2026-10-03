import { describe, expect, it } from "vitest";
import { fixedStartSlotPlanResponseSchema } from "../src";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const entryId = "10000000-0000-4000-8000-000000000003";
const response = { formatVersion: 1, raceId, snapshotVersion: 3, timeZone: "Europe/Stockholm", classes: [{
  classId, className: "D21", entryCount: 2, maxEntries: 5, capacityRemaining: 3,
  plan: { status: "AVAILABLE", firstStartTime: "2026-09-04T08:00:00.000Z", intervalSeconds: 60,
    drawnAt: "2026-09-04T07:00:00.000Z", slots: [
      { state: "OCCUPIED", fixedStartTime: "2026-09-04T08:00:00.000Z", entry: { id: entryId, displayName: "Ada Andersson" } },
      { state: "VACANT", fixedStartTime: "2026-09-04T08:01:00.000Z" }
    ], unassignedEntries: [{ id: "10000000-0000-4000-8000-000000000004", displayName: "Bea Berg" }] }
}] };

describe("TASK108 planerade startluckors kontrakt", () => {
  it("tar emot exakt sparad plan och skiljer kapacitet från starttid", () => {
    expect(fixedStartSlotPlanResponseSchema.parse(response)).toEqual(response);
    expect(fixedStartSlotPlanResponseSchema.parse({ ...response, classes: [{ ...response.classes[0]!,
      plan: { status: "UNAVAILABLE", reason: "NO_SAVED_DRAW" } }] }).classes[0]!.plan.status).toBe("UNAVAILABLE");
  });
  it("avvisar påhittade tider, dubbletter och felaktig kapacitet", () => {
    const plan = response.classes[0]!.plan;
    if (plan.status !== "AVAILABLE") throw new Error();
    for (const value of [
      { ...response, classes: [{ ...response.classes[0]!, capacityRemaining: 4 }] },
      { ...response, classes: [{ ...response.classes[0]!, plan: { ...plan, slots: [...plan.slots.slice(0, 1), { state: "VACANT", fixedStartTime: "2026-09-04T08:02:00.000Z" }] } }] },
      { ...response, classes: [{ ...response.classes[0]!, plan: { ...plan, slots: [plan.slots[0]!, plan.slots[0]!] } }] }
    ]) expect(fixedStartSlotPlanResponseSchema.safeParse(value).success).toBe(false);
  });
});
