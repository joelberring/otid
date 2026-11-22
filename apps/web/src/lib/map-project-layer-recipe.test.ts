import { describe, expect, it } from "vitest";
import { layerRecipeOf } from "./map-project-layer-recipe";

/** PLAN.md steg M4: receptet ur registret blir ett anrop som webbläsaren kan göra om; laserns och okända recept inte. */
describe("layerRecipeOf", () => {
  it("tar ett hämtat underlags recept utan registrets tidpunkt", () => {
    const box = { south: 59.29, west: 18, north: 59.31, east: 18.04 };
    expect(layerRecipeOf({ source: "SLU_MOISTURE", request: { formatVersion: 1, box }, createdAt: "2026-11-22T12:00:00.000Z" }))
      .toEqual({ source: "SLU_MOISTURE", request: { formatVersion: 1, box } });
    expect(layerRecipeOf({ source: "LM_ORTHO", href: "https://api.lantmateriet.se/x.tif", area: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      collection: "ortofoto", datetime: null })?.source).toBe("LM_ORTHO");
  });
  it("ger inget för laserns recept, ett okänt eller trasigt", () => {
    expect(layerRecipeOf({ source: "LASER", jobId: "x", output: "karta.png" })).toBeUndefined();
    expect(layerRecipeOf({ source: "WMS", request: { url: "ftp://x" } })).toBeUndefined();
    expect(layerRecipeOf(null)).toBeUndefined();
  });
});
