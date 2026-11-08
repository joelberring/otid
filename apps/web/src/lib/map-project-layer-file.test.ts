import { describe, expect, it } from "vitest";
import { fromArrayBuffer, writeArrayBuffer } from "geotiff";
import { tiffGeoreference } from "./map-project-layer-file";

/** ADR-0219 K4a: georeferensen ur en GeoTIFF (ursprunget i hörnet → första pixelns mitt, EPSG ur nycklarna). */
describe("GeoTIFF:s georeferens", () => {
  it("läser ursprung, upplösning och SWEREF 99 TM", async () => {
    const buffer = writeArrayBuffer(new Uint8Array(4 * 3), { width: 4, height: 3, ModelPixelScale: [0.5, 0.5, 0],
      ModelTiepoint: [0, 0, 0, 675000, 6580100, 0], ProjectedCSTypeGeoKey: 3006, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }) as ArrayBuffer;
    const image = await (await fromArrayBuffer(buffer)).getImage();
    expect(tiffGeoreference(image)).toEqual({ crs: 3006, transform: { a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580099.75 } });
  });

  it("utan georeferens: ingen transform", () => {
    expect(tiffGeoreference({ getGeoKeys: () => null, getOrigin: () => { throw new Error("ingen"); }, getResolution: () => [1, 1] }))
      .toEqual({ transform: undefined, crs: undefined });
    expect(tiffGeoreference({ getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 32767, GTRasterTypeGeoKey: 2 }), getOrigin: () => [10, 20], getResolution: () => [1, -1] }))
      .toEqual({ transform: { a: 1, b: 0, c: 10, d: 0, e: -1, f: 20 }, crs: undefined });
  });
});
