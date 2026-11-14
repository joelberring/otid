import { describe, expect, it } from "vitest";
import { northLineSegments, northLineSpacing } from "../src/north-lines";

const square = [{ easting: 0, northing: 0 }, { easting: 1000, northing: 0 }, { easting: 1000, northing: 1000 }, { easting: 0, northing: 1000 }];

describe("nordlinjer över ett område", () => {
  it("ritar raka linjer mot nätets norr med 300 m emellan, en genom referenspunkten", () => {
    const lines = northLineSegments(square, 0, 300, { easting: 500, northing: 500 });
    expect(lines.map(([from]) => Math.round(from.easting))).toEqual([200, 500, 800]);
    for (const [from, to] of lines) { expect(from.northing).toBeCloseTo(0, 6); expect(to.northing).toBeCloseTo(1000, 6); expect(to.easting).toBeCloseTo(from.easting, 6); }
  });
  it("lutar linjerna medurs med vinkeln, håller avståndet tvärs linjerna och klipper mot ramen", () => {
    const lines = northLineSegments(square, 6, 300, { easting: 500, northing: 500 });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const [from, to] of lines) {
      const angle = Math.atan2(to.easting - from.easting, to.northing - from.northing) * 180 / Math.PI;
      expect(angle).toBeCloseTo(6, 6);
      for (const point of [from, to]) { expect(point.easting).toBeGreaterThanOrEqual(-1e-6); expect(point.easting).toBeLessThanOrEqual(1000 + 1e-6); }
    }
    const across = (point: { easting: number; northing: number }) => point.easting * Math.cos(6 * Math.PI / 180) - point.northing * Math.sin(6 * Math.PI / 180);
    expect(across(lines[1]![0]) - across(lines[0]![0])).toBeCloseTo(300, 6);
  });
  it("ger inget utan område eller avstånd, och rätt avstånd för skalan", () => {
    expect(northLineSegments([], 0, 300, { easting: 0, northing: 0 })).toEqual([]);
    expect(northLineSegments(square, 0, 0, { easting: 0, northing: 0 })).toEqual([]);
    expect(northLineSpacing(15000)).toBe(300); expect(northLineSpacing(10000)).toBe(300); expect(northLineSpacing(4000)).toBe(120);
  });
});
