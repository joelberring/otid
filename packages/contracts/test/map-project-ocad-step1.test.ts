import { describe, expect, it } from "vitest";
import {
  mapProjectExportFormatSchema, mapProjectNewFormatSchema, mapProjectNewRequestSchema, mapProjectUpdateRequestSchema,
  type MapProjectExportFormat, type MapProjectView
} from "../src";

describe("Etapp 3B / 4B / 5B: kontrakt för OCAD (canWriteVersion, färgfält, ny karta-format & exportformat)", () => {
  it("mapProjectExportFormatSchema accepterar omap, ocd, geojson, ocd-full och omap-full och avvisar okända format", () => {
    const formats: MapProjectExportFormat[] = ["omap", "ocd", "geojson", "ocd-full", "omap-full"];
    for (const format of formats) expect(mapProjectExportFormatSchema.parse(format)).toBe(format);
    expect(mapProjectExportFormatSchema.safeParse("pdf").success).toBe(false);
    expect(mapProjectExportFormatSchema.safeParse(null).success).toBe(false);
  });

  it("mapProjectNewRequestSchema tillåter valfritt format (OMAP eller OCD) och avvisar okända format", () => {
    expect(mapProjectNewFormatSchema.parse("OMAP")).toBe("OMAP");
    expect(mapProjectNewFormatSchema.parse("OCD")).toBe("OCD");
    expect(mapProjectNewFormatSchema.safeParse("PDF").success).toBe(false);

    const base = {
      formatVersion: 1 as const,
      requestId: "10000000-0000-4000-8000-000000000010",
      name: "Ny OCAD-karta",
      symbolSet: "ISOM2017-2" as const,
      scale: 15000,
      area: { crs: "SWEREF99TM" as const, rings: [[[671000, 6573000], [672000, 6573000], [672000, 6574000]]] }
    };
    expect(mapProjectNewRequestSchema.parse(base).format).toBeUndefined();
    expect(mapProjectNewRequestSchema.parse({ ...base, format: "OMAP" }).format).toBe("OMAP");
    expect(mapProjectNewRequestSchema.parse({ ...base, format: "OCD" }).format).toBe("OCD");
    expect(mapProjectNewRequestSchema.safeParse({ ...base, format: "XMAP" }).success).toBe(false);
  });

  it("mapProjectUpdateRequestSchema accepterar giltiga colors, symbolColors och 7-siffriga OCAD textSymbols-id:n", () => {
    expect(mapProjectUpdateRequestSchema.parse({
      formatVersion: 1,
      textSymbols: [{ id: "1000001", copyOf: "999000", code: "1000.1", fontFamily: "Arial", size: 3, color: 1, bold: false, italic: false, framing: null }]
    })).toMatchObject({ formatVersion: 1 });
    expect(mapProjectUpdateRequestSchema.parse({
      formatVersion: 1,
      colors: [{ id: 1, cmyk: { c: 0.1, m: 0.2, y: 0.3, k: 0.4 } }]
    })).toEqual({
      formatVersion: 1,
      colors: [{ id: 1, cmyk: { c: 0.1, m: 0.2, y: 0.3, k: 0.4 } }]
    });
    expect(mapProjectUpdateRequestSchema.parse({ formatVersion: 1, colors: [] })).toEqual({ formatVersion: 1, colors: [] });
    expect(mapProjectUpdateRequestSchema.safeParse({
      formatVersion: 1,
      colors: [{ id: 1, cmyk: { c: 1.5, m: 0, y: 0, k: 0 } }]
    }).success).toBe(false);

    expect(mapProjectUpdateRequestSchema.parse({
      formatVersion: 1,
      symbolColors: [{ symbol: "521", from: 1, to: 2 }]
    })).toEqual({
      formatVersion: 1,
      symbolColors: [{ symbol: "521", from: 1, to: 2 }]
    });
    expect(mapProjectUpdateRequestSchema.parse({ formatVersion: 1, symbolColors: [] })).toEqual({ formatVersion: 1, symbolColors: [] });
    expect(mapProjectUpdateRequestSchema.safeParse({
      formatVersion: 1,
      symbolColors: [{ symbol: "521", from: 1, to: 2 }, { symbol: "521", from: 1, to: 3 }]
    }).success).toBe(false);
  });

  it("MapProjectView.viewer exponerar canWriteVersion oberoende av canManage", () => {
    const viewer: MapProjectView["viewer"] = {
      accountId: "10000000-0000-4000-8000-000000000001",
      canEdit: true,
      canManage: true,
      canWriteVersion: false,
      canArchive: false,
      canPropose: true,
      canDecide: true,
      canDownloadSource: true
    };
    expect(viewer.canManage).toBe(true);
    expect(viewer.canWriteVersion).toBe(false);
  });
});
