import { describe, expect, it } from "vitest";
import { flattenPath, type MapObject } from "@o-tid/map-file";
import { buildingOutlines } from "../src";

const square = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const area = (...rings: { x: number; y: number }[][]): MapObject => ({ kind: "area", symbol: "21", angle: 0,
  rings: rings.map(ring => ring.map((point, i) => ({ type: i === 0 ? "M" as const : "L" as const, ...point }))) });
const ringOf = (object: MapObject) => object.kind === "line" ? flattenPath(object.path)[0]! : [];
const length = (points: readonly { x: number; y: number }[]) => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y), 0);

describe("kant runt husen", () => {
  it("två hus som delar vägg får en gemensam kant utan väggen emellan", () => {
    const plan = buildingOutlines([{ key: "a", object: area(square(0, 0, 2, 1)) }, { key: "b", object: area(square(2, 0, 1, 1)) }], [], "edge");
    expect(plan.add).toHaveLength(1);
    expect(plan.houses).toBe(2);
    const ring = ringOf(plan.add[0]!);
    expect(ring[0]).toEqual(ring.at(-1));
    // Omkretsen runt båda (3 × 1 mm), inte summan av husens (6 + 4).
    expect(length(ring)).toBeCloseTo(8, 6);
    expect(plan.add[0]!.symbol).toBe("edge");
  });

  it("överlappande hus slås ihop; ett hus med gård får kant också runt gården; fristående hus får egen kant", () => {
    const plan = buildingOutlines([
      { key: "a", object: area(square(0, 0, 2, 2)) }, { key: "b", object: area(square(1, 1, 2, 2)) },
      { key: "c", object: area(square(10, 0, 6, 6), square(12, 2, 2, 2)) }, { key: "d", object: area(square(20, 0, 1, 1)) }
    ], [], "edge");
    expect(plan.add).toHaveLength(4);
    const lengths = plan.add.map(object => length(ringOf(object))).sort((a, b) => a - b);
    [4, 8, 12, 24].forEach((value, i) => expect(lengths[i]).toBeCloseTo(value, 6));
  });

  it("bara de markerade husens grupp; befintliga kanter som stämmer står kvar, gamla längs husen tas bort", () => {
    const houses = [{ key: "a", object: area(square(0, 0, 2, 1)) }, { key: "b", object: area(square(2, 0, 1, 1)) }, { key: "c", object: area(square(10, 0, 1, 1)) }];
    const first = buildingOutlines(houses, [], "edge", new Set(["a"]));
    expect(first.add).toHaveLength(1);
    expect(first.houses).toBe(2);
    // Körs igen med kanten på plats: inget ändras.
    const again = buildingOutlines(houses, [{ key: "e1", object: first.add[0]! }], "edge", new Set(["a"]));
    expect(again).toMatchObject({ add: [], remove: [] });
    // En gammal kant runt bara hus a (med väggen mot b) ersätts.
    const old: MapObject = { kind: "line", symbol: "edge", path: [...square(0, 0, 2, 1), { x: 0, y: 0 }].map((point, i) => ({ type: i === 0 ? "M" as const : "L" as const, ...point })) };
    const replaced = buildingOutlines(houses, [{ key: "old", object: old }, { key: "far", object: { ...old, path: old.path.map(c => ({ ...c, x: c.x + 50 })) } }], "edge");
    expect(replaced.remove).toEqual(["old"]);
    expect(replaced.add).toHaveLength(2);
  });

  it("klarar en mycket stor ring (20 000 hörn) utan stack overflow och matchar många hus med spatialt index", () => {
    const n = 20_000;
    const bigRing = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: Math.round(Math.cos(a) * 10 * 1000) / 1000, y: Math.round(Math.sin(a) * 10 * 1000) / 1000 };
    });
    const bigHouse = { key: "big", object: area(bigRing) };
    const first = buildingOutlines([bigHouse], [], "edge");
    expect(first.add).toHaveLength(1);
    const second = buildingOutlines([bigHouse], [{ key: "e-big", object: first.add[0]! }], "edge");
    expect(second).toMatchObject({ add: [], remove: [], houses: 1 });

    // 400 fristående hus + 400 befintliga kanter: spatialt index håller det snabbt och idempotent.
    const manyHouses = Array.from({ length: 400 }, (_, i) => ({
      key: `h${i}`,
      object: area(square((i % 20) * 5, Math.floor(i / 20) * 5, 2, 2))
    }));
    const initial = buildingOutlines(manyHouses, [], "edge");
    expect(initial.add).toHaveLength(400);
    const edges = initial.add.map((object, i) => ({ key: `e${i}`, object }));
    const started = performance.now();
    const rerun = buildingOutlines(manyHouses, edges, "edge");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(rerun).toMatchObject({ add: [], remove: [], houses: 400 });
  });
});
