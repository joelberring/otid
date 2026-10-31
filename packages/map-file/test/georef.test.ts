import { describe, expect, it } from "vitest";
import {
  geodeticToGrid, gridToGeodetic, mapPointToProjected, mapPointToWgs84, projectedToMapPoint, projectedToWgs84,
  transverseMercatorFor, wgs84ToMapPoint, wgs84ToProjected, type TransverseMercator
} from "../src/georef";
import type { MapGeoreference } from "../src";

const dms = (d: number, m: number, s = 0) => d + m / 60 + s / 3600;

describe("Gauss–Krüger enligt Lantmäteriet", () => {
  it("räknar Lantmäteriets exempel i 'Gauss konforma projektion' (66° N 24° E) på mikrometern", () => {
    // Källa: Lantmäteriet, "Gauss conformal projection (Transverse Mercator)", räkneexempel med GRS 80.
    const projection: TransverseMercator = {
      centralMeridian: dms(13, 35, 7.692), scaleFactor: 1.00000254, falseNorthing: -6226307.864, falseEasting: 84182.879
    };
    const grid = geodeticToGrid(projection, 66, 24);
    expect(grid.northing).toBeCloseTo(1135809.413803, 4);
    expect(grid.easting).toBeCloseTo(555304.016555, 4);
    const back = gridToGeodetic(projection, 555304.016555, 1135809.413803);
    expect(back.latitude).toBeCloseTo(66, 9);
    expect(back.longitude).toBeCloseTo(24, 9);
  });

  it("ger SWEREF 99 TM för Djurgårdskartans referenspunkt", () => {
    const crs = { kind: "EPSG", code: 3006 } as const;
    const grid = wgs84ToProjected(crs, 59.23278649, 18.06742805);
    expect(Math.abs(grid.easting - 675000)).toBeLessThan(0.1);
    expect(Math.abs(grid.northing - 6570000)).toBeLessThan(0.1);
    const back = projectedToWgs84(crs, 675000, 6570000);
    expect(back.latitude).toBeCloseTo(59.23278649, 7);
    expect(back.longitude).toBeCloseTo(18.06742805, 7);
  });

  // Källa: Lantmäteriet, "Kontrollpunkter för SWEREF 99 lokala projektioner" (kontrollpunkter_sweref99proj.pdf).
  const localPoints: readonly (readonly [epsg: number, lat: number, lon: number, n: number, e: number])[] = [
    [3007, 57, dms(11, 15), 6320164.077, 104421.390],
    [3007, 59, dms(12, 45), 6542910.921, 193105.897],
    [3008, 63, dms(12, 45), 6988606.198, 111996.020],
    [3009, 61, dms(15, 45), 6765725.847, 190579.995],
    [3010, 57, dms(17, 15), 6320164.077, 195578.610],
    [3011, 59, dms(17, 15), 6542910.921, 106894.103],
    [3011, 61, dms(18, 45), 6765725.847, 190579.995],
    [3012, 63, 12, 6990379.288, 36003.367],
    [3013, 67, dms(16, 30), 7434550.943, 182714.261],
    [3014, 65, dms(16, 30), 7211548.993, 114619.001],
    [3015, 57, 18, 6320164.077, 104421.390],
    [3016, 69, 21, 7657608.465, 180007.036],
    [3017, 67, 21, 7434550.943, 117285.739],
    [3018, 65, 24, 7211548.993, 185380.999]
  ];

  it.each(localPoints)("SWEREF 99 lokal zon EPSG:%i (%f, %f)", (epsg, lat, lon, n, e) => {
    const crs = { kind: "EPSG", code: epsg } as const;
    const grid = wgs84ToProjected(crs, lat, lon);
    expect(Math.abs(grid.northing - n)).toBeLessThan(0.001);
    expect(Math.abs(grid.easting - e)).toBeLessThan(0.001);
    // Kontrollpunkterna är avrundade till mm; 1 mm ≈ 9e-9° latitud och 2,6e-8° longitud vid 69° N.
    const back = projectedToWgs84(crs, e, n);
    expect(Math.abs(back.latitude - lat) * 111_000).toBeLessThan(0.001);
    expect(Math.abs(back.longitude - lon) * 111_000 * Math.cos(lat * Math.PI / 180)).toBeLessThan(0.001);
  });

  it("RT 90 2,5 gon V med direkta parametrar: rundresa och mittmeridian", () => {
    const crs = { kind: "EPSG", code: 3021 } as const;
    const projection = transverseMercatorFor(3021)!;
    const onMeridian = wgs84ToProjected(crs, 59.3, projection.centralMeridian);
    expect(onMeridian.easting).toBeCloseTo(1500064.274, 6);
    for (const [lat, lon] of [[55.4, 13.1], [59.33, 18.07], [63.8, 20.3], [67.85, 20.22]] as const) {
      const grid = wgs84ToProjected(crs, lat, lon);
      const back = projectedToWgs84(crs, grid.easting, grid.northing);
      expect(Math.abs(back.latitude - lat)).toBeLessThan(1e-9);
      expect(Math.abs(back.longitude - lon)).toBeLessThan(1e-9);
    }
  });

  it("kastar ett tydligt fel för okänt koordinatsystem", () => {
    expect(() => projectedToWgs84({ kind: "UNKNOWN", description: "UTM 33N" }, 0, 0)).toThrow(/UTM 33N/);
    expect(() => wgs84ToProjected({ kind: "EPSG", code: 32633 }, 59, 18)).toThrow(/EPSG:32633/);
  });
});

describe("kartans mm ↔ projicerat", () => {
  const georef: MapGeoreference = {
    scale: 15000,
    crs: { kind: "EPSG", code: 3006 },
    refPoint: { easting: 675000, northing: 6570000 },
    mapRefPoint: { x: 12.5, y: -40 },
    grivationDegrees: 4.9,
    combinedScaleFactor: 1.000025
  };

  it("vrider medurs: kartans uppåt pekar öster om norr vid positiv grivation", () => {
    const up = mapPointToProjected(georef, { x: 12.5, y: -39 });
    expect(up.easting - 675000).toBeGreaterThan(0);
    expect(up.northing - 6570000).toBeCloseTo(15 * 1.000025 * Math.cos(4.9 * Math.PI / 180), 9);
    const origin = mapPointToProjected(georef, georef.mapRefPoint);
    expect(origin).toEqual({ easting: 675000, northing: 6570000 });
  });

  it("går fram och tillbaka på under en mikrometer på kartan", () => {
    for (const point of [{ x: 0, y: 0 }, { x: 250.3, y: 812.7 }, { x: -1000, y: 1500 }]) {
      const back = projectedToMapPoint(georef, mapPointToProjected(georef, point));
      expect(Math.hypot(back.x - point.x, back.y - point.y)).toBeLessThan(1e-6);
      const viaWgs = wgs84ToMapPoint(georef, mapPointToWgs84(georef, point));
      expect(Math.hypot(viaWgs.x - point.x, viaWgs.y - point.y)).toBeLessThan(0.001);
    }
  });
});
