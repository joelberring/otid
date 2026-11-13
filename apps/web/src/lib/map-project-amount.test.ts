import { describe, expect, it } from "vitest";
import { clearCutAgesAt, depthAt, greenAt } from "./map-project-amount";
import { DEFAULT_CLEAR_CUT_AGES } from "./map-project-clear-cuts";
import { DEFAULT_GREEN } from "./map-project-green-classes";
import { DEFAULT_DEPTH } from "./map-project-moisture-depth";

describe("mängden på skalan 1–10 för grönt, sankmark och hyggen", () => {
  it("ger förvalen på 5", () => {
    expect(greenAt(5)).toEqual(DEFAULT_GREEN);
    expect(depthAt(5)).toEqual(DEFAULT_DEPTH);
    expect(clearCutAgesAt(5)).toEqual(DEFAULT_CLEAR_CUT_AGES);
  });
  it("ger minst på 1 och mest på 10, med stegen i ordning", () => {
    expect(greenAt(1)).toMatchObject({ slow: 6, difficult: 8, fight: 9 });
    expect(greenAt(10)).toMatchObject({ slow: 0, difficult: 2, fight: 3, denseShare: 0.04 });
    expect(greenAt(1).denseShare).toBe(0.25);
    expect(greenAt(4).denseShare).toBeGreaterThan(greenAt(5).denseShare!);
    expect(depthAt(1)).toMatchObject({ wetMeters: 0.1, moistMeters: 0.25 });
    expect(depthAt(10)).toMatchObject({ wetMeters: 0.8, moistMeters: 1.5 });
    expect(clearCutAgesAt(1)).toEqual({ fresh: 1, scrub: 3, young: 6 });
    expect(clearCutAgesAt(10)).toEqual({ fresh: 6, scrub: 16, young: 30 });
    for (let level = 1; level <= 10; level += 1) {
      const green = greenAt(level), ages = clearCutAgesAt(level), depth = depthAt(level);
      expect(green.slow <= green.difficult && green.difficult <= green.fight).toBe(true);
      expect(ages.fresh < ages.scrub && ages.scrub < ages.young).toBe(true);
      expect(depth.wetMeters < depth.moistMeters).toBe(true);
    }
  });
  it("behåller det som inte styr mängden", () => {
    expect(greenAt(8, { ...DEFAULT_GREEN, minAreaM2: 900, undergrowth: false })).toMatchObject({ minAreaM2: 900, undergrowth: false });
    expect(depthAt(2, { ...DEFAULT_DEPTH, minAreaM2: 1000 }).minAreaM2).toBe(1000);
  });
});
