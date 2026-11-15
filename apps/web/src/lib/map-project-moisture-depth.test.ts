import { describe, expect, it } from "vitest";
import { depthCandidates } from "./map-project-moisture-depth";

/** En bild 30 × 30 celler: en sänka mitt i (0,2 m), runt den en ring på 0,8 m, resten 3 m, och ett hörn utan data. */
function image(slope = 255) {
  const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const i = (row * width + column) * 4, d = Math.max(Math.abs(column - 15), Math.abs(row - 15));
    const meters = d <= 4 ? 0.2 : d <= 8 ? 0.8 : 3;
    data[i] = data[i + 1] = Math.round(meters / 0.02); data[i + 2] = slope; data[i + 3] = column < 3 && row < 3 ? 0 : 255;
  }
  return { width, height, data };
}
const toSource = (column: number, row: number): [number, number] => [1000 + column * 2, 2000 - row * 2];

describe("fukt med reglage", () => {
  it("blött och fuktigt efter gränserna", () => {
    const result = depthCandidates(image(), { wetMeters: 0.5, moistMeters: 1, minAreaM2: 100 }, toSource, 3006);
    expect(result.data.features.map(feature => feature.layer)).toEqual(["blott", "fuktigt"]);
    // 81 celler om 4 m² blött och 289 − 81 fuktigt runt det (ägaren 2026-11-15: inte dubbla raster); smala hörn tas bort.
    expect(result.wetHa).toBeGreaterThan(0.025); expect(result.wetHa).toBeLessThanOrEqual(0.04);
    expect(result.moistHa).toBeGreaterThan(0.07); expect(result.moistHa).toBeLessThanOrEqual(0.084);
    // Det fuktiga är en yta med ett hål där det blöta ligger.
    const moist = result.data.features.find(feature => feature.layer === "fuktigt")!.geometry;
    expect(moist.kind === "area" ? moist.rings.length : 0).toBe(2);
  });
  it("en högre gräns för blött tar med ringen, och en för stor minsta yta tar bort allt blött", () => {
    expect(depthCandidates(image(), { wetMeters: 1, moistMeters: 1.5, minAreaM2: 100 }, toSource, 3006).wetHa).toBeGreaterThan(0.1);
    const big = depthCandidates(image(), { wetMeters: 0.5, moistMeters: 1, minAreaM2: 2000 }, toSource, 3006);
    expect(big.data.features.map(feature => feature.layer)).toEqual([]);
  });
  it("bara flack mark: lutningen i blå kanal (0,1° per steg), 255 = okänd (ägaren 2026-11-11)", () => {
    const settings = { wetMeters: 0.5, moistMeters: 1, minAreaM2: 100 };
    expect(depthCandidates(image(20), settings, toSource, 3006).wetHa).toBeGreaterThan(0.025);
    expect(depthCandidates(image(50), settings, toSource, 3006).wetHa).toBe(0);
    expect(depthCandidates(image(50), settings, toSource, 3006).moistHa).toBeGreaterThan(0.1);
    expect(depthCandidates(image(20), settings, toSource, 3006).moistHa).toBeLessThan(0.09);
    expect(depthCandidates(image(50), { ...settings, wetSlopeDegrees: 6 }, toSource, 3006).wetHa).toBeGreaterThan(0.025);
  });
  it("inte på öppen mark: grön kanal är markträffarnas andel i nya bilder (lärt av Högdalenkartan)", () => {
    const settings = { wetMeters: 0.5, moistMeters: 1, minAreaM2: 100 };
    const withShare = (share: number) => { const pixels = image(20); for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 1] = Math.round(share * 254); return pixels; };
    expect(depthCandidates(withShare(0.4), settings, toSource, 3006).wetHa).toBeGreaterThan(0.025);
    // Bildens hörn utan data ligger mer än 30 m från sänkan; med vatten (genomskinligt) intill räknas den öppna sänkan som strandkärr.
    expect(depthCandidates(withShare(0.9), settings, toSource, 3006).wetHa).toBe(0);
    const shore = withShare(0.9);
    for (let row = 0; row < 30; row += 1) for (let column = 0; column < 9; column += 1) shore.data[(row * 30 + column) * 4 + 3] = 0;
    expect(depthCandidates(shore, settings, toSource, 3006).wetHa).toBeGreaterThan(0.025);
    expect(depthCandidates(withShare(0.9), { ...settings, openGroundShare: 1 }, toSource, 3006).wetHa).toBeGreaterThan(0.025);
  });
  it("öppen blöt mark vid vatten som ligger lägst blir misstänkt oöverkomlig sankmark (307), ägaren 2026-11-15", () => {
    const settings = { wetMeters: 0.5, moistMeters: 1, minAreaM2: 100 };
    const shore = image(20);
    for (let i = 0; i < shore.data.length; i += 4) { shore.data[i + 1] = 240; if (shore.data[i] === 10) shore.data[i] = 4; }
    for (let row = 0; row < 30; row += 1) for (let column = 0; column < 9; column += 1) shore.data[(row * 30 + column) * 4 + 3] = 0;
    const result = depthCandidates(shore, settings, toSource, 3006);
    expect(result.soddenHa).toBeGreaterThan(0.025); expect(result.wetHa).toBe(0);
    expect(result.data.features.map(feature => feature.layer)).toContain("sankmark_misstankt_ooverkomlig");
    // I skog (låg andel markträffar) är samma sänka vanligt blött.
    const forest = image(20);
    for (let i = 0; i < forest.data.length; i += 4) { forest.data[i + 1] = 60; if (forest.data[i] === 10) forest.data[i] = 4; }
    expect(depthCandidates(forest, settings, toSource, 3006).soddenHa).toBe(0);
  });
});
