import { describe, expect, it } from "vitest";
import {
  cleanMask, fillDepressions, flowAccumulation, flowDirections, heightAboveDrainage, maskRings, moistureFromHeightMaps, mosaic, readHeightMap,
  worldFile, type Grid
} from "../../../scripts/geo-moisture";

/** ADR-0219 K5c del 2: fuktigheten ur Karttapullautins höjdraster i geo-arbetaren (scripts/geo-moisture.ts). */
function grid(width: number, height: number, f: (x: number, y: number) => number, minX = 675_000, minY = 6_580_000): Grid {
  const z = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) z[x * height + y] = f(x, y);
  return { minX, minY, cell: 2, width, height, z };
}
function hmap(g: Grid): Uint8Array {
  const bytes = new Uint8Array(40 + g.z.length * 8), view = new DataView(bytes.buffer);
  view.setFloat64(0, g.minX, true); view.setFloat64(8, g.minY, true); view.setFloat64(16, g.cell, true);
  view.setBigUint64(24, BigInt(g.width), true); view.setBigUint64(32, BigInt(g.height), true);
  g.z.forEach((value, i) => view.setFloat64(40 + i * 8, value, true));
  return bytes;
}
/** En dal som lutar söderut med en bäck i mitten och en sänka (blöt) i nordväst. */
const valley = (x: number, y: number) => 20 + Math.abs(x - 50) * 0.3 + y * 0.05 - (Math.hypot(x - 20, y - 80) < 6 ? 5 : 0);
/** En flack dal (under 3°): bara där blir det blött (ägaren 2026-11-11). */
const gentle = (x: number, y: number) => 20 + Math.abs(x - 50) * 0.05 + y * 0.02;

describe("fuktigheten ur höjdrastret", () => {
  it("läser Karttapullautins höjdraster och slår ihop rutor", () => {
    const a = grid(10, 10, (x, y) => x + y), b = grid(10, 10, (x, y) => 100 + x + y, 675_018, 6_580_000);
    const read = readHeightMap(hmap(a));
    expect(read).toMatchObject({ minX: 675_000, cell: 2, width: 10, height: 10 });
    expect(read.z[3 * 10 + 4]).toBe(7);
    const both = mosaic([read, readHeightMap(hmap(b))]);
    expect(both).toMatchObject({ width: 19, height: 10 });
    expect(both.z[9 * 10 + 0]).toBe(9);
    expect(both.z[18 * 10 + 0]).toBe(109);
    expect(worldFile(both)).toBe("2\n0\n0\n-2\n675000\n6580018\n");
    expect(() => readHeightMap(new Uint8Array(10))).toThrow();
  });

  it("fyller sänkor, flödet når kanten och stråket, och höjden över stråket", () => {
    const g = grid(101, 101, valley);
    const filled = fillDepressions(g);
    // Sänkan fylls till sin kant (och lite till för lutningen).
    expect(filled[20 * 101 + 80]! - g.z[20 * 101 + 80]!).toBeGreaterThan(1);
    const down = flowDirections(g, filled);
    const { accumulation, order } = flowAccumulation(down, filled);
    expect(order.length).toBe(101 * 101);
    // Allt rinner ut: dalens botten nere i söder har nästan hela ytan uppströms.
    expect(Math.max(...accumulation)).toBeGreaterThan(101 * 101 * 0.5);
    const hand = heightAboveDrainage(g, down, accumulation, order, 2500);
    expect(hand[50 * 101 + 10]).toBeCloseTo(0, 5);
    expect(hand[90 * 101 + 50]!).toBeGreaterThan(8);
  });

  it("masken utan små öar och med hålen fyllda blir enkla ringar", () => {
    const width = 12, height = 12, mask = new Uint8Array(width * height);
    for (let x = 2; x < 9; x += 1) for (let y = 2; y < 9; y += 1) mask[x * height + y] = 1;
    mask[5 * height + 5] = 0; // ett hål
    mask[11 * height + 11] = 1; // en ö på en cell
    // Två ytor som bara möts i ett hörn.
    const clean = cleanMask(mask, width, height, 4);
    expect(clean[5 * height + 5]).toBe(1);
    expect(clean[11 * height + 11]).toBe(0);
    const rings = maskRings(clean, { minX: 0, minY: 0, cell: 2, width, height, z: new Float64Array(0) });
    expect(rings).toHaveLength(1);
    const xs = rings[0]!.map(p => p[0]), ys = rings[0]!.map(p => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([3, 17, 3, 17]);
    const diagonal = new Uint8Array(16);
    diagonal[0 * 4 + 0] = 1; diagonal[1 * 4 + 1] = 1;
    expect(maskRings(diagonal, { minX: 0, minY: 0, cell: 1, width: 4, height: 4, z: new Float64Array(0) })).toHaveLength(2);
  });

  it("hela kedjan ger bild, världsfil och DXF med blöta ytor och fuktstråk", () => {
    const result = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1, channelLineHa: 1 });
    // Den branta dalen har stråket men ingen blöt mark.
    expect(moistureFromHeightMaps([grid(101, 101, valley)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1 }).summary.wetAreas).toBe(0);
    expect([...result.png.subarray(1, 4)].map(code => String.fromCharCode(code)).join("")).toBe("PNG");
    expect(result.dxf).toContain("\nblott\n");
    expect(result.dxf).toContain("\nfuktstrak\n");
    expect(result.summary.channels).toBeGreaterThan(0);
    expect(result.summary.wetAreas).toBeGreaterThan(0);
    expect(result.summary.moistHa).toBeGreaterThanOrEqual(result.summary.wetHa);
  });
});
