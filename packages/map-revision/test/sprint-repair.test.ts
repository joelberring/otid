import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { apartmentYardKeys, stairObjectsPlan } from "../src";

const line = (...points: [number, number][]): MapObject => ({ kind: "line", symbol: "532", path: points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })) });
const square = (x: number, y: number, side: number, symbol: string): MapObject => ({ kind: "area", symbol, angle: 0,
  rings: [[{ type: "M", x, y }, { type: "L", x: x + side, y }, { type: "L", x: x + side, y: y + side }, { type: "L", x, y: y + side }]] });

describe("rätta en befintlig sprintkarta", () => {
  it("trappsteg som egna linjer blir en trappa; en trappa som redan är en mittlinje står kvar", () => {
    // 1:4 000: steg 2 m breda (0,5 mm) och 0,3 m isär (0,075 mm), sex steg.
    const steps = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, object: line([0, i * 0.075], [0.5, i * 0.075]) }));
    const centre = { key: "c", object: line([10, 0], [10, 1.2]) };
    const plan = stairObjectsPlan([...steps, centre], 4000, [], "532");
    expect(plan.stairs).toBe(1);
    expect([...plan.remove].sort()).toEqual(steps.map(step => step.key));
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]!.symbol).toBe("532");
    expect(stairObjectsPlan([centre], 4000, [], "532")).toEqual({ remove: [], add: [], stairs: 0 });
  });

  it("520 kring ett flerbostadshus föreslås bort, villatomten står kvar", () => {
    // 1:4 000: 1 mm = 4 m. Flerbostadshuset 10 × 10 mm = 1 600 m², villan 3 × 3 mm = 144 m².
    const yards = [{ key: "gard", object: square(0, 0, 30, "520") }, { key: "villa", object: square(100, 0, 8, "520") }];
    const houses = [{ key: "hus", object: square(10, 10, 10, "521") }, { key: "villahus", object: square(102, 2, 3, "521") }];
    expect(apartmentYardKeys(yards, houses, 4000)).toEqual(["gard"]);
  });
});
