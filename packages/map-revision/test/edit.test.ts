import { describe, expect, it } from "vitest";
import { readMapFile, type MapObject } from "@o-tid/map-file";
import { readFileSync } from "node:fs";
import {
  baseKeys, changeCounts, changeSet, changesGeoJson, deleteVertex, editedObjects, editProblem, hitTest, insertPoints, insertVertex, mapperChangesFile,
  moveVertex, newKey, newObject, objectRefAt, symbolObjectKind, validObject, vertices, withSymbol, type KeyedState
} from "../src";

const line: MapObject = { kind: "line", symbol: "5", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }] };
const curved: MapObject = { kind: "line", symbol: "5", path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 2, y1: 2, x2: 8, y2: 2, x: 10, y: 0 },
  { type: "L", x: 20, y: 0 }] };
const area: MapObject = { kind: "area", symbol: "1", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 },
  { type: "L", x: 0, y: 10 }]] };

describe("redigeringen", () => {
  it("flyttar punkter och låter kurvans styrpunkter följa med", () => {
    expect(moveVertex(line, { part: 0, index: 1 }, { x: 12, y: 1 })).toMatchObject({ path: [{ x: 0 }, { x: 12, y: 1 }, { x: 10, y: 10 }] });
    const result = moveVertex(curved, { part: 0, index: 1 }, { x: 11, y: 1 });
    expect(result.kind === "line" && result.path[1]).toEqual({ type: "C", x1: 2, y1: 2, x2: 9, y2: 3, x: 11, y: 1 });
    expect(vertices(curved).map(vertex => vertex.curve)).toEqual([true, true, false]);
    const point: MapObject = { kind: "point", symbol: "7", at: { x: 1, y: 1 }, angle: 30 };
    expect(moveVertex(point, { part: 0, index: 0 }, { x: 3, y: 4 })).toEqual({ ...point, at: { x: 3, y: 4 } });
  });

  it("lägger till punkter bara på raka sträckor, också ytans stängande", () => {
    expect(insertPoints(curved).map(row => row.index)).toEqual([1]);
    expect(insertVertex(curved, { part: 0, index: 0 }, { x: 5, y: 1 })).toBeUndefined();
    expect(insertPoints(area).map(row => row.index)).toEqual([0, 1, 2, 3]);
    const result = insertVertex(area, { part: 0, index: 3 }, { x: 0, y: 5 });
    expect(result?.kind === "area" && result.rings[0]!.length).toBe(5);
  });

  it("tar bort punkter men aldrig under minsta antalet", () => {
    expect(deleteVertex(line, { part: 0, index: 0 })).toMatchObject({ path: [{ type: "M", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }] });
    expect(deleteVertex(deleteVertex(line, { part: 0, index: 1 })!, { part: 0, index: 1 })).toBeUndefined();
    expect(deleteVertex(area, { part: 0, index: 2 })).toMatchObject({ rings: [[{ x: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]] });
    // En punkt mellan en kurva och en rak sträcka: en kurva med de yttre styrpunkterna.
    const merged = deleteVertex(curved, { part: 0, index: 1 });
    expect(merged?.kind === "line" && merged.path[1]).toEqual({ type: "C", x1: 2, y1: 2, x2: 20, y2: 0, x: 20, y: 0 });
  });

  it("gör nya objekt, byter symbol och prövar objekt", () => {
    expect(newObject("line", "5", [{ x: 0, y: 0 }])).toBeUndefined();
    const added = newObject("area", "1", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])!;
    expect(validObject(added)).toBe(true);
    expect(validObject({ ...line, path: [{ type: "L", x: 0, y: 0 }] })).toBe(false);
    expect(validObject({ kind: "point", symbol: "7", at: { x: Number.NaN, y: 0 }, angle: 0 })).toBe(false);
    expect(withSymbol(line, "4").symbol).toBe("4");
  });

  it("prövar ändringens nyckel mot referensen", () => {
    const base = { editId: "11111111-1111-4111-8111-111111111111", base: null, kind: "MOVE", at: "2026-11-03T10:00:00Z",
      state: { kind: "OBJECT", object: line } };
    expect(editProblem({ ...base, key: "b:3", ref: { index: 3 } })).toBeUndefined();
    expect(editProblem({ ...base, key: "b:3", ref: { index: 4 } })).toBe("ref");
    expect(editProblem({ ...base, key: newKey("22222222-2222-4222-8222-222222222222"), ref: null })).toBeUndefined();
    expect(editProblem({ ...base, key: newKey("22222222-2222-4222-8222-222222222222"), ref: null, state: { kind: "UNCHANGED" } })).toBe("state");
  });
});

