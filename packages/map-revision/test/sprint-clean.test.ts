import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { pathsInRoadsPlan, smallEdgeRingKeys, waterInBuiltPlan } from "../src";

const line = (symbol: string, ...points: [number, number][]): MapObject => ({ kind: "line", symbol, path: points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })) });
const rect = (symbol: string, x: number, y: number, w: number, h: number): MapObject => ({ kind: "area", symbol, angle: 0,
  rings: [[{ type: "M", x, y }, { type: "L", x: x + w, y }, { type: "L", x: x + w, y: y + h }, { type: "L", x, y: y + h }]] });
const row = (key: string, code: string, object: MapObject) => ({ key, code, object });
const lengthOf = (object: MapObject) => object.kind !== "line" ? 0 : object.path.reduce((sum, c, i) => i === 0 ? 0 : sum + Math.hypot(c.x - object.path[i - 1]!.x, c.y - object.path[i - 1]!.y), 0);

// 1:4 000: 1 mm = 4 m; 25 m = 6,25 mm.
describe("kärr och bäckar i bebyggt (sprint)", () => {
  const house = row("hus", "521", rect("521", 0, 0, 5, 5));
  it("sankmark intill ett hus tas bort, en långt bort står kvar", () => {
    const near = row("nara", "308", rect("308", 6, 0, 3, 3)), far = row("langt", "310", rect("310", 60, 0, 4, 4));
    expect(waterInBuiltPlan([near, far], [house], 4000).remove).toEqual(["nara"]);
    // Med 2 m ligger inte heller den nära i bebyggt.
    expect(waterInBuiltPlan([near, far], [house], 4000, 2).remove).toEqual([]);
  });
  it("ett dike klipps vid bebyggt och delen utanför står kvar", () => {
    const ditch = row("dike", "306", line("306", [0, 10], [0, 40]));
    const edge = row("kant", "501.1", line("501.1", [-20, 10], [20, 10]));
    const plan = waterInBuiltPlan([ditch], [edge], 4000);
    expect(plan.remove).toEqual([]);
    expect(plan.replace).toHaveLength(1);
    const kept = plan.replace[0]!.objects;
    expect(kept).toHaveLength(1);
    // Bara delen mer än 6,25 mm från kanten (y > 16,25) står kvar.
    const ys = kept[0]!.kind === "line" ? kept[0]!.path.map(c => c.y) : [];
    expect(Math.min(...ys)).toBeGreaterThan(16);
    expect(Math.max(...ys)).toBeCloseTo(40);
  });
  it("utan bebyggt ändras inget", () => {
    expect(waterInBuiltPlan([row("k", "308", rect("308", 0, 0, 3, 3))], [], 4000)).toEqual({ remove: [], replace: [] });
  });
});

describe("stigar i vägar (sprint)", () => {
  // En gata 12 m bred (3 mm) som bara har kantlinjer, y = 0 och y = 3.
  const edges = [row("k1", "501.1", line("501.1", [0, 0], [100, 0])), row("k2", "501.1", line("501.1", [0, 3], [100, 3]))];
  it("en stig mitt i gatan tas bort", () => {
    expect(pathsInRoadsPlan([row("s", "505", line("505", [10, 1.5], [90, 1.5]))], edges, 4000).remove).toEqual(["s"]);
  });
  it("en stig som korsar gatan står kvar", () => {
    const plan = pathsInRoadsPlan([row("s", "506", line("506", [50, -20], [50, 23]))], edges, 4000);
    expect(plan).toEqual({ remove: [], replace: [] });
  });
  it("en stig genom en hårdgjord yta klipps vid ytans kant", () => {
    const paved = row("yta", "501", rect("501", 20, -10, 20, 40));
    const plan = pathsInRoadsPlan([row("s", "507", line("507", [0, 50], [60, 50]))], [paved], 4000);
    expect(plan).toEqual({ remove: [], replace: [] });
    const through = pathsInRoadsPlan([row("s", "507", line("507", [0, 10], [60, 10]))], [paved], 4000);
    expect(through.replace).toHaveLength(1);
    const pieces = through.replace[0]!.objects;
    expect(pieces).toHaveLength(2);
    expect(pieces.map(lengthOf).every(length => length > 19 && length < 20.5)).toBe(true);
  });
  it("en stig längs en kant tas bort, men inte en som bara når fram till den", () => {
    const along = row("langs", "505", line("505", [10, 3.6], [60, 3.6]));
    const touching = row("mot", "505", line("505", [30, 30], [30, 3.5]));
    const plan = pathsInRoadsPlan([along, touching], edges, 4000);
    expect(plan.remove).toEqual(["langs"]);
    expect(plan.replace).toEqual([]);
  });
});

describe("små kantringar", () => {
  it("ett litet «D» och en smal refug tas bort, en riktig ö står kvar", () => {
    const d = row("d", "501.1", line("501.1", [0, 0], [0.6, 0], [0.6, 0.4], [0, 0.4], [0, 0]));
    const thin = row("smal", "501.1", line("501.1", [10, 0], [12.4, 0], [12.4, 0.25], [10, 0.25], [10, 0]));
    const island = row("o", "501.1", line("501.1", [20, 0], [24, 0], [24, 1.5], [20, 1.5], [20, 0]));
    const open = row("oppen", "501.1", line("501.1", [30, 0], [30.3, 0], [30.3, 0.3]));
    expect(smallEdgeRingKeys([d, thin, island, open, row("hus", "521", rect("521", 0, 0, 0.5, 0.5))])).toEqual(["d", "smal"]);
  });
});
