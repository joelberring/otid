import { describe, expect, it } from "vitest";
import type { ResultListModel, ResultRow } from "./lists/result-list-model";
import { analysisClassNames, legLabel, routeHref, splitsHref } from "./split-analysis";

const row = (splits: ResultRow["splits"]): ResultRow => ({ publicResultId: null, name: "Anna Ek", club: null, className: "H21", place: 1,
  timeMs: 100_000, behindMs: 0, status: "OK", reason: "", variant: null, splits, missingControls: [], score: null });

describe("sträcktidsanalysen på webben", () => {
  it("har analys för individuella klasser med sträcktider, inte för rogaining eller klasser utan sträcktider", () => {
    const model: ResultListModel = { relayClasses: [], classes: [
      { name: "H21", rows: [row([{ controlCode: 31, occurrence: 1, legMs: 10_000, elapsedMs: 10_000 }])], scored: false, mixedCourses: false },
      { name: "Öppen", rows: [row([])], scored: false, mixedCourses: false },
      { name: "Rogaining 60", rows: [row([{ controlCode: 31, occurrence: 1, legMs: 10_000, elapsedMs: 10_000 }])], scored: true, mixedCourses: false }
    ] };
    expect(analysisClassNames(model)).toEqual(["H21"]);
  });

  it("skriver sträckor med start, mål och upprepad kontroll", () => {
    expect(legLabel("S-31.1")).toBe("Start–31");
    expect(legLabel("31.1-31.2")).toBe("31–31 (2)");
    expect(legLabel("33.1-F")).toBe("33–Mål");
  });

  it("bygger länkar med kodade parametrar", () => {
    expect(splitsHref("r", "D 21")).toBe("/results/r/splits?class=D%2021");
    expect(splitsHref("r")).toBe("/results/r/splits");
    expect(routeHref("r", "p", "S-31.1")).toBe("/results/r/routes?runner=p&leg=S-31.1");
  });
});
