import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { addEdit, effectiveState, emptyClientState, emptyHistory, objectBox, recordSteps, undoStep, type ObjectKey, type RevisionClientState } from "@o-tid/map-revision";
import type { PhotoRaster } from "@o-tid/map-revision/base-map";
import { photoCellTaken } from "../components/map-project/use-map-project-photo-fill";
import { photoCells, photoChangeList, photoCuts, photoTiles } from "./map-project-photo-fill";

/** Fyll ytor ur flygbilden (ägaren 2026-11-23): Workerns rutor och klassning, inläggningen som en ångringsbar grupp. 1:4 000. */
const SCALE = 4000;
const symbol = (id: string, main: number, kind = "AREA") => [id, { id, code: { main, text: String(main) }, name: id, hidden: false, kind } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501, "LINE"), symbol("väg", 501), symbol("gräs", 401), symbol("gult", 403), symbol("hus", 521)]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
/** Två rutor 10 × 5 mm av kantlinjer (gata i söder, gräsmatta i norr), ett hus i gräsmattan och grundkartans gult över båda. */
const objects: MapObject[] = [
  { kind: "line", symbol: "kant", path: path(0, 0, 10, 0, 10, 10, 0, 10, 0, 0) }, { kind: "line", symbol: "kant", path: path(0, 5, 10, 5) },
  { kind: "area", symbol: "hus", angle: 0, rings: [path(6, 6, 8, 6, 8, 8, 6, 8)] },
  { kind: "area", symbol: "gult", angle: 0, rings: [path(1, 1, 9, 1, 9, 9, 1, 9)] }
];
const keys: ObjectKey[] = objects.map((_, index) => `k${index}`);
const map = { objects, boxes: objects.map(objectBox), symbols, scale: SCALE, norm: "ISSPROM" as const, keys, refs: new Map() };
/** Bilden: 0,05 mm per bildpunkt över kartans 0–10 mm; norra halvan gräs, södra asfalt. */
function photo(): PhotoRaster {
  const width = 200, height = 200, data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    data.set(row < 100 ? [95 + (column % 3), 150, 60, 255] : [120 + (column % 3), 122, 125, 255], (row * width + column) * 4);
  }
  return { width, height, data, minX: 0, maxY: 10, step: 0.05 };
}
const box = { minX: -1, minY: -1, maxX: 11, maxY: 11 };

describe("Fyll ytor ur flygbilden", () => {
  it("rutorna med grundkartans gult klassas: gatan hårdgjord, gräsmattan (med huset som hål) gräs", () => {
    const result = photoCells(map, { box, core: box, hidden: [], includeGround: true, rgb: photo() });
    expect(result.status).toBe("done");
    const cells = result.status === "done" ? result.cells : [];
    expect(cells.map(cell => cell.guess).sort()).toEqual(["grass", "paved"]);
    expect(cells.every(cell => cell.state === "ground" && photoCellTaken(cell, false))).toBe(true);
    // Utan markytorna kommer rutorna under gult inte med.
    expect(photoCells(map, { box, core: box, hidden: [], includeGround: false, rgb: photo() })).toEqual({ status: "done", cells: [] });
    // Släckt gult är ingen markyta att räkna med: rutorna är ofyllda.
    expect(photoCells(map, { box, core: box, hidden: ["gult"], includeGround: false, rgb: photo() }).status === "done").toBe(true);
  });

  it("inläggningen: två ytor och gult som klipps (bara biten under huset blir kvar), i en grupp som Ångra tar tillbaka", () => {
    const result = photoCells(map, { box, core: box, hidden: [], includeGround: true, rgb: photo() });
    const cells = result.status === "done" ? result.cells : [];
    const areas = cells.map(cell => ({ symbol: cell.guess === "paved" ? "väg" : "gräs", rings: cell.rings }));
    const under = photoCuts(map, areas, []);
    expect(under).toHaveLength(1);
    expect(under[0]!.key).toBe("k3");
    expect(objectBox(under[0]!.objects[0]!)).toEqual({ minX: 6, minY: 6, maxX: 8, maxY: 8 });
    let id = 0;
    const changes = photoChangeList(areas, under, () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
    expect(changes.map(change => change.kind)).toEqual(["ADD", "ADD", "RESHAPE"]);
    expect(new Set(changes.map(change => change.group)).size).toBe(1);
    const at = "2026-11-23T12:00:00.000Z";
    let state: RevisionClientState = emptyClientState();
    const steps = changes.map(change => {
      const before = effectiveState(state, change.key);
      state = addEdit(state, { editId: `e-${change.key}`, key: change.key, ref: change.ref, state: change.after, kind: change.kind, at })!.state;
      return { key: change.key, ref: change.ref, before, after: change.after, group: change.group };
    });
    const befores = steps.map(step => step.before);
    let history = recordSteps(emptyHistory(), steps);
    for (let step = 0; step < changes.length; step += 1) {
      const outcome = undoStep(state, history, `u-${step}`, at);
      if (outcome.kind !== "done") throw new Error(outcome.kind);
      state = outcome.state; history = outcome.history;
    }
    expect(changes.map(change => effectiveState(state, change.key))).toEqual(befores);
  });

  it("hela kartan delas i etapper om högst 400 m", () => {
    const tiles = photoTiles({ minX: 0, minY: 0, maxX: 250, maxY: 120 }, SCALE);
    expect(tiles).toHaveLength(3 * 2);
    expect(Math.max(...tiles.map(tile => tile.maxX - tile.minX))).toBeCloseTo(100);
  });
});
