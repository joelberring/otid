import { describe, expect, it } from "vitest";
import { newMapFile, type MapObject } from "@o-tid/map-file";
import { newObject } from "@o-tid/map-revision";
import { runBaseMap, type BaseMapJobRequest } from "../src/map-project-job-base-map";
import { runClearBuilt } from "../src/map-project-job-generalize";
import { loadProjectMap, symbolCode, type StoredObjectRow } from "../src/map-project-job-run";

/**
 * Ägaren 2026-11-16: «det som lyser över fel på tomtmark» (clear_built) och «fylla det hav som saknas» (apply_base_map med
 * symbols och replace). En ny karta ur O-Tids mall med objekt som projektets ändringar, som i ett kartprojekt.
 */
const bytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: { easting: 668000, northing: 6524000 }, declinationDegrees: 0 });
const empty = loadProjectMap(bytes, "ny.omap", "0".repeat(64), []);
const idOf = (code: string) => { const symbol = empty.symbolsByCode.get(code); if (!symbol) throw new Error(`Symbolen ${code} saknas i mallen`); return symbol.id; };
const square = (x: number, y: number, side: number) => [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];
const row = (key: string, object: MapObject | undefined): StoredObjectRow => {
  if (!object) throw new Error("Objektet gick inte att skapa");
  return { objectKey: `n:${key}`, ref: null, state: { kind: "OBJECT", object }, lastEditId: `edit-${key}` };
};
const now = new Date("2026-11-16T12:00:00Z");

describe("clear_built: det bebyggda städas i en karta som redan har objekten", () => {
  const loaded = loadProjectMap(bytes, "ny.omap", "0".repeat(64), [
    row("tomt", newObject("area", idOf("520"), square(0, 0, 10))),
    row("berg-halvt", newObject("area", idOf("214"), square(8, 2, 4))),
    row("berg-i", newObject("area", idOf("214"), square(2, 2, 2))),
    row("berg-utanfor", newObject("area", idOf("214"), square(20, 0, 3))),
    row("karr-i", newObject("area", idOf("308"), square(5, 5, 2))),
    row("kulle-i", newObject("point", idOf("109"), [{ x: 3, y: 7 }])),
    row("kulle-utanfor", newObject("point", idOf("109"), [{ x: 15, y: 7 }])),
    row("kurva", newObject("line", idOf("101"), [{ x: -5, y: 5 }, { x: 15, y: 5 }])),
    row("brant", newObject("line", idOf("202"), [{ x: 1, y: 1 }, { x: 4, y: 1 }])),
    row("hus", newObject("area", idOf("521"), square(6, 1, 1)))
  ]);

  it("tar bort markens detaljer i tomten, klipper ytor mot kanten och lämnar kurvor, branter och hus", () => {
    const result = runClearBuilt(loaded, { clearBuilt: true }, now);
    expect(result.summary).toMatchObject({ removed: 3, clipped: 1, skipped: 0, changes: 4 });
    expect(result.changes.map(change => `${change.key} ${change.symbol} ${change.reason}`).sort()).toEqual([
      "n:berg-halvt 214 CLIPPED", "n:berg-i 214 REMOVED", "n:karr-i 308 REMOVED", "n:kulle-i 109 REMOVED"]);
    expect("edits" in result).toBe(false);
  });

  it("med propose blir det ändringar: borttagna objekt och den klippta ytan utanför tomten", () => {
    const result = runClearBuilt(loaded, { clearBuilt: true, propose: true }, now);
    if (!("edits" in result) || !result.edits) throw new Error("Inga ändringar");
    expect(result.edits.map(edit => `${edit.key} ${edit.kind} ${edit.base}`).sort()).toEqual([
      "n:berg-halvt RESHAPE edit-berg-halvt", "n:berg-i DELETE edit-berg-i", "n:karr-i DELETE edit-karr-i", "n:kulle-i DELETE edit-kulle-i"]);
    const reshaped = result.edits.find(edit => edit.kind === "RESHAPE")!;
    const object = reshaped.state.kind === "OBJECT" ? reshaped.state.object : undefined;
    if (object?.kind !== "area") throw new Error("Den klippta ytan saknas");
    const xs = object.rings[0]!.map(point => point.x);
    // Berghällen låg på x 8–12 och tomten slutar vid x 10: kvar blir delen öster om tomtgränsen.
    expect(Math.min(...xs)).toBeCloseTo(10, 5);
    expect(Math.max(...xs)).toBeCloseTo(12, 5);
  });

  it("området begränsar städningen", () => {
    const result = runClearBuilt(loaded, { clearBuilt: true, area: { minX: 4.5, minY: 4.5, maxX: 7.5, maxY: 7.5 } }, now);
    expect(result.changes.map(change => change.key)).toEqual(["n:karr-i"]);
  });
});

