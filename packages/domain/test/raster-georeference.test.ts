import { describe, expect, it } from "vitest";
import { deriveRasterGeoreference, invertRasterCoordinate, projectRasterPixel, RasterGeoreferenceError } from "../src";

const points = [
  { pixelX: 0, pixelY: 0, longitude: 18.1000, latitude: 59.2000 },
  { pixelX: 1000, pixelY: 0, longitude: 18.1100, latitude: 59.2000 },
  { pixelX: 0, pixelY: 500, longitude: 18.1000, latitude: 59.1950 }
] as const;

describe("deriveRasterGeoreference", () => {
  it("derives an invertible WGS84 affine transform from exactly three points", () => {
    const reference = deriveRasterGeoreference({ imageWidth: 1001, imageHeight: 501, tiePoints: points });
    expect(reference.maxResidualMeters).toBeLessThan(0.01);
    const projected = projectRasterPixel(reference.transform, 500, 250);
    expect(projected.longitude).toBeCloseTo(18.105, 12);
    expect(projected.latitude).toBeCloseTo(59.1975, 12);
    const inverted = invertRasterCoordinate(reference.transform, 18.105, 59.1975);
    expect(inverted.pixelX).toBeCloseTo(500, 8);
    expect(inverted.pixelY).toBeCloseTo(250, 8);
  });

  it("fails closed for out-of-extent, collinear and non-finite calibration input", () => {
    expect(() => deriveRasterGeoreference({ imageWidth: 1000, imageHeight: 500, tiePoints: points })).toThrow(RasterGeoreferenceError);
    expect(() => deriveRasterGeoreference({ imageWidth: 1001, imageHeight: 501, tiePoints: [points[0], points[1], { pixelX: 500, pixelY: 0, longitude: 18.105, latitude: 59.2 }] })).toThrow("COLLINEAR_POINTS");
    expect(() => deriveRasterGeoreference({ imageWidth: 1001, imageHeight: 501, tiePoints: [{ ...points[0], longitude: Number.NaN }, points[1], points[2]] })).toThrow("INVALID_POINT");
  });
});
