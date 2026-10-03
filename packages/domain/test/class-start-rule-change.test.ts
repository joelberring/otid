import { expect, it } from "vitest";
import { planClassStartRuleChange } from "../src/class-start-rule-change";

it("TASK065 clears old times in both directions, preserving originals and no-op times", () => {
  const entries = [{ id: "one", version: 3, fixedStartTime: "2026-09-12T08:00:00.000Z" },
    { id: "two", version: 1, fixedStartTime: null }];
  for (const current of ["FIXED", "PUNCH"] as const) {
    const plan = planClassStartRuleChange({ current, target: current === "FIXED" ? "PUNCH" : "FIXED", entries });
    expect(plan.changed).toBe(true); expect(plan.clearedStartTimes).toBe(1);
    expect(plan.entries.map(entry => entry.fixedStartTime)).toEqual([null, null]);
    expect(plan.entries.map(entry => entry.versionAfter)).toEqual([4, 2]);
    expect(plan.entries[0]?.previousFixedStartTime).toBe(entries[0]?.fixedStartTime);
    const same = planClassStartRuleChange({ current, target: current, entries });
    expect(same.changed).toBe(false); expect(same.clearedStartTimes).toBe(0);
    expect(same.entries[0]).toMatchObject({ versionAfter: 3, fixedStartTime: entries[0]?.fixedStartTime });
  }
  expect(entries[0]?.version).toBe(3);
  expect(() => planClassStartRuleChange({ current: "PUNCH", target: "FIXED", entries: [entries[0]!, entries[0]!] })).toThrow();
  expect(() => planClassStartRuleChange({ current: "PUNCH", target: "FIXED", entries: [{ ...entries[0]!, version: 2_147_483_647 }] })).toThrow();
});
