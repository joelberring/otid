import { describe, expect, it } from "vitest";
import { projectedToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { fitControlPoints, pixelAt, placeInBounds, worldFromMap } from "./map-project-control-points";
import { layerToMap } from "./map-project-layers";

/** ADR-0219 K6b: passpunkter för en skannad bild. */
const truth = { a: 0.2, b: 0.05, c: 10, d: 0.03, e: -0.21, f: 300 };
const apply = (t: typeof truth, x: number, y: number) => ({ x: t.a * x + t.b * y + t.c, y: t.d * x + t.e * y + t.f });
const georef: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 2, combinedScaleFactor: 1 };

describe("passpunkter", () => {
  it("affin med tre eller fler punkter återger transformen och ger avvikelserna", () => {
    const pixels = [[0, 0], [1000, 0], [0, 800], [1000, 800], [500, 400]];
    const points = pixels.map(([x, y]) => ({ pixel: { x: x!, y: y! }, map: apply(truth, x!, y!) }));
    const fit = fitControlPoints(points)!;
    expect(fit.kind).toBe("affine");
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) expect(fit.toMap[key]).toBeCloseTo(truth[key], 8);
    expect(fit.rms).toBeLessThan(1e-8);
    // En felklickad punkt syns som den största avvikelsen.
    const wrong = points.map((point, index) => index === 4 ? { ...point, map: { x: point.map.x + 3, y: point.map.y } } : point);
    const off = fitControlPoints(wrong)!;
    expect(off.residuals.indexOf(Math.max(...off.residuals))).toBe(4);
  });

  it("likformig med två punkter: flytt, vridning och skala, och bildens rader nedåt", () => {
    const angle = 0.3, size = 0.25;
    const t = { a: size * Math.cos(angle), b: size * Math.sin(angle), c: 50, d: size * Math.sin(angle), e: -size * Math.cos(angle), f: 80 };
    const points = [[0, 0], [400, 300]].map(([x, y]) => ({ pixel: { x: x!, y: y! }, map: apply(t, x!, y!) }));
    const fit = fitControlPoints(points)!;
    expect(fit.kind).toBe("similarity");
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) expect(fit.toMap[key]).toBeCloseTo(t[key], 8);
    expect(fitControlPoints(points.slice(0, 1))).toBeUndefined();
    expect(fitControlPoints(points, "affine")).toBeUndefined();
    // Tre punkter på en linje går inte för affin.
    expect(fitControlPoints([0, 1, 2].map(i => ({ pixel: { x: i, y: i }, map: { x: i, y: i } })), "affine")).toBeUndefined();
  });

  it("pixeln under en punkt och världsfilen i kartans system går tillbaka till samma placering", () => {
    const pixel = pixelAt(truth, apply(truth, 123, 456));
    expect(pixel.x).toBeCloseTo(123, 8);
    expect(pixel.y).toBeCloseTo(456, 8);
    const world = worldFromMap(truth, 1000, 800, georef);
    const back = layerToMap({ width: 1000, height: 800, crs: 3006, transform: world }, georef);
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) expect(back[key]).toBeCloseTo(truth[key], 4);
    expect(projectedToMapPoint(georef, { easting: world.c, northing: world.f }).x).toBeCloseTo(truth.c, 4);
  });

  it("en bild utan georeferens läggs mitt i området", () => {
    const placed = placeInBounds(200, 100, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const corner = apply(placed, -0.5, -0.5), far = apply(placed, 199.5, 99.5);
    expect(corner.x).toBeCloseTo(5, 8);
    expect(far.x).toBeCloseTo(95, 8);
    expect((corner.y + far.y) / 2).toBeCloseTo(50, 8);
    expect(corner.y).toBeGreaterThan(far.y);
  });
});
