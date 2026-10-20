import { describe, expect, it } from "vitest";
import { projectAdministratorControlTimes } from "../src/administrator-effective-result";

describe("TASK185 historical control times", () => {
  it("keeps physical split occurrence numbers across a repeated code", () => {
    const controls = [
      { id: "first", sequence: 1, controlCode: 31 },
      { id: "second", sequence: 2, controlCode: 32 },
      { id: "third", sequence: 3, controlCode: 31 }
    ];
    const splits = [
      { controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
      { controlCode: 31, occurrence: 2, elapsedMs: 180_000, legMs: 120_000 }
    ];
    // Kontroll 32 ur funktion (steg 31): ingen tid, märkt, och sträckan till 31 räknas från förra 31.
    expect(projectAdministratorControlTimes(controls, new Set([32]), splits)).toEqual([
      { sequence: 1, controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
      { sequence: 2, controlCode: 32, occurrence: 1, elapsedMs: null, legMs: null, outOfOrder: true },
      { sequence: 3, controlCode: 31, occurrence: 2, elapsedMs: 180_000, legMs: 120_000 }
    ]);
    expect(() => projectAdministratorControlTimes(controls, new Set(), [
      { controlCode: 31, occurrence: 3, elapsedMs: 120_000, legMs: 60_000 }
    ])).toThrow("Lagrad sträcktid saknar historisk kontroll");
  });
});
