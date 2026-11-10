import type { MapGeoreference } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { laserClip } from "./map-project-clip";

// En karta 1:10 000 med referenspunkten i (0, 0) mm = (675 000; 6 580 000) i SWEREF 99 TM.
const georeference = (grivationDegrees: number): MapGeoreference => ({ scale: 10000, crs: { kind: "EPSG", code: 3006 },
  refPoint: { easting: 675000, northing: 6580000 }, mapRefPoint: { x: 0, y: 0 }, grivationDegrees, combinedScaleFactor: 1 });
// 100 × 50 mm på kartan = 1 000 × 500 m i terrängen.
const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe("rutan som laserdatan klipps till", () => {
  it("är kartans område i SWEREF 99 TM plus marginalen", () => {
    const clip = laserClip(bounds, georeference(0), 50)!;
    expect(clip.minX).toBeCloseTo(675000 - 50, -1);
    expect(clip.maxX).toBeCloseTo(676000 + 50, -1);
    expect(clip.maxY - clip.minY).toBeGreaterThanOrEqual(600);
    expect(clip.maxY - clip.minY).toBeLessThan(620);
    expect(clip.maxX - clip.minX).toBeGreaterThanOrEqual(1100);
    expect(clip.maxX - clip.minX).toBeLessThan(1120);
    expect(Number.isInteger(clip.minX) && Number.isInteger(clip.maxY)).toBe(true);
  });

  it("en vriden karta ger en större ruta som rymmer alla fyra hörnen", () => {
    const straight = laserClip(bounds, georeference(0), 0)!, turned = laserClip(bounds, georeference(10), 0)!;
    expect(turned.maxY - turned.minY).toBeGreaterThan(straight.maxY - straight.minY + 100);
  });

  it("en etapp ger etappens ruta, inte hela kartans", () => {
    const area = { name: "Norr", polygon: [[{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }]] };
    const clip = laserClip(bounds, georeference(0), 50, area)!;
    expect(clip.maxX - clip.minX).toBeGreaterThanOrEqual(300);
    expect(clip.maxX - clip.minX).toBeLessThan(320);
  });
});
