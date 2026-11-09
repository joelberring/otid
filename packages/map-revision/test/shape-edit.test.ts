import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { circleShape, simplifyShape, smoothShape, straightenShape, vertexCount } from "../src";

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
});
