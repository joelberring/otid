import { describe, expect, it } from "vitest";
import { projectedToWgs84, wgs84ToProjected } from "@o-tid/map-file";
import { flatSlopeFrom } from "@o-tid/map-revision/base-map";
import { layerAffine } from "./map-project-flat-contours";

describe("lugna kurvor på flack mark: underlagets läge", () => {
  // Bildpunkternas hörn i kartans koordinatsystem: 2 m celler, övre vänstra hörnet i (674 000, 6 580 000).
  const toSource = (column: number, row: number): [number, number] => [674000 + column * 2, 6580000 - row * 2];

  it("ger bildpunkternas mitt när kandidaterna har kartans koordinatsystem", () => {
    expect(layerAffine(toSource, 500, 400, 3006, 3006)).toEqual([2, 0, 674001, 0, -2, 6579999]);
  });
  it("hittar rätt cell: lutningen frågas i terrängens koordinater", () => {
    // Kolumn 0–249 brant (6°), resten flack (0,3°).
    const columns = 500, rows = 400, steps = Uint8Array.from({ length: columns * rows }, (_, p) => p % columns < 250 ? 60 : 3);
    const slopeAt = flatSlopeFrom({ columns, rows, steps }, layerAffine(toSource, columns, rows, 3006, 3006));
    expect(slopeAt(674000 + 100, 6580000 - 400)).toBeCloseTo(6, 6);
    expect(slopeAt(674000 + 900, 6580000 - 400)).toBeCloseTo(0.3, 6);
    expect(slopeAt(674000 - 10, 6580000 - 400)).toBeUndefined();
  });
  it("räknar om läget när kandidaterna har ett annat koordinatsystem än kartan (SWEREF 99 18 00 mot SWEREF 99 TM)", () => {
    const local = (column: number, row: number): [number, number] => [150000 + column * 2, 6580000 - row * 2];
    const affine = layerAffine(local, 2500, 2500, 3011, 3006);
    const expected = (column: number, row: number) => {
      const [x, y] = local(column + 0.5, row + 0.5), position = projectedToWgs84({ kind: "EPSG", code: 3011 }, x, y);
      return wgs84ToProjected({ kind: "EPSG", code: 3006 }, position.latitude, position.longitude);
    };
    // Mitt i bilden (5 × 5 km) är felet av det rätlinjiga sambandet långt under en cell.
    for (const [column, row] of [[0, 0], [1250, 1250], [2499, 0], [600, 2100]] as const) {
      const at = expected(column, row);
      expect(Math.hypot(affine[0] * column + affine[1] * row + affine[2] - at.easting, affine[3] * column + affine[4] * row + affine[5] - at.northing)).toBeLessThan(0.5);
    }
  });
});
