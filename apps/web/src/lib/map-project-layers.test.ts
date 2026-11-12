import { describe, expect, it } from "vitest";
import { mapPointToProjected, mapPointToWgs84, type MapGeoreference } from "@o-tid/map-file";
import { affineFromOrigin, layerCorners, layerToMap, parseWorldFile, scaledAffine, screenTransform, WGS84 } from "./map-project-layers";

/** ADR-0219 K4a: världsfilen, GeoTIFF:s ursprung, nedskalning och bildens läge på kartan. */
const georef: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };

describe("underlagen (K4a)", () => {
  it("läser världsfilen och GeoTIFF:s ursprung", () => {
    expect(parseWorldFile("0.5\n0\n0\n-0.5\n675000.25\n6580100.25\n")).toEqual({ a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580100.25 });
    expect(parseWorldFile("1\n2\n3")).toBeUndefined();
    expect(parseWorldFile("0\n0\n0\n0\n1\n1")).toBeUndefined();
    expect(affineFromOrigin([675000, 6580100], [0.5, -0.5])).toEqual({ a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580099.75 });
  });

  it("nedskalad bild: samma hörn, dubbelt så stora pixlar", () => {
    const t = { a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580099.75 };
    const half = scaledAffine(t, 0.5);
    expect(half).toEqual({ a: 1, b: 0, c: 675000.5, d: 0, e: -1, f: 6580099.5 });
  });

  it("bildens pixlar på kartan: samma koordinatsystem och via WGS 84", () => {
    // 1 000 × 1 000 px om 0,5 m med hörnet i kartans referenspunkt: 500 m = 50 mm åt höger och nedåt (y uppåt på kartan).
    const layer = { width: 1000, height: 1000, crs: 3006, transform: affineFromOrigin([675000, 6580000], [0.5, -0.5]) };
    const toMap = layerToMap(layer, georef);
    const corners = layerCorners(toMap, 1000, 1000);
    expect(corners[0]!.x).toBeCloseTo(0, 6);
    expect(corners[0]!.y).toBeCloseTo(0, 6);
    expect(corners[2]!.x).toBeCloseTo(50, 6);
    expect(corners[2]!.y).toBeCloseTo(-50, 6);
    // Samma bild i grader (WGS 84): hörnen hamnar inom några cm.
    const nw = mapPointToWgs84(georef, { x: 0, y: 0 }), se = mapPointToWgs84(georef, { x: 50, y: -50 });
    const degrees = { width: 1000, height: 1000, crs: WGS84, transform: affineFromOrigin([nw.longitude, nw.latitude],
      [(se.longitude - nw.longitude) / 1000, (se.latitude - nw.latitude) / 1000]) };
    const viaWgs = layerCorners(layerToMap(degrees, georef), 1000, 1000);
    expect(Math.abs(viaWgs[2]!.x - 50)).toBeLessThan(0.05);
    expect(Math.abs(viaWgs[2]!.y + 50)).toBeLessThan(0.05);
    // RT 90 (3021) via WGS 84.
    expect(mapPointToProjected(georef, { x: 0, y: 0 }).easting).toBe(675000);
  });

  it("skärmens transform: kartans mitt i skärmens mitt, y nedåt", () => {
    const [a, b, c, d, e, f] = screenTransform({ a: 0.05, b: 0, c: 0, d: 0, e: -0.05, f: 0 }, { centerX: 0, centerY: 0, pxPerMm: 4, width: 800, height: 600 });
    expect([a, b, c, d, e, f]).toEqual([0.2, -0, 0, 0.2, 400, 300]);
  });
});

describe("laserjobbens underlag", () => {
  it("räknar EPSG 5845 (SWEREF 99 TM + RH 2000) som 3006 i planet", async () => {
    const { planarCrs } = await import("./map-project-layers");
    expect(planarCrs(5845)).toBe(3006);
    expect(planarCrs(3006)).toBe(3006);
    expect(planarCrs(4326)).toBe(4326);
  });
});
