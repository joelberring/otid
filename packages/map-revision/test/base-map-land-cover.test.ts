import { describe, expect, it } from "vitest";
import { isOpenWetland, landCoverCodesFromBase64, landCoverFeatures, NMD_OPEN_WETLAND_LAYER } from "../src/base-map/land-cover";

/** Ägaren 2026-11-17 («kör NMD»): Naturvårdsverkets öppna våtmark som sankmark i grundkartan. */
describe("NMD:s marktäckedata", () => {
  const width = 40, height = 30;
  // Tallskog (111) överallt, en myr (213) på 12 × 8 rutor och en liten våtmark (224) på en ruta.
  const codes = Uint16Array.from({ length: width * height }, (_, i) => {
    const row = Math.floor(i / width), column = i % width;
    return row >= 5 && row < 13 && column >= 10 && column < 22 ? 213 : row === 25 && column === 3 ? 224 : 111;
  });
  const grid = { minX: 600_000, maxY: 6_600_000, cell: 10, width, height, codes };
  it("öppen våtmark blir en rundad yta på rätt plats, och en ruta för liten tas inte med", () => {
    const features = landCoverFeatures(grid, 15_000);
    expect(features).toHaveLength(1);
    expect(features[0]!.layer).toBe(NMD_OPEN_WETLAND_LAYER);
    const points = features[0]!.geometry.kind === "line" ? features[0]!.geometry.points : [];
    const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
    // Myren ligger 600 100–600 220 öst och 6 599 870–6 599 950 nord; kanten rundas något innanför.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(600_095); expect(Math.max(...xs)).toBeLessThanOrEqual(600_225);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(6_599_865); expect(Math.max(...ys)).toBeLessThanOrEqual(6_599_955);
    // Fler punkter än rektangelns fyra hörn: hörnen är rundade.
    expect(points.length).toBeGreaterThan(8);
  });
  it("klasserna 200–228 är öppen våtmark, skog på våtmark och torr mark är det inte", () => {
    expect([200, 211, 218, 228, 128, 121, 4233, 411].map(isOpenWetland)).toEqual([true, true, true, true, false, false, false, false]);
  });
  it("koderna läses ur base64 (Uint16 little-endian), och fel längd ger inget", () => {
    const text = Buffer.from(new Uint8Array([213, 0, 111, 0, 0x91, 0x10])).toString("base64");
    expect([...landCoverCodesFromBase64(text, 3)!]).toEqual([213, 111, 4241]);
    expect(landCoverCodesFromBase64(text, 4)).toBeUndefined();
  });
});
