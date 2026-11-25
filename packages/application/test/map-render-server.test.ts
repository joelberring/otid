import { describe, expect, it } from "vitest";
import { newMapFile } from "@o-tid/map-file";
import {
  boundsAndMunicipalitiesFromProjected, detectMapNorm, extractMapMetadata, PREVIEW_RASTER_MAX_SIDE_PX, renderParsedMapToPng
} from "../src/map-render-server";

describe("map-render-server", () => {
  it("auto-tags Swedish municipalities and counties from SWEREF 99 TM projected bounds", () => {
    // Centrala Stockholm i EPSG:3006 (ca 674000 E, 6580000 N).
    const stockholm = boundsAndMunicipalitiesFromProjected({
      epsg: 3006,
      extent: { minX: 672_000, minY: 6_578_000, maxX: 676_000, maxY: 6_582_000 }
    });
    expect(stockholm).not.toBeNull();
    expect(stockholm!.municipalityCodes).toContain("0180");
    expect(stockholm!.countyCodes).toContain("01");
    expect(stockholm!.footprint).toHaveLength(4);
    expect(stockholm!.wgs84Bounds.minLon).toBeGreaterThan(17.5);
    expect(stockholm!.wgs84Bounds.maxLon).toBeLessThan(18.5);
    expect(stockholm!.wgs84Bounds.minLat).toBeGreaterThan(59.0);
    expect(stockholm!.wgs84Bounds.maxLat).toBeLessThan(59.6);

    // Göteborg i EPSG:3006 (ca 319000 E, 6400000 N).
    const gothenburg = boundsAndMunicipalitiesFromProjected({
      epsg: 3006,
      extent: { minX: 318_000, minY: 6_399_000, maxX: 321_000, maxY: 6_402_000 }
    });
    expect(gothenburg).not.toBeNull();
    expect(gothenburg!.municipalityCodes).toContain("1480");
    expect(gothenburg!.countyCodes).toContain("14");
  });

  it("returns null for unsupported EPSG or null projected input", () => {
    expect(boundsAndMunicipalitiesFromProjected(null)).toBeNull();
    expect(boundsAndMunicipalitiesFromProjected({
      epsg: 999999,
      extent: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    })).toBeNull();
  });

  it("detects map norm from scale", () => {
    expect(detectMapNorm(4000)).toBe("ISSprOM");
    expect(detectMapNorm(5000)).toBe("ISSprOM");
    expect(detectMapNorm(7500)).toBe("ISOM");
    expect(detectMapNorm(10000)).toBe("ISOM");
    expect(detectMapNorm(15000)).toBe("ISOM");
    expect(detectMapNorm(25000)).toBe("OTHER");
    expect(detectMapNorm(null)).toBe("OTHER");
  });

  it("extracts metadata and renders a valid PNG with tie points from a georeferenced .omap", async () => {
    const bytes = newMapFile({
      symbolSet: "ISOM2017-2",
      scale: 10_000,
      refPoint: { easting: 674_000, northing: 6_580_000 },
      declinationDegrees: 6.2
    });
    const meta = extractMapMetadata(bytes, "stockholm-skog.omap");
    expect(meta.format).toBe("OMAP");
    expect(meta.scale).toBe(10_000);
    expect(meta.norm).toBe("ISOM");
    expect(meta.georeference).not.toBeNull();
    expect(meta.wgs84Bounds).not.toBeNull();
    expect(meta.municipalityCodes).toContain("0180");

    const rendered = await renderParsedMapToPng(meta.parsed, {
      targetDpi: 100,
      maxSidePx: PREVIEW_RASTER_MAX_SIDE_PX
    });
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.height).toBeGreaterThan(0);
    expect(rendered.width).toBeLessThanOrEqual(PREVIEW_RASTER_MAX_SIDE_PX);
    expect(rendered.height).toBeLessThanOrEqual(PREVIEW_RASTER_MAX_SIDE_PX);
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(rendered.png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(rendered.tiePoints).not.toBeNull();
    expect(rendered.tiePoints).toHaveLength(3);
  });
});
