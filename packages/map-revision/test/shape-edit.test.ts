import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { areaSelfCrosses, circleShape, SIMPLIFY_GROWTH, simplifyShape, simplifyStep, smoothShape, straightenShape, vertexCount } from "../src";

/** Ägaren 2026-11-09: förenkla, mjuk, rak och cirkel för ett markerat objekt. */
const line = (points: readonly [number, number][], corner: number[] = []): MapObject => ({ kind: "line", symbol: "101",
  path: points.map(([x, y], i): PathCommand => ({ type: i === 0 ? "M" : "L", x, y, ...(corner.includes(i) ? { corner: true as const } : {}) })) });

describe("formen på ett objekt", () => {
  it("förenklar en tät kurva (även med kurvor) och lämnar en enkel", () => {
    // En höjdkurva med en punkt var 0,05 mm längs en mjuk båge.
    const dense = line(Array.from({ length: 201 }, (_, i) => [i * 0.05, Math.sin(i / 40) * 2] as [number, number]));
    const simple = simplifyShape(dense, 0.05)!;
    expect(vertexCount(simple)).toBeLessThan(20);
    expect(vertexCount(simple)).toBeGreaterThan(3);
    expect(simplifyShape(line([[0, 0], [5, 0]]), 0.1)).toBeUndefined();
    const curved = smoothShape(simple)!;
    expect(simplifyShape(curved, 0.5)).toBeDefined();
    expect(simplifyShape({ kind: "point", symbol: "1", at: { x: 0, y: 0 }, angle: 0 }, 0.1)).toBeUndefined();
    // Styrpunkter (dash) och hörn (corner) låses och bevaras vid förenkling.
    const withDash: MapObject = { kind: "line", symbol: "101", path: [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 0.01 }, { type: "L", x: 5, y: 0, dash: true },
      { type: "L", x: 8, y: 0.01 }, { type: "L", x: 10, y: 0, corner: true }
    ] };
    const kept = simplifyShape(withDash, 0.5)!;
    expect(kept.kind === "line" && kept.path).toEqual([
      { type: "M", x: 0, y: 0 }, { type: "L", x: 5, y: 0, dash: true }, { type: "L", x: 10, y: 0, corner: true }
    ]);
  });

  it("gör en linje mjuk genom samma punkter, hörnen förblir hörn, och rak igen", () => {
    const zigzag = line([[0, 0], [2, 2], [4, 0], [6, 2]], [2]);
    const soft = smoothShape(zigzag)!;
    expect(soft.kind === "line" && soft.path.map(command => command.type)).toEqual(["M", "C", "C", "C"]);
    if (soft.kind !== "line") throw new Error();
    expect(soft.path.map(command => [command.x, command.y])).toEqual([[0, 0], [2, 2], [4, 0], [6, 2]]);
    // Hörnpunkten (index 2) har ingen tangent: styrpunkterna på båda sidor ligger i punkten.
    const into = soft.path[2]! as Extract<PathCommand, { type: "C" }>, out = soft.path[3]! as Extract<PathCommand, { type: "C" }>;
    expect([into.x2, into.y2]).toEqual([4, 0]);
    expect([out.x1, out.y1]).toEqual([4, 0]);
    expect(into.corner).toBe(true);
    // Den mjuka punkten (index 1): styrpunkterna på en linje genom punkten.
    const a = soft.path[1]! as Extract<PathCommand, { type: "C" }>, b = soft.path[2]! as Extract<PathCommand, { type: "C" }>;
    const ax = a.x2 - 2, ay = a.y2 - 2, bx = b.x1 - 2, by = b.y1 - 2;
    expect(Math.abs(ax * by - ay * bx)).toBeLessThan(1e-9);
    const hard = straightenShape(soft)!;
    expect(hard.kind === "line" && hard.path.map(command => command.type)).toEqual(["M", "L", "L", "L"]);
    expect(straightenShape(zigzag)).toBeUndefined();
  });

  it("gör en yta mjuk som en sluten kurva och ritar cirklar", () => {
    const ring = line([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]) as Extract<MapObject, { kind: "line" }>;
    const square: MapObject = { kind: "area", symbol: "406", angle: 0, rings: [ring.path] };
    const soft = smoothShape(square)!;
    expect(soft.kind === "area" && soft.rings[0]!.length).toBe(5);
    const circle = circleShape("area", "406", { x: 10, y: 10 }, 3)!;
    expect(circle.kind === "area" && circle.rings[0]!.length).toBe(5);
    const top = circle.kind === "area" ? circle.rings[0]![1]! : undefined;
    expect(top && [top.x, top.y]).toEqual([10, 13]);
    expect(circleShape("line", "101", { x: 0, y: 0 }, 0.01)).toBeUndefined();
    expect(circleShape("line", "101", { x: 0, y: 0 }, 1)?.kind).toBe("line");
  });

  it("centripetal Catmull–Rom med kordklampning ger inga öglor eller överslängar på ojämna segment", () => {
    // Lång 10 mm-sträcka följd av en skarp 0,22 mm-vändning (typisk förenklad höjdkurva): uniform Catmull–Rom sköt ut 1,7 mm.
    const hairpin = line([[0, 0], [10, 0], [10.2, 0.1], [0, 0.2]]);
    const soft = smoothShape(hairpin)!;
    if (soft.kind !== "line") throw new Error("expected line");
    const turn = soft.path[2]! as Extract<PathCommand, { type: "C" }>;
    const chord = Math.hypot(10.2 - 10, 0.1 - 0);
    expect(Math.hypot(turn.x1 - 10, turn.y1 - 0)).toBeLessThanOrEqual(chord * 0.5 + 1e-9);
    expect(Math.hypot(turn.x2 - 10.2, turn.y2 - 0.1)).toBeLessThanOrEqual(chord * 0.5 + 1e-9);
    expect(Math.max(turn.x1, turn.x2)).toBeLessThan(10.35);
    // Även en skarp sluten yta med korta och långa sträckor korsar inte sig själv efter smoothShape.
    const thinNose: MapObject = { kind: "area", symbol: "406", angle: 0, rings: [[
      { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10.1, y: 0.15 },
      { type: "L", x: 10, y: 0.3 }, { type: "L", x: 0, y: 0.3 }, { type: "L", x: 0, y: 0 }
    ]] };
    expect(areaSelfCrosses(smoothShape(thinNose)!)).toBe(false);
  });
});

