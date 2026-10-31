import { describe, expect, it } from "vitest";
import { deriveRasterGeoreference, projectRasterPixel } from "@o-tid/domain";
import { raceMapSourceMetadataSchema } from "@o-tid/contracts";
import { renderSize, type MapGeoreference, type ParsedMap } from "@o-tid/map-file";
import { cornerTiePoints, mapFileMetadata, type ToWgs84 } from "./map-file-metadata";

/** Steg 59: metadata och de tre punkterna ur kartfilens georeferens. Omräkningen till WGS 84 är en enkel falsk här. */
const georeference: MapGeoreference = { scale: 10_000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675_000, northing: 6_580_000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
/** 1 mm = 10 m; 59,3 N 18,0 E i kartans origo, norr uppåt. */
const fake: ToWgs84 = (_georeference, point) => ({ latitude: 59.3 + point.y * 10 / 111_195,
  longitude: 18 + point.x * 10 / (111_195 * Math.cos(59.3 * Math.PI / 180)) });

const map: ParsedMap = { format: "OMAP", version: "Mapper v9", colors: [], symbols: new Map(), scale: 10_000, georeference,
  objects: [{ kind: "point", symbol: "1", at: { x: 0, y: 0 }, angle: 0 }], bounds: { minX: -50, minY: -40, maxX: 50, maxY: 40 },
  warnings: [{ code: "UNKNOWN_SYMBOL_TYPE", count: 2, text: "Okänd symboltyp" }] };

describe("kartfilens metadata", () => {
  it("räknar tre hörn så att georeferensen i race_map stämmer med kartfilen", () => {
    const size = renderSize(map, 8)!;
    const tiePoints = cornerTiePoints(georeference, size, fake)!;
    expect(tiePoints.map(point => [point.pixelX, point.pixelY])).toEqual([[0, 0], [size.width - 1, 0], [0, size.height - 1]]);
    const { transform } = deriveRasterGeoreference({ imageWidth: size.width, imageHeight: size.height, tiePoints });
    // Kartans origo (0, 0) mm ligger i pixeln ((0 − (−52))·8, (42 − 0)·8).
    const center = projectRasterPixel(transform, 52 * 8, 42 * 8);
    expect(center.latitude).toBeCloseTo(59.3, 6);
    expect(center.longitude).toBeCloseTo(18, 6);
  });

  it("ger inga punkter utan georeferens, med okänt koordinatsystem eller när omräkningen inte går", () => {
    const size = renderSize(map, 8)!;
    expect(cornerTiePoints(null, size, fake)).toBeNull();
    expect(cornerTiePoints({ ...georeference, crs: { kind: "UNKNOWN", description: "Lokalt" } }, size, fake)).toBeNull();
    expect(cornerTiePoints(georeference, size, () => null)).toBeNull();
    expect(cornerTiePoints(georeference, size, () => { throw new Error("fel"); })).toBeNull();
  });

  it("följer kontraktet med yta, upplösning, sammanfattning och förenklingar", () => {
    const size = renderSize(map, 8)!;
    const metadata = mapFileMetadata(map, size, ["Text ritas med standardtypsnitt och vänsterställd"], fake)!;
    expect(raceMapSourceMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(metadata).toMatchObject({ format: "OMAP", scale: 10_000, render: { pxPerMm: 8, originX: -52, originY: 42 },
      summary: { objectCount: 1, warnings: [{ code: "UNKNOWN_SYMBOL_TYPE", count: 2 }],
        simplifications: ["Text ritas med standardtypsnitt och vänsterställd"] } });
    const reduced = mapFileMetadata(map, { ...size, pxPerMm: 6.5, reduced: true }, [], fake)!;
    expect(reduced.summary.simplifications[0]).toBe("Kartan är stor och ritas med 6,5 px per mm");
    expect(mapFileMetadata({ ...map, bounds: null }, size, [], fake)).toBeUndefined();
  });
});
