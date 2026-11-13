import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import { MapProjectRockPanel } from "./map-project-slider-panels";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte).
(globalThis as { React?: typeof React }).React = React;

const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const layers = (...names: string[]) => ({ loaded: names.map((_, index) => ({ layerId: `l${index}` })), layers: names.map((name, index) => ({ layerId: `l${index}`, name })) }) as unknown as ReturnType<typeof useMapProjectLayers>;
const importer = (canImport = true) => ({ canImport, crs: 3006, layers: [] }) as unknown as ReturnType<typeof useMapProjectImport>;
const render = (underlays: string[], canImport = true) => renderToStaticMarkup(<MapProjectRockPanel layers={layers(...underlays)} georeference={georeference} importer={importer(canImport)} />);

describe("panelen Berg i dagen med reglage", () => {
  it("säger vad den gör, och att bergbilden saknas bland underlagen på en äldre körning", () => {
    const html = render(["Karttapullautin – fuktdjup"]);
    expect(html).toContain("Berg i dagen med reglage (214)");
    expect(html).toContain("Berg i dagen ur laserns ojämnhet, öppenheten och närheten till vatten. Lågt värde tar bara tydliga hällar; högre tar med slätare hällar, strandklippor och berg under gles skog.");
    expect(html).toContain("Ingen bergbild bland underlagen. Kör laserjobbet igen för att få den.");
    expect(html).not.toContain('data-testid="map-project-rock-run"');
  });
  it("visar reglaget Mängd 1–10 med det restriktiva förvalet 3 och knappen för kandidater", () => {
    const html = render(["Karttapullautin hela kartan – berg"]);
    expect(html).toMatch(/<input type="range" min="1" max="10" step="1"[^>]*value="3"/);
    expect(html).toContain("Mängd: 3 av 10 (förval)");
    expect(html).toContain("1 ger få, 10 ger många.");
    expect(html).toContain('data-testid="map-project-rock-run"');
    expect(html).toContain("Visa som kandidater");
  });
  it("visas inte för den som inte får föreslå", () => {
    expect(render(["Karttapullautin – berg"], false)).toBe("");
  });
});
