import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { builtPolygons, extendAreas, FIELD_MAINS, maskBuilt } from "../src/base-map/built-mask";

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

describe("flygbildens berg och öppna mark inte på åker (ägaren 2026-11-18)", () => {
  const fields = builtPolygons([area("412", 0, 0, 10), area("520", 20, 0, 10)], mainOf, FIELD_MAINS);
  it("tar åker och fruktodling, inte tomtmark", () => {
    expect(fields).toHaveLength(1);
  });
  it("tar bort berg i dagen och öppen mark på åkern men behåller diken, kurvor och berg utanför", () => {
    const kept = [line("306", [[1, 1], [9, 9]]), line("101", [[1, 2], [9, 3]]), area("214", 40, 40, 5)];
    const result = maskBuilt([area("214", 2, 2, 3), area("401", 3, 3, 2), ...kept], [], mainOf, fields);
    expect(result.objects).toEqual(kept);
    expect(result.removed).toBe(2);
  });
});

describe("utvidga befintliga ytor (ägaren 2026-11-18)", () => {
  it("slår ihop en kandidat med kartans yta med samma symbol och lägger till de andra", () => {
    const old = [{ id: "a", object: area("214", 0, 0, 10) }, { id: "b", object: area("401", 0, 0, 10) }, { id: "c", object: area("214", 100, 100, 5) }];
    const result = extendAreas([area("214", 5, 5, 10), area("214", 50, 50, 5), line("306", [[0, 0], [1, 1]])], old);
    expect(result.removed).toEqual(["a"]);
    expect(result.extended).toBe(1);
    expect(result.adds).toHaveLength(3);
    const merged = result.adds.find(object => object.kind === "area" && extent(object)[1] === 15);
    expect(merged && extent(merged)).toEqual([0, 15]);
  });
  it("en kandidat som rör två gamla ytor gör dem till en", () => {
    const old = [{ id: 1, object: area("406", 0, 0, 10) }, { id: 2, object: area("406", 20, 0, 10) }];
    const result = extendAreas([area("406", 8, 2, 14)], old);
    expect(result.removed.sort()).toEqual([1, 2]);
    expect(result.adds).toHaveLength(1);
  });
  it("spatialt index i maskBuilt och extendAreas ger exakt resultat för hundratals ytor", () => {
    const manyBuilt = Array.from({ length: 200 }, (_, i) => area("520", (i % 20) * 10, Math.floor(i / 20) * 10, 4));
    const builtPolys = builtPolygons(manyBuilt, mainOf);
    const candidates = [
      ...Array.from({ length: 200 }, (_, i) => point("109", (i % 20) * 10 + 2, Math.floor(i / 20) * 10 + 2)),
      ...Array.from({ length: 200 }, (_, i) => point("109", (i % 20) * 10 + 7, Math.floor(i / 20) * 10 + 7))
    ];
    const masked = maskBuilt(candidates, builtPolys, mainOf);
    expect(masked.removed).toBe(200);
    expect(masked.objects).toHaveLength(200);

    const existing = Array.from({ length: 200 }, (_, i) => ({ id: i, object: area("406", (i % 20) * 10, Math.floor(i / 20) * 10, 4) }));
    const overlapping = Array.from({ length: 50 }, (_, i) => area("406", (i % 20) * 10 + 2, Math.floor(i / 20) * 10, 4));
    const extended = extendAreas(overlapping, existing);
    expect(extended.extended).toBe(50);
    expect(extended.removed).toHaveLength(50);
    expect(extended.adds).toHaveLength(50);
  });
});
