import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { createMapJobCanvas, loadMapJobImage } from "../../../scripts/map-job-canvas";
import { rgbaPng } from "../src/map-project-job-labels";
import { runPhotoCellsJob } from "../src/map-project-job-photo";
import { loadProjectMap, underlayToMap, type LoadedProjectMap } from "../src/map-project-job-run";

/** Ägaren 2026-11-23: Fyll ytor ur flygbilden i kartjobbet (AI-kopplingens classify_cells). */
describe("classify_cells: kartjobbet", () => {
  const fixture = loadProjectMap(new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.omap", import.meta.url))), "kartfil.omap", "test", []);
  const path = (symbolCode: string, points: [number, number][]): MapObject => ({ kind: "line", symbol: fixture.symbolsByCode.get(symbolCode)!.id,
    path: points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })) });
  // 1:10 000: en ruta 20 × 20 mm (200 × 200 m) av stigar, delad på mitten: två rutor om 100 × 200 m.
  const objects = [path("505", [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]), path("505", [[10, 0], [10, 20]])];
  const loaded: LoadedProjectMap = { ...fixture, objects, keys: ["n:a", "n:b"], states: new Map() };
  // Ortofotot (SWEREF 99 TM; kartans mm (0, 0) är (675 000, 6 580 000)): 1 m-pixlar, vänster halva jämnt gräs, höger grå asfalt.
  const layer = { name: "Ortofoto", sha256: "x", width: 220, height: 220, crs: 3006, transform: { a: 1, b: 0, c: 674_990.5, d: 0, e: -1, f: 6_580_209.5 } };
  async function photo(mixed = false) {
    const pixels = new Uint8Array(220 * 220 * 4);
    for (let y = 0; y < 220; y += 1) for (let x = 0; x < 220; x += 1) {
      pixels.set(x < 110 || (mixed && x % 10 < 4) ? [95, 150, 60, 255] : [120, 122, 125, 255], (y * 220 + x) * 4);
    }
    return [{ image: await loadMapJobImage(rgbaPng(220, 220, pixels)), toMap: underlayToMap(layer, fixture.base.georeference!) }];
  }
  const area = { minX: -1, minY: -1, maxX: 21, maxY: 21 }, now = new Date("2026-11-23T12:00:00Z");

  it("utan svar: rutorna klassade ur bilden, gräs till vänster och hårdgjort till höger", async () => {
    const out = runPhotoCellsJob(loaded, { area }, { createCanvas: createMapJobCanvas, rgb: await photo(), ir: [] }, now);
    expect("error" in out).toBe(false);
    const result = (out as { result: { cells: { id: string; guess: string; confidence: number; atMm: number[] }[] } }).result;
    expect(result.cells).toHaveLength(2);
    const left = result.cells.find(cell => cell.atMm[0]! < 10)!, right = result.cells.find(cell => cell.atMm[0]! > 10)!;
    expect(left.guess).toBe("grass"); expect(right.guess).toBe("paved");
    expect(Math.min(left.confidence, right.confidence)).toBeGreaterThanOrEqual(0.5);
  });

  it("med svar blir rutorna ytor i ett förslag; en klass utan symbol i kartan ger ett fel", async () => {
    const rgb = await photo();
    const first = runPhotoCellsJob(loaded, { area }, { createCanvas: createMapJobCanvas, rgb, ir: [] }, now) as { result: { cells: { id: string; atMm: number[] }[] } };
    const right = first.result.cells.find(cell => cell.atMm[0]! > 10)!;
    const answered = runPhotoCellsJob(loaded, { area, answers: [{ id: right.id, class: "trees" }], acceptConfident: true }, { createCanvas: createMapJobCanvas, rgb, ir: [] }, now);
    const result = (answered as { result: { edits: { kind: string; state: { object: { symbol: string } } }[]; summary: { byClass: Record<string, number> } } }).result;
    // Kartan saknar 501 (hårdgjord): den säkra högra rutan tas med som träd (svaret), den vänstra som gräs (401).
    expect(result.summary.byClass).toEqual({ grass: 1, trees: 1 });
    expect(result.edits.map(edit => edit.kind)).toEqual(["ADD", "ADD"]);
    expect(result.edits.map(edit => edit.state.object.symbol).sort()).toEqual([fixture.symbolsByCode.get("401")!.id, fixture.symbolsByCode.get("406")!.id].sort());
    const paved = runPhotoCellsJob(loaded, { area, answers: [{ id: right.id, class: "paved" }] }, { createCanvas: createMapJobCanvas, rgb, ir: [] }, now);
    expect((paved as { result: { errors: string[] } }).result.errors[0]).toContain("saknar en ytsymbol");
    const stale = runPhotoCellsJob(loaded, { area, answers: [{ id: "1:1", class: "grass" }] }, { createCanvas: createMapJobCanvas, rgb, ir: [] }, now);
    expect((stale as { result: { errors: string[] } }).result.errors[0]).toContain("finns inte");
  });

  it("en osäker ruta (blandad) visas utskuren i en bild med sitt nummer", async () => {
    const out = runPhotoCellsJob(loaded, { area }, { createCanvas: createMapJobCanvas, rgb: await photo(true), ir: [] }, now) as
      { result: { image: { number: number; id: string }[]; counts: Record<string, number> }; image?: Uint8Array };
    expect(out.result.counts).toEqual({ grass: 1, unsure: 1 });
    expect(out.result.image).toHaveLength(1);
    expect(out.image?.length).toBeGreaterThan(1000);
  });

  it("utan ortofoto över området och för stort område ger ett besked", async () => {
    expect((runPhotoCellsJob(loaded, { area }, { createCanvas: createMapJobCanvas, rgb: [], ir: [] }, now) as { result: { errors: string[] } }).result.errors[0]).toContain("ortofoton");
    expect((runPhotoCellsJob(loaded, { area: { minX: 0, minY: 0, maxX: 60, maxY: 60 } }, { createCanvas: createMapJobCanvas, rgb: await photo(), ir: [] }, now) as
      { result: { errors: string[] } }).result.errors[0]).toContain("större än");
  });
});
