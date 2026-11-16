import { describe, expect, it } from "vitest";
import { contourLayer, contourStyle, geoTiff } from "./map-project-drawing-basis";

describe("underlag för frihandsritning", () => {
  it("GeoTIFF:en har rätt läge i SWEREF 99 TM", async () => {
    const rgb = new Uint8Array(4 * 3 * 3).fill(200);
    const buffer = await geoTiff(rgb, { grid: { columns: 4, rows: 3, meters: new Float32Array(12) }, affine: [1, 0, 674371.5, 0, -1, 6572339.5] });
    const { fromArrayBuffer } = await import("geotiff");
    const image = await (await fromArrayBuffer(buffer)).getImage();
    expect(image.getWidth()).toBe(4);
    expect(image.getOrigin()).toEqual([674371, 6572340, 0]);
    expect(image.getResolution()).toEqual([1, -1, 0]);
    expect((image.getGeoKeys() as { ProjectedCSTypeGeoKey: number }).ProjectedCSTypeGeoKey).toBe(3006);
  });
  it("kurvlagrens namn", () => {
    expect(contourLayer(0.25, 0.25)).toBe("hojdkurva_025");
    expect(contourLayer(1, 0.25)).toBe("hojdkurva_1m");
    expect(contourLayer(5, 0.25)).toBe("hojdkurva_5m");
    // Olika färg per lager: ljust lila, lila, brunt.
    expect(new Set([0.25, 1, 5].map(major => contourStyle(major, 0.25).aci)).size).toBe(3);
  });
});
