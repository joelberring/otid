import { describe, expect, it } from "vitest";
import { decodeRgbaPng, rgbaPng } from "../src/map-project-job-labels";
import { cropRaster } from "../src/mcp";

/** Ägaren 2026-11-17: ett utsnitt ur laserkörningens raster när hela kartans raster är för stort för ett svar. */
describe("utsnitt ur ett raster", () => {
  // 10 × 10 bildpunkter om 2 m, pixelns mitt uppe till vänster i (1001, 1999); värdet = kolumn i R, rad i G.
  const data = new Uint8Array(400);
  for (let row = 0; row < 10; row += 1) for (let column = 0; column < 10; column += 1) data.set([column, row, 0, 255], (row * 10 + column) * 4);
  const raster = { png: rgbaPng(10, 10, data), mediaType: "image/png", world: "2\n0\n0\n-2\n1001\n1999\n" };
  it("ger rätt bildpunkter och en världsfil för utsnittet", () => {
    const cut = cropRaster(raster, [1004, 1990, 1010, 1996]);
    if ("error" in cut) throw new Error(cut.error);
    const image = decodeRgbaPng(cut.png)!;
    expect([image.width, image.height]).toEqual([3, 3]);
    expect([...image.data.subarray(0, 2)]).toEqual([2, 2]);
    expect(cut.world.split("\n").map(Number)).toEqual([2, 0, 0, -2, 1005, 1995]);
  });
  it("vägrar WebP, utanför och för stort", () => {
    expect(cropRaster({ ...raster, mediaType: "image/webp" }, [1000, 1980, 1010, 2000])).toHaveProperty("error");
    expect(cropRaster(raster, [5000, 5000, 5010, 5010])).toHaveProperty("error");
  });
});
