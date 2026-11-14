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
  it("klassbilder från geo-arbetaren 28: buskskiktets gräns dras i webbläsaren", () => {
    // Skog överallt (klass 2 i blå kanal); buskskiktets andel 5 % i väster och 15 % i öster. Röd kanal har arbetarens tillägg.
    const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p += 1) { const east = p % width >= 15; data[p * 4] = east ? 4 : 2; data[p * 4 + 1] = east ? 150 : 50; data[p * 4 + 2] = 2; data[p * 4 + 3] = 255; }
    const green = (denseShare: number) => greenCandidates({ width, height, data }, { ...DEFAULT_GREEN, minAreaM2: 100, denseShare }, toSource, 3006).hectares.gron_lattlopt!;
    expect(green(0.2)).toBe(0);
    expect(green(0.08)).toBeGreaterThan(0.1);
    expect(green(0.04)).toBeGreaterThan(green(0.08));
  });
});

/** Ägaren 2026-11-14: «ett reglage som generaliserar gröna ytor mer, så att en sån här form blir enklare redovisad». */
describe("förenkla de gröna ytorna", () => {
  /** 120 × 120 celler om 2 m: en grön klump med en smal vik, en tunn arm, ett litet hål och en liten fläck bredvid; tätare kärna. */
  function ragged() {
    const width = 120, height = 120, data = new Uint8ClampedArray(width * height * 4);
    const green = (column: number, row: number) => {
      const body = column >= 30 && column < 80 && row >= 30 && row < 80;
      const bay = column >= 48 && column < 62 && row >= 30 && row < 56, hole = column >= 62 && column < 74 && row >= 62 && row < 74;
      const arm = column >= 80 && column < 112 && row >= 40 && row < 50, speck = column >= 2 && column < 16 && row >= 104 && row < 118;
      return (body && !bay && !hole) || arm || speck;
    };
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
      const i = (row * width + column) * 4, core = column >= 34 && column < 46 && row >= 64 && row < 76;
      data[i] = green(column, row) ? (core ? 7 : 5) : 2; data[i + 1] = 160; data[i + 3] = 255;
    }
    return { width, height, data };
  }
  const at = (simplify: number) => {
    const result = greenCandidates(ragged(), { ...DEFAULT_GREEN, undergrowth: false, simplify }, toSource, 3006);
    const rings = (layer: string) => result.data.features.filter(feature => feature.layer === layer).map(feature => feature.geometry.kind === "line" ? feature.geometry.points : []);
    return { rings, hectares: result.hectares, points: (layer: string) => rings(layer).reduce((sum, ring) => sum + ring.length, 0) };
  };
  const inside = (ring: readonly (readonly [number, number])[], [x, y]: readonly [number, number]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  it("0 ändrar inget", () => {
    const plain = greenCandidates(ragged(), { ...DEFAULT_GREEN, undergrowth: false }, toSource, 3006);
    expect(greenCandidates(ragged(), { ...DEFAULT_GREEN, undergrowth: false, simplify: 0 }, toSource, 3006)).toEqual(plain);
  });
  it("sluter viken, tar bort armen, fläcken och hålet, och ger färre brytpunkter", () => {
    const before = at(0), after = at(6);
    // Viken (kolumn 55, rad 40), hålet (68, 68), armen (100, 45) och fläcken (9, 111); en punkt är grön om den ligger i ett udda antal ringar.
    const green = (rings: readonly (readonly (readonly [number, number])[])[]) => [[55, 40], [68, 68], [100, 45], [9, 111]]
      .map(([column, row]) => rings.filter(ring => inside(ring, toSource(column!, row!))).length % 2 === 1);
    expect(green(before.rings("gron_lattlopt"))).toEqual([false, false, true, true]);
    expect(after.rings("gron_lattlopt")).toHaveLength(1);
    expect(green(after.rings("gron_lattlopt"))).toEqual([true, true, false, false]);
    expect(after.points("gron_lattlopt")).toBeLessThan(before.points("gron_lattlopt"));
  });
  it("behåller de tätare stegen inuti de glesare, och öppen mark rörs inte", () => {
    const after = at(4), outer = after.rings("gron_lattlopt");
    expect(after.rings("gron_svarlopt").length).toBeGreaterThan(0);
    // Varje punkt på den tätare ytans kant ligger i den glesare ytan, eller på dess kant (inom förenklingens tolerans).
    const within = (point: readonly [number, number]) => outer.some(ring => inside(ring, point) || ring.some(([x, y]) => Math.hypot(x - point[0], y - point[1]) < 6));
    for (const ring of after.rings("gron_svarlopt")) expect(ring.every(within)).toBe(true);
    expect(after.hectares.gron_mycket_svarlopt!).toBeLessThanOrEqual(after.hectares.gron_lattlopt!);
    expect(at(8).hectares.oppen_mark).toBe(at(0).hectares.oppen_mark);
  });
});
