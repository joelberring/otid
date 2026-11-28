import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { marshOnFloor } from "../src/base-map/marsh-floor";

/** 200 × 120 m i celler om 1 m: en plan dalbotten på 50 m (x < 120) och en sluttning österut, 5 % uppåt; en större kulle (r=12 m, >250 m² hål) och en liten bula (r=6 m, <250 m²). */
function valley(): { columns: number; rows: number; meters: Float32Array } {
  const columns = 200, rows = 120, meters = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const big = Math.hypot(column - 50, row - 60);
    const small = Math.hypot(column - 95, row - 60);
    meters[row * columns + column] = 50 + Math.max(0, column - 120) * 0.05
      + (big < 12 ? 1.5 * (1 - (big / 12) ** 2) : 0)
      + (small < 6 ? 1.5 * (1 - (small / 6) ** 2) : 0);
  }
  return { columns, rows, meters };
}
const affine = [1, 0, 0.5, 0, -1, 119.5] as const;
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (rings: readonly (readonly (readonly [number, number])[])[]) => rings.reduce((sum, ring, i) =>
  sum + (i === 0 ? 1 : -1) * Math.abs(ring.reduce((s, [x, y], j) => { const [nx, ny] = ring[(j + 1) % ring.length]!; return s + x * ny - nx * y; }, 0) / 2), 0);

describe("kärren följer kurvbilden (ägaren 2026-11-15)", () => {
  it("klipper laserns kärr där det går upp i sluttningen och över en stor kulle (>= 250 m²); små hål (< 250 m² skog / < 100 m² sprint) fylls", () => {
    const marsh: SourceFeature = { layer: "blott", geometry: { kind: "area", rings: [rect(10, 20, 190, 100)] } };
    const out = marshOnFloor([marsh, { layer: "vatten", geometry: { kind: "point", at: [1, 1] } }], [{ grid: valley(), affine }], { scale: 15_000 });
    expect(out.changed).toBe(1);
    const pieces = out.features.filter(feature => feature.layer === "blott");
    expect(pieces).toHaveLength(1);
    const geometry = pieces[0]!.geometry as { readonly rings: readonly (readonly (readonly [number, number])[])[] };
    // Sluttningen stiger 0,6 m på 12 m: kärret slutar runt x = 132; stora kullen (~270 m²) blir ett hål, lilla bulan (~68 m²) fylls igen.
    const xs = geometry.rings[0]!.map(([x]) => x);
    expect(Math.max(...xs)).toBeGreaterThan(128); expect(Math.max(...xs)).toBeLessThan(136);
    expect(geometry.rings).toHaveLength(2);
    const remaining = area(geometry.rings);
    expect(remaining).toBeGreaterThan(80 * 116); expect(remaining).toBeLessThan(80 * 124);
    expect(out.removedM2).toBeGreaterThan(4500); expect(out.removedM2).toBeLessThan(5300);
    expect(out.features.find(feature => feature.layer === "vatten")).toBeDefined();

    // Med sprintskala (minHoleM2 = 100 m²) blir en 140 m²-kulle ett hål i sprint men fylls igen i skog (250 m²).
    const sprintValley = (): { columns: number; rows: number; meters: Float32Array } => {
      const columns = 200, rows = 120, meters = new Float32Array(columns * rows);
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const med = Math.hypot(column - 60, row - 60);
        meters[row * columns + column] = 50 + Math.max(0, column - 140) * 0.05 + (med < 9 ? 1.5 * (1 - (med / 9) ** 2) : 0);
      }
      return { columns, rows, meters };
    };
    const forestHole = marshOnFloor([marsh], [{ grid: sprintValley(), affine }], { scale: 15_000 });
    const sprintHole = marshOnFloor([marsh], [{ grid: sprintValley(), affine }], { scale: 4_000 });
    const forestGeom = forestHole.features[0]!.geometry as { readonly rings: readonly (readonly (readonly [number, number])[])[] };
    const sprintGeom = sprintHole.features[0]!.geometry as { readonly rings: readonly (readonly (readonly [number, number])[])[] };
    expect(forestGeom.rings).toHaveLength(1);
    expect(sprintGeom.rings).toHaveLength(2);
  });
  it("rör inte Lantmäteriets sankmark eller kärr utan höjd, men rundar plana laserkärr med Chaikin (2 pass) även utan höjdklipp", () => {
    const lm: SourceFeature = { layer: "sankmark_vat", geometry: { kind: "area", rings: [rect(130, 20, 190, 100)] } };
    // Plant laserkärr med 2 m pixeltrappsteg (inga celler klipps, after === before).
    const flat: SourceFeature = { layer: "fuktigt", geometry: { kind: "area", rings: [rect(20, 20, 100, 40)] } };
    const outside: SourceFeature = { layer: "blott", geometry: { kind: "area", rings: [rect(500, 500, 600, 600)] } };
    const out = marshOnFloor([lm, flat, outside], [{ grid: valley(), affine }], { scale: 15_000 });
    expect(out.changed).toBe(0);
    expect(out.removedM2).toBe(0);
    expect(out.features[0]).toBe(lm);
    expect(out.features[2]).toBe(outside);
    // Det plana kärret har rundats med Chaikin (fler än 4 skarpa 90°-hörn, inget 90°-hörn kvar vid (20, 20)).
    const smoothed = out.features[1]!;
    expect(smoothed.geometry.kind).toBe("area");
    const ring = smoothed.geometry.kind === "area" ? smoothed.geometry.rings[0]! : [];
    expect(ring.length).toBeGreaterThan(4);
    expect(ring.some(([x, y]) => x === 20 && y === 20)).toBe(false);
  });
});
