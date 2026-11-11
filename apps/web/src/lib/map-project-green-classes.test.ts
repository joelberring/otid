import { describe, expect, it } from "vitest";
import { greenCandidates, DEFAULT_GREEN } from "./map-project-green-classes";

/** 30 × 30 celler: västra tredjedelen öppen (1), mitten steg 3 (klass 5), östra steg 5 (klass 7) med svår undervegetation. */
function image() {
  const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const i = (row * width + column) * 4;
    data[i] = column < 10 ? 1 : column < 20 ? 5 : 7 | (2 << 4); data[i + 1] = 160; data[i + 3] = 255;
  }
  return { width, height, data };
}
const toSource = (column: number, row: number): [number, number] => [column * 2, -row * 2];

describe("grönt med reglage", () => {
  it("förvalen ger öppet, grönt i stegen och undervegetation", () => {
    const result = greenCandidates(image(), DEFAULT_GREEN, toSource, 3006);
    expect([...new Set(result.data.features.map(feature => feature.layer))].sort()).toEqual(
      ["gron_lattlopt", "gron_mycket_svarlopt", "gron_svarlopt", "oppen_mark", "undervegetation_lattlopt", "undervegetation_svarlopt"]);
    expect(result.hectares.gron_mycket_svarlopt!).toBeLessThan(result.hectares.gron_lattlopt!);
  });
  it("beståndsgränser: färre med större minsta bestånd, inga som förval", () => {
    const count = (borders: "none" | "few" | "many") => greenCandidates(image(), { ...DEFAULT_GREEN, borders }, toSource, 3006).data.features
      .filter(feature => feature.layer === "bestandsgrans_laser").length;
    expect(count("none")).toBe(0);
    expect(count("many")).toBeGreaterThan(0);
    expect(count("few")).toBeLessThanOrEqual(count("many"));
  });
  it("högre steg för grönt ger mindre grönt, och undervegetationen kan slås av", () => {
    const less = greenCandidates(image(), { ...DEFAULT_GREEN, slow: 4, difficult: 5, fight: 6, undergrowth: false }, toSource, 3006);
    expect(less.hectares.gron_lattlopt!).toBeLessThan(greenCandidates(image(), DEFAULT_GREEN, toSource, 3006).hectares.gron_lattlopt!);
    expect(less.hectares.gron_mycket_svarlopt).toBe(0);
    expect(less.data.features.some(feature => feature.layer.startsWith("undervegetation"))).toBe(false);
  });
});
