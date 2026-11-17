import { describe, expect, it } from "vitest";
import { smoothMask } from "./map-project-mask-smooth";

describe("utjämning av masker", () => {
  const columns = 60, rows = 60;
  const mask = (test: (x: number, y: number) => boolean) => Uint8Array.from({ length: columns * rows }, (_, i) => test(Math.floor(i / rows), i % rows) ? 1 : 0);
  it("sluter en smal vik och tar bort en smal arm", () => {
    const shape = mask((x, y) => (x >= 15 && x < 45 && y >= 15 && y < 45 && !(x >= 28 && x < 32 && y >= 15 && y < 35)) || (x >= 45 && x < 58 && y >= 29 && y < 31));
    const out = smoothMask(shape, columns, rows, 3, 3);
    expect([out[30 * rows + 25], out[52 * rows + 30], out[20 * rows + 20]]).toEqual([1, 0, 1]);
  });
});
