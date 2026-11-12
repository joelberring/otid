import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { builtPolygons, maskBuilt } from "./map-project-built-mask";

const square = (x: number, y: number, side: number): PathCommand[] => [{ type: "M", x, y }, { type: "L", x: x + side, y }, { type: "L", x: x + side, y: y + side }, { type: "L", x, y: y + side }, { type: "L", x, y }];
const area = (symbol: string, x: number, y: number, side: number): MapObject => ({ kind: "area", symbol, rings: [square(x, y, side)], angle: 0 });
const point = (symbol: string, x: number, y: number): MapObject => ({ kind: "point", symbol, at: { x, y }, angle: 0 });
const line = (symbol: string, points: [number, number][]): MapObject => ({ kind: "line", symbol, path: points.map(([x, y], i) => ({ type: i ? "L" : "M", x, y })) });
// Symbolernas id är här numret som text.
const mainOf = (symbol: string) => Number(symbol.split(".")[0]);
const extent = (object: MapObject) => object.kind === "area" ? [Math.min(...object.rings[0]!.map(c => c.x)), Math.max(...object.rings[0]!.map(c => c.x))] : [];

describe("kandidater hålls utanför kartans bebyggda ytor", () => {
  // Tomtmark 0–10 mm i båda led, och ett hus som inte räknas dubbelt.
  const built = builtPolygons([area("520", 0, 0, 10), area("521", 2, 2, 2), area("403", 50, 50, 5), line("503", [[0, 0], [5, 5]])], mainOf);

  it("tar tomtmark, hårdgjort, byggnader och skärmtak som bebyggt, inget annat", () => {
    expect(built).toHaveLength(2);
    expect(builtPolygons([area("501.1", 0, 0, 1), area("522", 0, 0, 1), area("401", 0, 0, 1), area("301", 0, 0, 1)], mainOf)).toHaveLength(2);
  });
  it("tar bort punkthöjder, stenar och diken i tomtmarken men behåller dem utanför", () => {
    const result = maskBuilt([point("109", 5, 5), point("204", 5, 6), point("109", 20, 20), line("306", [[1, 1], [9, 9]]), line("306", [[8, 8], [30, 30]])], built, mainOf);
    expect(result.objects).toEqual([point("109", 20, 20), line("306", [[8, 8], [30, 30]])]);
    expect(result.removed).toBe(3);
  });
  it("behåller kurvor, branter, vatten och vägar även i tomtmarken (ISOM: kurvorna ritas igenom)", () => {
    const kept = [line("101", [[1, 1], [9, 9]]), line("103", [[1, 2], [9, 3]]), line("201", [[2, 2], [8, 2]]), area("301", 3, 3, 2), line("505", [[0, 5], [10, 5]]), area("521", 4, 4, 1)];
    expect(maskBuilt(kept, built, mainOf)).toEqual({ objects: kept, removed: 0, clipped: 0 });
  });
  it("klipper en vegetationsyta mot tomtmarken och tar bort den som ligger helt i den", () => {
    const result = maskBuilt([area("406", 5, 0, 10), area("308", 1, 1, 3), area("401", 30, 30, 4)], built, mainOf);
    expect(result).toMatchObject({ removed: 1, clipped: 1 });
    expect(result.objects).toHaveLength(2);
    // Av det gröna (5–15 mm) blir delen utanför tomtmarken (10–15 mm) kvar.
    expect(extent(result.objects[0]!)).toEqual([10, 15]);
    expect(result.objects[1]).toEqual(area("401", 30, 30, 4));
  });
  it("gör ingenting utan bebyggda ytor", () => {
    const all = [point("109", 5, 5), area("406", 5, 2, 10)];
    expect(maskBuilt(all, [], mainOf)).toEqual({ objects: all, removed: 0, clipped: 0 });
  });
});
