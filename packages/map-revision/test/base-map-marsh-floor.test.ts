import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { marshOnFloor } from "../src/base-map/marsh-floor";

/** 200 × 120 m i celler om 1 m: en plan dalbotten på 50 m (x < 120) och en sluttning österut, 5 % uppåt; en kulle på 1,5 m i dalen. */
function valley(): { columns: number; rows: number; meters: Float32Array } {
  const columns = 200, rows = 120, meters = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const d = Math.hypot(column - 50, row - 60);
    meters[row * columns + column] = 50 + Math.max(0, column - 120) * 0.05 + (d < 8 ? 1.5 * (1 - (d / 8) ** 2) : 0);
  }
  return { columns, rows, meters };
}
const affine = [1, 0, 0.5, 0, -1, 119.5] as const;
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (rings: readonly (readonly (readonly [number, number])[])[]) => rings.reduce((sum, ring, i) =>
  sum + (i === 0 ? 1 : -1) * Math.abs(ring.reduce((s, [x, y], j) => { const [nx, ny] = ring[(j + 1) % ring.length]!; return s + x * ny - nx * y; }, 0) / 2), 0);

describe("kärren följer kurvbilden (ägaren 2026-11-15)", () => {
  it("klipper laserns kärr där det går upp i sluttningen och över en kulle; dalbotten står kvar", () => {
    const marsh: SourceFeature = { layer: "blott", geometry: { kind: "area", rings: [rect(10, 20, 190, 100)] } };
    const out = marshOnFloor([marsh, { layer: "vatten", geometry: { kind: "point", at: [1, 1] } }], [{ grid: valley(), affine }]);
    expect(out.changed).toBe(1);
    const pieces = out.features.filter(feature => feature.layer === "blott");
    expect(pieces).toHaveLength(1);
    const geometry = pieces[0]!.geometry as { readonly rings: readonly (readonly (readonly [number, number])[])[] };
    // Sluttningen stiger 0,6 m på 12 m: kärret slutar runt x = 132; kullen (över 0,6 m inom radien ~6,3 m) blir ett hål.
    const xs = geometry.rings[0]!.map(([x]) => x);
    expect(Math.max(...xs)).toBeGreaterThan(128); expect(Math.max(...xs)).toBeLessThan(136);
    expect(geometry.rings).toHaveLength(2);
    const remaining = area(geometry.rings);
    expect(remaining).toBeGreaterThan(80 * 120 - 300); expect(remaining).toBeLessThan(80 * 124);
    expect(out.removedM2).toBeGreaterThan(4500); expect(out.removedM2).toBeLessThan(5000);
    expect(out.features.find(feature => feature.layer === "vatten")).toBeDefined();
  });
  it("rör inte Lantmäteriets sankmark eller kärr utan höjd, och ett plant kärr står kvar som samma objekt", () => {
    const lm: SourceFeature = { layer: "sankmark_vat", geometry: { kind: "area", rings: [rect(130, 20, 190, 100)] } };
    const flat: SourceFeature = { layer: "fuktigt", geometry: { kind: "area", rings: [rect(20, 20, 100, 40)] } };
    const outside: SourceFeature = { layer: "blott", geometry: { kind: "area", rings: [rect(500, 500, 600, 600)] } };
    const out = marshOnFloor([lm, flat, outside], [{ grid: valley(), affine }]);
    expect(out.changed).toBe(0);
    expect(out.features[0]).toBe(lm); expect(out.features[1]).toBe(flat); expect(out.features[2]).toBe(outside);
  });
});
