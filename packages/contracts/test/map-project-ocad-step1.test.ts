import { describe, expect, it } from "vitest";
import { mapProjectUpdateRequestSchema, type MapProjectView } from "../src";

describe("Etapp 3B: kontrakt för OCAD Steg 1 (canWriteVersion & färgfält)", () => {
  it("mapProjectUpdateRequestSchema accepterar giltiga colors och symbolColors och avvisar ogiltiga", () => {
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
