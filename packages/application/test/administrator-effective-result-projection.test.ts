import { describe, expect, it } from "vitest";
import { projectAdministratorControlTimes } from "../src/administrator-effective-result";

describe("TASK185 historical control times", () => {
  it("keeps physical split occurrence numbers across a neutralized repeated code", () => {
    const controls = [
      { id: "first", sequence: 1, controlCode: 31 },
      { id: "neutralized", sequence: 2, controlCode: 31 },
      { id: "third", sequence: 3, controlCode: 31 }
    ];
    const splits = [
      { controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
      { controlCode: 31, occurrence: 3, elapsedMs: 180_000, legMs: 120_000 }
    ];
    expect(projectAdministratorControlTimes(controls, "neutralized", splits)).toEqual([
      { sequence: 1, controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
      { sequence: 2, controlCode: 31, occurrence: 2, elapsedMs: null, legMs: null },
      { sequence: 3, controlCode: 31, occurrence: 3, elapsedMs: 180_000, legMs: 120_000 }
    ]);
    expect(() => projectAdministratorControlTimes(controls, "neutralized", [
      { controlCode: 31, occurrence: 2, elapsedMs: 120_000, legMs: 60_000 }
    ])).toThrow("Lagrad sträcktid saknar historisk kontroll");
  });
});
