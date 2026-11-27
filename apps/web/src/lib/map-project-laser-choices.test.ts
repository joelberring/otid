import { describe, expect, it } from "vitest";
import {
  choiceSettings, choicesOf, cliffChoicesOf, CONTOUR_STYLES, contourStyleOf, contourStyleSettings, DEFAULT_CHOICES, typedOf,
  vegSmoothOf, vegSmoothSetting
} from "./map-project-laser-choices";

describe("enkla val och kurvprofiler för O-Tid-motorn och Karttapullautin", () => {
  it("förvalen ger inga värden; fler branter sänker trösklarna och grönt har samma riktning i båda motorerna", () => {
    expect(choiceSettings(DEFAULT_CHOICES)).toEqual({ settings: {}, cliffs: undefined });
    const chosenOtid = choiceSettings({ ...DEFAULT_CHOICES, cliffs: "more", green: "less", open: "less", undergrowth: "more", knolls: "more" }, {}, "few", false, false, { engine: "otidgeo" });
    expect(chosenOtid.settings).toEqual({ cliff1: 0.95, cliff2: 1.7, knollshare: 0.7, openshare: 0.75, greenscale: 1.5, undergrowth: 0.035 });
    expect(chosenOtid.cliffs).toEqual({ minDrop: 1, impassableDrop: 3.5, impassableLength: 20 });

    const chosenKp = choiceSettings({ ...DEFAULT_CHOICES, cliffs: "more", green: "less" }, {}, "few", false, false, { engine: "pullautin", contours: "generalized" });
    expect(chosenKp.settings).toEqual({ cliff1: 0.95, cliff2: 1.7, smoothing: 1.2, curviness: 0.9, greenscale: 1.5, denseshare: 0.12 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, cliffs: "less" }).cliffs).toEqual({ minDrop: 1.8, impassableDrop: 5.5, impassableLength: 20 });
  });

  it("5 kurvprofiler för otidgeo (5 m och sprint) samt pullautin med exakt återställning i Kör om", () => {
    expect(CONTOUR_STYLES).toEqual(["veryDetailed", "detailed", "normal", "generalized", "veryGeneralized"]);

    // otidgeo 5 m
    expect(contourStyleSettings("veryDetailed", "otidgeo", false)).toEqual({ smooth_m: 1.0, taubin: 1, curviness: 0.24, min_loop_area: 20, min_clearance: 1.0 });
    expect(contourStyleSettings("detailed", "otidgeo", false)).toEqual({ smooth_m: 1.35, taubin: 2, curviness: 0.20, min_loop_area: 30, min_clearance: 1.4 });
    expect(contourStyleSettings("normal", "otidgeo", false)).toEqual({});
    expect(contourStyleSettings("generalized", "otidgeo", false)).toEqual({ smooth_m: 2.3, taubin: 3, curviness: 0.13, min_loop_area: 65, min_clearance: 2.1 });
    expect(contourStyleSettings("veryGeneralized", "otidgeo", false)).toEqual({ smooth_m: 3.2, taubin: 4, curviness: 0.08, min_loop_area: 105, min_clearance: 2.5 });

    // otidgeo sprint (<= 3 m)
    expect(contourStyleSettings("veryDetailed", "otidgeo", true)).toEqual({ smooth_m: 0.8, taubin: 1, curviness: 0.24, min_loop_area: 10, min_clearance: 0.6 });
    expect(contourStyleSettings("detailed", "otidgeo", true)).toEqual({ smooth_m: 1.0, taubin: 2, curviness: 0.20, min_loop_area: 14, min_clearance: 0.85 });
    expect(contourStyleSettings("generalized", "otidgeo", true)).toEqual({ smooth_m: 1.6, taubin: 3, curviness: 0.13, min_loop_area: 26, min_clearance: 1.2 });
    expect(contourStyleSettings("veryGeneralized", "otidgeo", true)).toEqual({ smooth_m: 2.2, taubin: 4, curviness: 0.08, min_loop_area: 40, min_clearance: 1.5 });

    // pullautin
    expect(contourStyleSettings("veryDetailed", "pullautin")).toEqual({ smoothing: 0.3, curviness: 1.5 });
    expect(contourStyleSettings("detailed", "pullautin")).toEqual({ smoothing: 0.5, curviness: 1.3 });
    expect(contourStyleSettings("normal", "pullautin")).toEqual({});
    expect(contourStyleSettings("generalized", "pullautin")).toEqual({ smoothing: 1.2, curviness: 0.9 });
    expect(contourStyleSettings("veryGeneralized", "pullautin")).toEqual({ smoothing: 2, curviness: 0.7, knolls: 0.85 });

    for (const style of CONTOUR_STYLES) {
      expect(contourStyleOf(contourStyleSettings(style, "otidgeo", false), "otidgeo", false)).toBe(style);
      expect(contourStyleOf(contourStyleSettings(style, "otidgeo", true), "otidgeo", true)).toBe(style);
      expect(contourStyleOf(contourStyleSettings(style, "pullautin"), "pullautin")).toBe(style);
    }
  });

  it("vegetationsutjämning och overview-flaggan skickas bara när avvikande och återställs rent i Kör om", () => {
    expect(vegSmoothSetting("normal")).toEqual({});
    expect(vegSmoothSetting("detailed")).toEqual({ veg_smooth: 0.65 });
    expect(vegSmoothSetting("calm")).toEqual({ veg_smooth: 1.6 });
    expect(vegSmoothOf({})).toBe("normal");
    expect(vegSmoothOf({ veg_smooth: 0.65 })).toBe("detailed");
    expect(vegSmoothOf({ veg_smooth: 1.6 })).toBe("calm");
    expect(vegSmoothOf({ veg_smooth: 0.4 })).toBe("normal");

    const otidNoOverview = choiceSettings(DEFAULT_CHOICES, {}, "few", false, false, { engine: "otidgeo", contours: "detailed", vegSmooth: "calm", overview: false });
    expect(otidNoOverview.settings).toEqual({ smooth_m: 1.35, taubin: 2, curviness: 0.2, min_loop_area: 30, min_clearance: 1.4, veg_smooth: 1.6, overview: 0 });
    expect(typedOf(otidNoOverview.settings, DEFAULT_CHOICES, ["smooth_m", "taubin", "curviness", "min_loop_area", "min_clearance", "veg_smooth"],
      { engine: "otidgeo", contours: "detailed", vegSmooth: "calm", overview: false })).toEqual({});

    // overview: false ger inte overview: 0 för pullautin (bildmotorn hoppas ändå över).
    expect(choiceSettings(DEFAULT_CHOICES, {}, "few", false, false, { engine: "pullautin", overview: false }).settings).toEqual({});
  });

  it("handskrivna värden går före valen, och ett jobb ger tillbaka sina val och sina handskrivna värden", () => {
    const choices = { ...DEFAULT_CHOICES, knolls: "more" as const, cliffs: "less" as const };
    const { settings } = choiceSettings(choices, { cliff1: 1.1, greenhigh: 3 }, "few", false, false, { engine: "pullautin" });
    expect(settings).toEqual({ cliff1: 1.1, cliff2: 2.4, knolls: 0.35, knollshare: 0.7, greenhigh: 3 });
    // cliff1 är handskrivet, så branterna stämmer inte längre med «färre» och blir förval; knollarna känns igen.
    expect(choicesOf(settings, "pullautin")).toEqual({ ...DEFAULT_CHOICES, knolls: "more" });
    expect(typedOf(settings, choicesOf(settings, "pullautin"), ["cliff1", "cliff2", "knolls", "greenhigh"], { engine: "pullautin" }))
      .toEqual({ cliff1: "1,1", cliff2: "2,4", greenhigh: "3" });
  });

  it("brantvalen: Gömmarens sätt ger lägre gräns och kortare minsta längd; taggar följer med; rawTicks bara på pullautin", () => {
    expect(choiceSettings(DEFAULT_CHOICES).cliffs).toBeUndefined();
    expect(choiceSettings(DEFAULT_CHOICES, {}, "most").cliffs).toEqual({ minDrop: 1.3, impassableDrop: 3.5, impassableLength: 10 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, cliffs: "less" }, {}, "most", true).cliffs).toEqual({ minDrop: 1.8, impassableDrop: 4.5, impassableLength: 10, tags: true });
    expect(choiceSettings(DEFAULT_CHOICES, {}, "few", true).cliffs).toEqual({ minDrop: 1.3, impassableDrop: 4.5, impassableLength: 20, tags: true });
    expect(cliffChoicesOf(null)).toEqual({ level: "default", style: "few", tags: false, rawTicks: false });
    expect(cliffChoicesOf({ minDrop: 1, impassableLength: 10, tags: true })).toEqual({ level: "more", style: "most", tags: true, rawTicks: false });
    // Äldre jobb har ingen minsta längd: de räknas som «few».
    expect(cliffChoicesOf({ minDrop: 1.8 })).toEqual({ level: "less", style: "few", tags: false, rawTicks: false });
    // Råa brantstreck (Karttapullautin) skickas bara när motorn är pullautin.
    expect(choiceSettings(DEFAULT_CHOICES, {}, "few", false, true, { engine: "pullautin" }).cliffs).toEqual({ minDrop: 1.3, impassableDrop: 4.5, impassableLength: 20, rawTicks: true });
    expect(choiceSettings(DEFAULT_CHOICES, {}, "few", false, true, { engine: "otidgeo" }).cliffs).toBeUndefined();
    expect(cliffChoicesOf({ minDrop: 1.3, rawTicks: true }).rawTicks).toBe(true);
  });

  it("valen för gult, grönt, kullar och berg i dagen blir rätt trösklar per motor", () => {
    expect(choiceSettings({ ...DEFAULT_CHOICES, open: "more", green: "less", knolls: "more", rock: "more" }, {}, "few", false, false, { engine: "pullautin" }).settings)
      .toEqual({ openshare: 0.35, greenscale: 1.5, denseshare: 0.12, knolls: 0.35, knollshare: 0.7, rock: 2 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, rock: "less" }).settings).toEqual({ rock: 0 });
    expect(choicesOf({ openshare: 0.65, rock: 2, knolls: 0.85, knollshare: 0.9 }, "pullautin")).toMatchObject({ open: "less", rock: "more", knolls: "less", green: "default" });
    expect(choicesOf({ openshare: 0.75, undergrowth: 0.09, greenscale: 0.65, knollshare: 0.9 }, "otidgeo")).toMatchObject({ open: "less", undergrowth: "less", green: "more", knolls: "less" });
  });
});
