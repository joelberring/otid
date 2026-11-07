import { describe, expect, it } from "vitest";
import { distance, distanceToSegment, nearestOnSegment, polylineLength } from "../src";

describe("plangeometrin", () => {
  it("räknar avstånd och linjens längd", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0);
  });

  it("hittar närmaste punkt på en sträcka, också utanför ändarna och för en sträcka utan längd", () => {
    expect(nearestOnSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ point: { x: 5, y: 0 }, distance: 3, t: 0.5 });
    expect(nearestOnSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ point: { x: 0, y: 0 }, distance: 5, t: 0 });
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});
