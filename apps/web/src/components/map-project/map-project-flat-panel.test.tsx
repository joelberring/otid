import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MapGeoreference } from "@o-tid/map-file";
import { MapProjectFlatPanel } from "./map-project-flat-panel";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte).
(globalThis as { React?: typeof React }).React = React;

const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const layers = (...names: string[]) => ({ loaded: names.map((_, index) => ({ layerId: `l${index}` })), layers: names.map((name, index) => ({ layerId: `l${index}`, name })) }) as unknown as ReturnType<typeof useMapProjectLayers>;
const importer = (patch: { layers?: string[]; calm?: { level: number; formlineMeters: number; rings: number }; canImport?: boolean } = {}) => ({ canImport: patch.canImport ?? true, crs: 3006,
  layers: (patch.layers ?? []).map(name => ({ name })), calm: patch.calm && { ...patch.calm, removed: [], added: [] } }) as unknown as ReturnType<typeof useMapProjectImport>;
const render = (underlays: string[], hook = importer()) => renderToStaticMarkup(<MapProjectFlatPanel layers={layers(...underlays)} georeference={georeference} importer={hook} />);

describe("panelen Lugna kurvor på flack mark", () => {
  it("säger varför, och att fuktdjupet saknas bland underlagen", () => {
    const html = render(["Karttapullautin – terrängskuggning"], importer({ layers: ["contour", "formline"] }));
    expect(html).toContain("Lugna kurvor på flack mark");
    expect(html).toContain("På flack mark flyttar små höjdfel kurvorna många meter i sidled. Här tas hjälpkurvor och små ringar bort där marken lutar mindre än gränsen. Brantare terräng rörs inte.");
    expect(html).toContain("Inget fuktdjup bland underlagen. Kör laserjobbet med fuktigheten först.");
    expect(html).not.toContain('data-testid="map-project-flat-run"');
  });
  it("ber om grundkartan när inga kurvor finns bland kandidaterna", () => {
    const html = render(["Karttapullautin – fuktdjup"], importer({ layers: ["blott"] }));
    expect(html).toContain("Inga kurvor bland kandidaterna. Läs in grundkartan först (steg 2).");
    expect(html).not.toContain('data-testid="map-project-flat-level"');
  });
  it("visar reglaget 0–10 med förvalet 3 och knappen för att visa resultatet som kandidater", () => {
    const html = render(["Karttapullautin – fuktdjup"], importer({ layers: ["contour", "formline"] }));
    expect(html).toMatch(/<input type="range" min="0" max="10" step="1"[^>]*value="3"/);
    expect(html).toContain("Nivå 3 av 10 (förval): mark som lutar mindre än 1°, ringar under 1");
    expect(html).toContain('data-testid="map-project-flat-run"');
    expect(html).toContain("Visa som kandidater");
    expect(html).not.toContain('data-testid="map-project-flat-message"');
  });
  it("står på nivån som grundkartan lästes in med och säger vad som togs bort", () => {
    const html = render(["Karttapullautin – fuktdjup"], importer({ layers: ["contour"], calm: { level: 3, formlineMeters: 312, rings: 41 } }));
    expect(html).toContain("312 m hjälpkurva och 41 små ringar på flack mark tas bort.");
    expect(render(["Karttapullautin – fuktdjup"], importer({ calm: { level: 0, formlineMeters: 0, rings: 0 } }))).toContain("Av: ingenting tas bort");
    expect(render(["Karttapullautin – fuktdjup"], importer({ calm: { level: 5, formlineMeters: 20, rings: 1 } }))).toContain("20 m hjälpkurva och 1 liten ring på flack mark tas bort.");
  });
  it("visas inte för den som inte får föreslå", () => {
    expect(render(["Karttapullautin – fuktdjup"], importer({ canImport: false }))).toBe("");
  });
});
