import { describe, expect, it } from "vitest";
import { classifyPhoto, OPEN, ROCK } from "../src/base-map/photo-interpret";

/** Ägaren 2026-11-17: falskfärgsbilden (IR, rött, grönt) ur Lantmäteriets rgbi-ortofoton. */
describe("flygbildstolkning med nära infrarött", () => {
  /** 3 × 1 celler om 4 × 4 bildpunkter: häll (lite IR, ljust), gräs (mycket IR, jämnt) och ett mellanting. */
  const image = (pixel: (cell: number, dx: number, dy: number) => [number, number, number]) => {
    const width = 12, height = 4, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(Math.floor(x / 4), x % 4, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
    return { width, height, data };
  };
  it("häll har lågt NDVI och blir berg i dagen, jämnt gräs med mycket IR blir öppen mark, ett mellanting lämnas", () => {
    // Falskfärg: R = IR, G = rött, B = grönt.
    const cir = image(cell => cell === 0 ? [120, 115, 110] : cell === 1 ? [210, 70, 80] : [180, 110, 105]);
    const { classes } = classifyPhoto(cir, { cellPixels: 4, minCells: 1, infrared: true });
    expect([...classes]).toEqual([ROCK, OPEN, 0]);
  });
  it("fläckig skog (skuggor) blir inte öppen mark trots mycket IR", () => {
    const forest = image((cell, dx, dy) => (dx + dy) % 2 ? [230, 60, 70] : [70, 20, 25]);
    expect([...classifyPhoto(forest, { cellPixels: 4, minCells: 1, infrared: true }).classes]).toEqual([0, 0, 0]);
  });
});
