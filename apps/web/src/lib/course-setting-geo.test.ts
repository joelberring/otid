import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapPointToWgs84, readMapFile, type MapGeoreference } from "@o-tid/map-file";
import { averagePositions, compassHeading, insideBounds, metersPerMm, stepPoint, toMapPosition, type MapPosition } from "./course-setting-geo";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../fixtures/maps/${name}`, import.meta.url)));

describe("WGS 84 → kartans mm", () => {
  it("kartfilsfixturen (Mapper, SWEREF 99 TM, 1:10 000): en punkt på kartan kommer tillbaka till samma mm", () => {
    const map = readMapFile(fixture("kartfil.omap"), "kartfil.omap");
    expect(map.georeference).not.toBeNull();
    const georeference = map.georeference!;
    const point = { x: 42, y: 61 };
    const wgs = mapPointToWgs84(georeference, point);
    const position = toMapPosition(georeference, { latitude: wgs.latitude, longitude: wgs.longitude, accuracyM: 5 });
    expect(position.at.x).toBeCloseTo(42, 3);
    expect(position.at.y).toBeCloseTo(61, 3);
    // 5 m i 1:10 000 = 0,5 mm.
    expect(position.accuracyMm).toBeCloseTo(0.5, 6);
  });

  it("syntetisk georeferens: 100 m norrut i 1:15 000 är 6,67 mm uppåt, 100 m österut 6,67 mm åt höger", () => {
    const georeference: MapGeoreference = { scale: 15000, crs: { kind: "EPSG", code: 3006 } as MapGeoreference["crs"],
      refPoint: { easting: 674000, northing: 6578000 }, mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
    const origin = mapPointToWgs84(georeference, { x: 0, y: 0 });
    const north = mapPointToWgs84(georeference, { x: 0, y: 100 / 15 });
    const east = mapPointToWgs84(georeference, { x: 100 / 15, y: 0 });
    expect(toMapPosition(georeference, { ...origin, accuracyM: 1 }).at.x).toBeCloseTo(0, 4);
    expect(toMapPosition(georeference, { ...north, accuracyM: 1 }).at.y).toBeCloseTo(6.667, 3);
    expect(toMapPosition(georeference, { ...east, accuracyM: 1 }).at.x).toBeCloseTo(6.667, 3);
    expect(metersPerMm(georeference, 10000)).toBe(15);
  });

  it("utan georeferens används kartans skala", () => {
    expect(metersPerMm(null, 10000)).toBe(10);
  });
});

const sample = (x: number, y: number, accuracyM = 4): MapPosition => ({ at: { x, y }, accuracyM, accuracyMm: accuracyM / 10 });

describe("medelvärdet av positionerna", () => {
  it("tom lista ger inget", () => { expect(averagePositions([])).toBeUndefined(); });

  it("en position är sig själv", () => {
    expect(averagePositions([sample(10, 20)])).toEqual({ at: { x: 10, y: 20 }, accuracyM: 4, used: 1, discarded: 0 });
  });

  it("avvikare längre bort än 2 × medianavståndet kastas", () => {
    const result = averagePositions([sample(10, 10, 3), sample(10.2, 10, 5), sample(9.8, 10, 4), sample(10, 10.2, 4), sample(14, 14, 30)])!;
    expect(result.discarded).toBe(1);
    expect(result.used).toBe(4);
    expect(result.at.x).toBeCloseTo(10, 6);
    expect(result.at.y).toBeCloseTo(10.05, 6);
    expect(result.accuracyM).toBe(4);
  });
});

describe("finjustering i meter", () => {
  it("1 m i 1:10 000 är 0,1 mm; norr är kartans uppåt", () => {
    const at = { x: 50, y: 50 };
    expect(stepPoint(at, "N", 1, 10)).toEqual({ x: 50, y: 50.1 });
    expect(stepPoint(at, "S", 1, 10)).toEqual({ x: 50, y: 49.9 });
    expect(stepPoint(at, "E", 1, 10)).toEqual({ x: 50.1, y: 50 });
    expect(stepPoint(at, "W", 1, 10)).toEqual({ x: 49.9, y: 50 });
  });

  it("en position långt utanför kartan godtas inte", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(insideBounds({ x: 120, y: 50 }, bounds)).toBe(true);
    expect(insideBounds({ x: 5000, y: 50 }, bounds)).toBe(false);
  });
});

describe("steg 67: kompassen", () => {
  it("iOS ger riktningen direkt, Android absolut alpha moturs; skärmens vridning läggs till och avrundas till 5°", () => {
    expect(compassHeading({ webkitCompassHeading: 92 })).toBe(90);
    expect(compassHeading({ absolute: true, alpha: 90 })).toBe(270);
    expect(compassHeading({ absolute: true, alpha: 0 })).toBe(0);
    expect(compassHeading({ absolute: true, alpha: 10 }, 90)).toBe(80);
    expect(compassHeading({ webkitCompassHeading: 350 }, 90)).toBe(80);
    // Relativ riktning (inte mot norr) eller ingen alls: ingen kon.
    expect(compassHeading({ absolute: false, alpha: 30 })).toBeUndefined();
    expect(compassHeading({ webkitCompassHeading: -1 })).toBeUndefined();
    expect(compassHeading({})).toBeUndefined();
  });
});
