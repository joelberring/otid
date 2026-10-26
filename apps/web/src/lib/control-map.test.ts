import { describe, expect, it } from "vitest";
import { controlMapView, legLine, loadLevel, loadRadius, numberPlace, scaleBar } from "./control-map";

describe("steg 52: kontrollkartans ritning", () => {
  it("väljer ett utsnitt runt punkterna inom kartbilden och läsbara proportioner", () => {
    const view = controlMapView({ minX: 100, minY: 100, maxX: 500, maxY: 120 }, { width: 2000, height: 1500 })!;
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.width / view.height).toBeLessThanOrEqual(2);
    expect(view.radius).toBeGreaterThan(0);
    expect(controlMapView(null)).toBeNull();
  });

  it("kortar sträckan vid ringarna och hoppar över sammanfallande punkter", () => {
    expect(legLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toEqual({ x1: 10, y1: 0, x2: 90, y2: 0 });
    expect(legLine({ x: 0, y: 0 }, { x: 15, y: 0 }, 10)).toBeUndefined();
  });

  it("lägger numret bort från sträckorna", () => {
    const place = numberPlace({ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 0, y: 10 }, 5);
    expect(place.x).toBeGreaterThan(0);
    expect(place.y).toBeLessThan(0);
  });

  it("ger en jämn skalstock och belastningens nivå och storlek", () => {
    expect(scaleBar(1, 1000)).toEqual({ meters: 200, units: 200 });
    expect(scaleBar(null, 1000)).toBeNull();
    expect([0, 1, 4, 9].map(value => loadLevel(value, 9))).toEqual([0, 1, 2, 3]);
    expect(loadRadius(10, 9, 9)).toBeCloseTo(18);
    expect(loadRadius(10, 0, 9)).toBe(10);
  });
});