describe("apply_base_map med symbols och replace", () => {
  // Laserjobbets vatten: en sjö mitt i kartan (SWEREF 99 TM, 300 × 300 m) och en kurva.
  const lake = [[667850, 6523850], [668150, 6523850], [668150, 6524150], [667850, 6524150], [667850, 6523850]];
  const water = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [lake] }, properties: { layer: "vatten" } }] });
  const contours = `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\ncontour\n90\n2\n70\n0\n10\n667000\n20\n6524500\n10\n669000\n20\n6524500\n0\nENDSEC\n0\nEOF\n`;
  const request: BaseMapJobRequest = { hash: "h", files: [{ name: "vatten.geojson", sha256: "w" }, { name: "kurvor.dxf", sha256: "c" }], scannedAt: null, missing: [] };
  const texts = new Map([["w", water], ["c", contours]]);
  const withOldLake = loadProjectMap(bytes, "ny.omap", "0".repeat(64), [
    row("gammal-sjo", newObject("area", idOf("301"), square(-5, -5, 4))),
    row("gammal-strand", newObject("line", idOf("301.1"), [...square(-5, -5, 4), { x: -5, y: -5 }])),
    row("sten", newObject("point", idOf("204"), [{ x: 30, y: 30 }]))
  ]);
  const codes = (edits: readonly { kind: string; state: { kind: string; object?: MapObject } }[]) => edits.filter(edit => edit.kind === "ADD")
    .map(edit => { const symbol = withOldLake.base.symbols.get(edit.state.object!.symbol); return symbol ? symbolCode(symbol) : ""; }).sort();

  it("lägger bara in de valda symbolerna", () => {
    const whole = runBaseMap(withOldLake, null, request, texts, now);
    if ("problem" in whole) throw new Error(whole.problem);
    expect(codes(whole.parts.flat())).toContain("101");
    const result = runBaseMap(withOldLake, null, { ...request, only: ["301", "301.1"] }, texts, now);
    if ("problem" in result) throw new Error(result.problem);
    expect(codes(result.parts.flat())).toEqual(["301", "301.1"]);
    expect(result.parts.flat().every(edit => edit.kind === "ADD")).toBe(true);
    expect(result.summary).toMatchObject({ objects: 2, symbols: [{ symbol: "301", objects: 1 }, { symbol: "301.1", objects: 1 }] });
    expect(result.summary.replaced).toBeUndefined();
  });

  it("med replace tas kartans objekt med samma symboler bort först, och annat står kvar", () => {
    const result = runBaseMap(withOldLake, null, { ...request, only: ["301", "301.1"], replace: true }, texts, now);
    if ("problem" in result) throw new Error(result.problem);
    const edits = result.parts.flat();
    expect(edits.map(edit => `${edit.kind} ${edit.kind === "DELETE" ? edit.key : ""}`.trim())).toEqual(["DELETE n:gammal-sjo", "DELETE n:gammal-strand", "ADD", "ADD"]);
    expect(edits.filter(edit => edit.kind === "DELETE").map(edit => edit.base)).toEqual(["edit-gammal-sjo", "edit-gammal-strand"]);
    expect(result.summary).toMatchObject({ objects: 2, replaced: 2 });
  });

  it("säger till när grundkartan saknar de valda symbolerna", () => {
    expect(runBaseMap(withOldLake, null, { ...request, only: ["999"] }, texts, now)).toMatchObject({ problem: expect.stringContaining("999") as unknown });
  });
});