describe("kartan med ändringarna och exporten", () => {
  const text = readFileSync(new URL("../../../fixtures/maps/kartfil.omap", import.meta.url), "utf8");
  const map = readMapFile(new TextEncoder().encode(text));
  const keys = baseKeys(map);
  const firstPoint = map.objects.findIndex(object => object.kind === "point");
  const firstLine = map.objects.findIndex(object => object.kind === "line");
  const pointObject = map.objects[firstPoint]!;
  if (pointObject.kind !== "point") throw new Error("ingen punkt");
  const states = new Map<string, KeyedState>([
    [keys[firstPoint]!, { ref: objectRefAt(map, firstPoint), state: { kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + 5, y: pointObject.at.y } } } }],
    [keys[firstLine]!, { ref: objectRefAt(map, firstLine), state: { kind: "DELETED" } }],
    [newKey("33333333-3333-4333-8333-333333333333"), { ref: null, state: { kind: "OBJECT", object: newObject("line", map.objects[firstLine]!.symbol,
      [{ x: 10, y: 10 }, { x: 30, y: 12 }])! } }]
  ]);

  it("byter, tar bort och lägger till objekt i kartans lista", () => {
    const edited = editedObjects(map, states, keys);
    expect(edited.objects).toHaveLength(map.objects.length);
    expect(edited.keys).not.toContain(keys[firstLine]);
    expect(edited.keys.at(-1)).toMatch(/^n:/);
    const set = changeSet("a".repeat(64), map.format, states);
    expect(set.changes.map(change => change.kind).sort()).toEqual(["ADD", "DELETE", "MODIFY"]);
    expect(changeCounts(set.changes)).toEqual({ added: 1, modified: 1, deleted: 1, total: 3 });
  });

  it("träffar punkter före linjer före ytor", () => {
    const edited = editedObjects(map, new Map(), keys);
    const at = pointObject.at;
    const hits = hitTest({ objects: edited.objects, keys: edited.keys, symbols: map.symbols }, at, 1);
    expect(hits[0]!.key).toBe(keys[firstPoint]);
    expect(hits.map(hit => hit.tier)).toEqual([...hits.map(hit => hit.tier)].sort());
  });

  it("exporterar ändringarna som GeoJSON och som en Mapper-fil som går att läsa", () => {
    const set = changeSet("a".repeat(64), map.format, states);
    const geo = changesGeoJson(map, set.changes) as { crs?: unknown; features: { properties: { change: string } }[] };
    expect(geo.crs).toEqual({ type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3006" } });
    expect(geo.features.map(feature => feature.properties.change).sort()).toEqual(["ADD", "DELETE", "MODIFY"]);
    const file = mapperChangesFile(text, map, set.changes)!;
    const read = readMapFile(new TextEncoder().encode(file));
    expect(read.objects).toHaveLength(3);
    expect(read.colors).toEqual(map.colors);
    expect(read.georeference).toEqual(map.georeference);
    const point = read.objects.find(object => object.kind === "point");
    expect(point?.kind === "point" && point.at.x).toBeCloseTo(pointObject.at.x + 5, 3);
  });

  it("vet vilket slags objekt varje symbol ritar", () => {
    const kinds = [...map.symbols.values()].map(symbol => symbolObjectKind(map, symbol));
    expect(kinds).toContain("area");
    expect(kinds).toContain("line");
  });
});
