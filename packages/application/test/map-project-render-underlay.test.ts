import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMapJobCanvas, loadMapJobImage } from "../../../scripts/map-job-canvas";
import { decodeRgbaPng, rgbaPng } from "../src/map-project-job-labels";
import { loadProjectMap, runRender, underlayToMap } from "../src/map-project-job-run";

/** Ägaren 2026-11-17: AI-kopplingens render_view kan rita underlagen (ortofoto, IR, skuggning) under kartan. */
describe("render_view med underlag", () => {
  const loaded = loadProjectMap(new Uint8Array(readFileSync(new URL("../../../fixtures/maps/kartfil.omap", import.meta.url))), "kartfil.omap", "test", []);
  // Kartan: 1:10 000, kartans mm (0, 0) är SWEREF 99 TM (675 000, 6 580 000). Ett rött underlag på 20 × 20 m i 1 m-pixlar uppe till vänster.
  const layer = { name: "Ortofoto", sha256: "x", width: 20, height: 20, crs: 3006, transform: { a: 1, b: 0, c: 675_000.5, d: 0, e: -1, f: 6_580_099.5 } };
  it("bildens pixlar räknas om till kartans mm", () => {
    const t = underlayToMap(layer, loaded.base.georeference!);
    expect(t.a).toBeCloseTo(0.1, 6); expect(t.e).toBeCloseTo(-0.1, 6);
    expect(t.c).toBeCloseTo(0.05, 4); expect(t.f).toBeCloseTo(9.95, 4);
  });
  it("underlaget ritas på rätt plats under kartan, och kartan kan släckas helt", async () => {
    const red = new Uint8Array(20 * 20 * 4);
    for (let p = 0; p < 400; p += 1) red.set([220, 30, 30, 255], p * 4);
    const image = await loadMapJobImage(rgbaPng(20, 20, red));
    const rendered = runRender(loaded, { area: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, widthPx: 200, grid: false, mapOpacity: 0 }, null, createMapJobCanvas,
      [{ image, toMap: underlayToMap(layer, loaded.base.georeference!) }]);
    const png = decodeRgbaPng(rendered.png)!;
    const at = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    // Kartans mm (1, 9) är bildens pixel (20, 20): rött. (5, 5) är (100, 100): vit botten.
    expect(at(20, 20)).toEqual([220, 30, 30]);
    expect(at(100, 100)).toEqual([255, 255, 255]);
  });
});
