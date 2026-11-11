import { describe, expect, it } from "vitest";
import { depthCandidates } from "./map-project-moisture-depth";

/** En bild 30 × 30 celler: en sänka mitt i (0,2 m), runt den en ring på 0,8 m, resten 3 m, och ett hörn utan data. */
function image() {
  const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const i = (row * width + column) * 4, d = Math.max(Math.abs(column - 15), Math.abs(row - 15));
    const meters = d <= 4 ? 0.2 : d <= 8 ? 0.8 : 3;
    data[i] = data[i + 1] = Math.round(meters / 0.02); data[i + 2] = 255; data[i + 3] = column < 3 && row < 3 ? 0 : 255;
  }
  return { width, height, data };
}
const toSource = (column: number, row: number): [number, number] => [1000 + column * 2, 2000 - row * 2];

describe("fukt med reglage", () => {
  it("blött och fuktigt efter gränserna", () => {
    const result = depthCandidates(image(), { wetMeters: 0.5, moistMeters: 1, minAreaM2: 100 }, toSource, 3006);
    expect(result.data.features.map(feature => feature.layer)).toEqual(["blott", "fuktigt"]);
    // 81 och 289 celler om 4 m²; smala hörn tas bort när masken städas.
    expect(result.wetHa).toBeGreaterThan(0.025); expect(result.wetHa).toBeLessThanOrEqual(0.04);
    expect(result.moistHa).toBeGreaterThan(0.1); expect(result.moistHa).toBeLessThanOrEqual(0.12);
  });
  it("en högre gräns för blött tar med ringen, och en för stor minsta yta tar bort allt blött", () => {
    expect(depthCandidates(image(), { wetMeters: 1, moistMeters: 1.5, minAreaM2: 100 }, toSource, 3006).wetHa).toBeGreaterThan(0.1);
    const big = depthCandidates(image(), { wetMeters: 0.5, moistMeters: 1, minAreaM2: 2000 }, toSource, 3006);
    expect(big.data.features.map(feature => feature.layer)).toEqual([]);
  });
});
