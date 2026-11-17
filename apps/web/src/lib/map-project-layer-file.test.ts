import { describe, expect, it } from "vitest";
import { fromArrayBuffer, writeArrayBuffer } from "geotiff";
import { falseColor, infraredBand, tiffGeoreference } from "./map-project-layer-file";

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

/** Ägaren 2026-11-17: Lantmäteriets rgbi-ortofoton har nära infrarött som fjärde band. */
describe("ortofoton med nära infrarött", () => {
  it("ett fjärde band som inte är alfa är infrarött", () => {
    expect(infraredBand({ getSamplesPerPixel: () => 3 })).toBeUndefined();
    expect(infraredBand({ getSamplesPerPixel: () => 4, fileDirectory: { ExtraSamples: [0] } })).toBe(3);
    expect(infraredBand({ getSamplesPerPixel: () => 4, fileDirectory: {} })).toBe(3);
    expect(infraredBand({ getSamplesPerPixel: () => 4, fileDirectory: { ExtraSamples: [2] } })).toBeUndefined();
    expect(infraredBand({ getSamplesPerPixel: () => 4, fileDirectory: { ExtraSamples: 1 } })).toBeUndefined();
  });
  it("falskfärgen lägger IR i rött, rött i grönt och grönt i blått, och skalar 16 bitar", () => {
    expect([...falseColor([10, 20, 30, 200], 1, 1)]).toEqual([200, 10, 20, 255]);
    expect([...falseColor([256, 512, 768, 1024], 1, 4)]).toEqual([255, 64, 128, 255]);
  });
});