describe("förenkla stegvis (ägaren 2026-11-23)", () => {
  // En slingrig höjdkurva: punkter var 0,02 mm längs en våg med små ryckningar.
  const wiggly = line(Array.from({ length: 401 }, (_, i) => [i * 0.02, Math.sin(i / 30) * 1.5 + Math.sin(i * 1.7) * 0.03] as [number, number]));

  it("varje steg från förra toleransen ger synbart färre punkter tills det inte går längre", () => {
    const counts: number[] = [];
    let object = wiggly, from = 0.05, steps = 0;
    for (;;) {
      const step = simplifyStep(object, from);
      if (!step) break;
      expect(step.tolerance).toBeGreaterThanOrEqual(from);
      object = step.object; from = step.tolerance * SIMPLIFY_GROWTH; steps += 1;
      counts.push(vertexCount(object));
      expect(steps).toBeLessThan(20);
    }
    expect(steps).toBeGreaterThanOrEqual(3);
    // Strikt färre punkter i varje steg, och den sista formen går inte att förenkla vidare inom taket.
    counts.forEach((count, index) => { if (index > 0) expect(count).toBeLessThan(counts[index - 1]!); });
    expect(simplifyStep(object, from)).toBeUndefined();
    // Samma tolerans igen på det redan förenklade (det gamla felet): inget eller lite, men stegvis går det.
    expect(simplifyStep(simplifyStep(wiggly, 0.15)!.object, 0.15 * SIMPLIFY_GROWTH)).toBeDefined();
  });

  it("behåller kurvor: ett mjukt objekt blir mjukt igen med färre punkter", () => {
    const curved = smoothShape(simplifyShape(wiggly, 0.02)!)!;
    const step = simplifyStep(curved, 0.05)!;
    expect(vertexCount(step.object)).toBeLessThan(vertexCount(curved));
    expect(step.object.kind === "line" && step.object.path.slice(1).every(command => command.type === "C")).toBe(true);
  });

  it("en yta korsar inte sig själv, krymper inte under normens minsta yta och kollapsar inte", () => {
    // En tät cirkel som yta (radie 2 mm, 120 punkter).
    const ring = Array.from({ length: 121 }, (_, i) => ({ type: i === 0 ? "M" as const : "L" as const,
      x: 2 * Math.cos(i / 120 * Math.PI * 2), y: 2 * Math.sin(i / 120 * Math.PI * 2) }));
    const area: MapObject = { kind: "area", symbol: "401", rings: [ring], angle: 0 };
    let object: MapObject = area, from = 0.05;
    for (let step = simplifyStep(object, from); step; step = simplifyStep(object, from)) {
      object = step.object; from = step.tolerance * SIMPLIFY_GROWTH;
      expect(areaSelfCrosses(object)).toBe(false);
    }
    // Minst en triangel kvar, och ytan är inte borta.
    expect(vertexCount(object)).toBeGreaterThanOrEqual(4);
    expect(vertexCount(object)).toBeLessThan(121);
    // Med en minsta yta nära cirkelns stannar förenklingen tidigare.
    const strict = simplifyStep(area, 0.05, { minArea: Math.PI * 4 * 0.999 });
    expect(strict).toBeUndefined();
  });

  it("ser en yta som korsar sig själv (en åtta)", () => {
    const eight: MapObject = { kind: "area", symbol: "401", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 2 }, { type: "L", x: 2, y: 0 },
      { type: "L", x: 0, y: 2 }, { type: "L", x: 0, y: 0 }]] };
    expect(areaSelfCrosses(eight)).toBe(true);
    expect(areaSelfCrosses({ ...eight, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 0 }, { type: "L", x: 2, y: 2 }, { type: "L", x: 0, y: 2 }, { type: "L", x: 0, y: 0 }]] })).toBe(false);
  });
});
