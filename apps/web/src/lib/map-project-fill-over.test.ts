import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { addEdit, effectiveState, emptyClientState, emptyHistory, objectBox, recordSteps, undoStep, type ObjectKey, type RevisionClientState } from "@o-tid/map-revision";
import { fillFinder, type FillInput } from "./map-project-fill-area";
import { fillChangeList, overChanges } from "./map-project-fill-over";

/** K8b V7 Fyll över (ägaren 2026-11-23, Liljeholmen och Gröndal: vägen mellan kanterna över grundkartans ytor). 1:4 000. */
const SCALE = 4000;
const symbol = (id: string, main: number, kind = "AREA") => [id, { id, code: { main, text: String(main) }, name: id, hidden: false, kind } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501, "LINE"), symbol("väg", 501), symbol("gult", 403), symbol("tomt", 520), symbol("hus", 521), symbol("vatten", 301)]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const rect = (id: string, x: number, y: number, w: number, h = w): MapObject => ({ kind: "area", symbol: id, angle: 0, rings: [path(x, y, x + w, y, x + w, y + h, x, y + h)] });
/** Rutan 10 × 10 mm av kantlinjer; inuti gult (helt), tomtmark som sticker ut till vänster, en skärva tomtmark, ett hus och vatten. */
const objects: MapObject[] = [
  { kind: "line", symbol: "kant", path: path(0, 0, 10, 0, 10, 10, 0, 10, 0, 0) },
  rect("gult", 4, 4, 2), rect("tomt", -5, 2, 10, 6), rect("tomt", -0.05, 9, 3.05, 0.5), rect("hus", 7, 7, 2), rect("vatten", 1, 0.5, 1)
];
const keys: ObjectKey[] = objects.map((_, index) => `k${index}`);
const map: FillInput = { objects, boxes: objects.map(objectBox), symbols, scale: SCALE };
const overInput = { objects, boxes: map.boxes, keys, refs: new Map(), symbols, scale: SCALE };

describe("Fyll över", () => {
  it("läget av: tomtmarkens kant är en gräns och rutan finns redan som tomtmark (som förut)", () => {
    const result = fillFinder()(map, { point: { x: 3, y: 5 }, hidden: [], diagnose: true });
    expect(result).toMatchObject({ status: "found", covered: { index: 2, symbol: "tomt" } });
  });

  it("i läget räknas rutan bara av linjer och hårda ytor; markytorna klipps och hus och vatten rörs inte", () => {
    const result = fillFinder()(map, { point: { x: 3, y: 5 }, hidden: [], diagnose: true, over: "ISSPROM", symbol: "väg" });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.covered).toBeUndefined();
    // 40 × 40 m utan huset (8 × 8 m) och vattnet (4 × 4 m).
    expect(result.areaM2).toBeCloseTo(1600 - 64 - 16, 6);
    const { changes, overlay } = overChanges(overInput, result.rings, { norm: "ISSPROM", hidden: [], symbol: "väg" });
    // Gult helt täckt → borttaget; tomtmarken beskuren till det som ligger utanför; skärvan (0,05 × 0,5 mm = 0,4 m²) borttagen.
    expect(changes.map(change => [change.key, change.objects.length])).toEqual([["k1", 0], ["k2", 1], ["k3", 0]]);
    const kept = changes[1]!.objects[0]!;
    expect(kept.kind === "area" && Math.max(...kept.rings[0]!.map(point => point.x))).toBeCloseTo(0, 6);
    expect(overlay).toMatchObject({ count: 3, codes: ["403", "520"] });
    // Hus och vatten klipps aldrig, inte ens när den nya ytan ritas över dem.
    const all = overChanges(overInput, [[{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 11 }, { x: -1, y: 11 }]], { norm: "ISSPROM", hidden: [] });
    expect(all.changes.map(change => change.key)).toEqual(["k1", "k2", "k3"]);
  });

  it("en markyta med samma symbol som redan täcker hela rutan är en dubblett", () => {
    const covered = fillFinder()(map, { point: { x: 3, y: 5 }, hidden: [], diagnose: true, over: "ISSPROM", symbol: "tomt" });
    if (covered.status !== "found") throw new Error(covered.status);
    expect(overChanges(overInput, covered.rings, { norm: "ISSPROM", hidden: [], symbol: "tomt" }).covered).toBeUndefined();
    const big = [...objects, rect("tomt", -2, -2, 14)];
    const bigInput = { ...overInput, objects: big, boxes: big.map(objectBox), keys: big.map((_, index) => `k${index}`) };
    expect(overChanges(bigInput, covered.rings, { norm: "ISSPROM", hidden: [], symbol: "tomt" }).covered).toBe(6);
  });

  it("ytan och klippningen är en grupp som Ångra tar tillbaka i ett steg", () => {
    const result = fillFinder()(map, { point: { x: 3, y: 5 }, hidden: [], diagnose: true, over: "ISSPROM", symbol: "väg" });
    if (result.status !== "found") throw new Error(result.status);
    const under = overChanges(overInput, result.rings, { norm: "ISSPROM", hidden: [], symbol: "väg" }).changes;
    let counter = 0;
    const changes = fillChangeList("väg", result.rings, under, () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`);
    expect(changes.map(change => change.kind)).toEqual(["ADD", "DELETE", "RESHAPE", "DELETE"]);
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
    expect(history.undo).toHaveLength(0);
  });
});
