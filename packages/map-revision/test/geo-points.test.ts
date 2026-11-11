import { describe, expect, it } from "vitest";
import { groundShareAt, mergePointStats, pointImages, POINT_BANDS, readPointStats } from "../../../scripts/geo-points";

/** 2 × 2 celler à 2 m med åtta värden per cell, som lasclip skriver. */
function file(cells: number[][]): Uint8Array {
  const bytes = new Uint8Array(40 + 4 * POINT_BANDS * 4), view = new DataView(bytes.buffer);
  view.setFloat64(0, 1000, true); view.setFloat64(8, 2000, true); view.setFloat64(16, 2, true);
  view.setBigUint64(24, 2n, true); view.setBigUint64(32, 2n, true);
  cells.forEach((cell, i) => cell.forEach((value, band) => view.setFloat32(40 + (i * POINT_BANDS + band) * 4, value, true)));
  return bytes;
}
const empty = [Number.NaN, 0, 0, 0, 0, 0, Number.NaN, Number.NaN];

describe("punktmolnets statistik (ägaren 2026-11-11)", () => {
  it("läser filen, slår ihop rutor och väger medelvärdena", () => {
    const a = readPointStats(file([[12, 10, 4, 1, 2, 3, 3200, 0.05], empty, empty, empty]));
    const b = readPointStats(file([[15, 10, 6, 0, 0, 4, 6400, 0.05], [0, 4, 4, 0, 0, 0, 640, 0.02], empty, empty]));
    expect(a).toMatchObject({ minX: 1000, minY: 2000, cell: 2, width: 2, height: 2 });
    const merged = mergePointStats([a, b]);
    expect([...merged.values.subarray(0, 6)]).toEqual([15, 20, 10, 1, 2, 7]);
    expect(merged.values[6]).toBeCloseTo(5120, 0);
    expect(merged.values[POINT_BANDS]).toBe(0);
    expect(() => readPointStats(new Uint8Array(50))).toThrow();
  });
  it("skriver tre bilder med världsfil; celler utan punkter är genomskinliga", () => {
    const images = pointImages(readPointStats(file([[12, 10, 4, 1, 2, 3, 3200, 0.05], empty, empty, empty])));
    expect(images.world).toBe("2\n0\n0\n-2\n1001\n2003\n");
    for (const png of [images.veg, images.ground, images.canopy]) expect([...png.subarray(1, 4)].map(code => String.fromCharCode(code)).join("")).toBe("PNG");
  });
  it("markträffarnas andel kring en punkt (öppen mark har hög andel)", () => {
    const share = groundShareAt(readPointStats(file([[0, 10, 9, 0, 0, 0, 3000, 0.02], [20, 10, 1, 0, 0, 8, 3000, 0.02], empty, empty])), 0);
    expect(share(1001, 2001)).toBeCloseTo(0.9, 5);
    expect(share(1001, 2003)).toBeCloseTo(0.1, 5);
    expect(share(1003, 2001)).toBeUndefined();
    expect(share(900, 2001)).toBeUndefined();
    expect(groundShareAt(readPointStats(file([[0, 10, 9, 0, 0, 0, 3000, 0.02], [20, 10, 1, 0, 0, 8, 3000, 0.02], empty, empty])), 1)(1001, 2001)).toBeCloseTo(0.5, 5);
  });
});
