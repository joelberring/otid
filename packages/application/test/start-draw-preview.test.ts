import { describe, expect, it } from "vitest";
import { DEFAULT_START_DRAW_RULES, existingClassSummary, previewTimeline, previewWarnings } from "../src/start-draw-preview";

const start1910 = Date.parse("2026-11-28T18:10:00.000Z");

describe("start-draw-preview för masstarter", () => {
  const names: Record<string, string> = { dam: "Hyperion dam", herr: "Hyperion herr", h21: "H21" };
  const nameOf = (id: string) => names[id] ?? id;

  it("översätter MASS_START_GROUP_CLASH till kontraktets varning", () => {
    expect(previewWarnings([
      { code: "MASS_START_GROUP_CLASH", classId: "herr", conflictClassIds: ["h21"], startMs: start1910 }
    ], nameOf, DEFAULT_START_DRAW_RULES)).toEqual([
      { code: "MASS_START_GROUP_CLASH", className: "Hyperion herr", conflictClassNames: ["H21"], startTime: "2026-11-28T18:10:00.000Z" }
    ]);
  });

  it("visar befintlig och ny samtidig masstart på samma minut i tidslinjen", () => {
    const existing = [{ classId: "dam", startControls: [[31]], method: "MASS" as const, startTimesMs: [start1910] }];
    const drawn = [{
      classId: "herr", method: "MASS" as const, firstStartMs: start1910, intervalMinutes: 1, vacancyCount: 0,
      slots: [{ startMs: start1910, entryId: "e1" }, { startMs: start1910, entryId: "e2" }]
    }];
    expect(existingClassSummary(existing, nameOf)).toEqual([
      { className: "Hyperion dam", startCount: 1, firstStartTime: "2026-11-28T18:10:00.000Z", lastStartTime: "2026-11-28T18:10:00.000Z" }
    ]);
    expect(previewTimeline(drawn, existing, nameOf)).toEqual([{
      startTime: "2026-11-28T18:10:00.000Z",
      starts: [
        { className: "Hyperion dam", count: 1, existing: true },
        { className: "Hyperion herr", count: 2, existing: false }
      ]
    }]);
  });
});
