import { describe, expect, it } from "vitest";
import { fieldPages } from "./map-project-field-print";

describe("fieldPages (fältutskriftens blad)", () => {
  it("ett litet område blir ett blad mitt över området", () => {
    const layout = fieldPages({ minX: 0, minY: 0, maxX: 500, maxY: 500 }, { scale: 4000, paper: "A4", landscape: false });
    expect(layout.pages).toHaveLength(1);
    const [page] = layout.pages;
    expect((page!.minX + page!.maxX) / 2).toBeCloseTo(250);
    // 194 mm × 4 m/mm.
    expect(page!.maxX - page!.minX).toBeCloseTo(776);
  });
  it("ett större område delas med överlapp och täcks helt", () => {
    const extent = { minX: 0, minY: 0, maxX: 2000, maxY: 1500 };
    const layout = fieldPages(extent, { scale: 5000, paper: "A4", landscape: true });
    expect(layout.widthMm).toBe(297);
    expect(layout.pages.length).toBeGreaterThan(2);
    expect(Math.min(...layout.pages.map(page => page.minX))).toBeLessThanOrEqual(0);
    expect(Math.max(...layout.pages.map(page => page.maxY))).toBeGreaterThanOrEqual(1500);
    const [a, b] = layout.pages;
    expect(a!.maxX - b!.minX).toBeCloseTo(50); // 10 mm vid 1:5 000
  });
});
