import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_PIT_LIMITS } from "@o-tid/map-revision/base-map";
import { MapProjectPitPanel } from "./map-project-knoll-panel";
import type { useMapProjectImport } from "./use-map-project-import";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte).
(globalThis as { React?: typeof React }).React = React;

type Importer = ReturnType<typeof useMapProjectImport>;
const importer = (pits?: Partial<NonNullable<Importer["pits"]>>, canImport = true) => ({ canImport, choosePitLimits: () => undefined,
  pits: pits && { candidates: [], limits: DEFAULT_PIT_LIMITS, level: 5, scale: 15000, points: 0, rings: 0, ticks: 0, byHeight: 0, ...pits } }) as unknown as Importer;
const render = (value: Importer) => renderToStaticMarkup(<MapProjectPitPanel importer={value} />);

describe("panelen Gropar och sänkor med reglage", () => {
  it("säger vad den gör, och att grundkartan behöver läsas in från ett jobb med markens höjd", () => {
    const html = render(importer());
    expect(html).toContain("Gropar och sänkor med reglage (111, 103)");
    expect(html).toContain("Inga sökta sänkor i utkastet. Läs in grundkartan från ett laserjobb som har markens höjd sparad (hojd.png).");
    expect(html).not.toContain('data-testid="map-project-pits-amount"');
  });
  it("visar mängden 1–10 med förvalet 5, gränserna under Finjustera och vad som valdes", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({ at: [i, 0] as const, depth: 1, areaM2: 50, length: 8, width: 8 }));
    const html = render(importer({ candidates, points: 12, rings: 3 }));
    expect(html).toMatch(/<input type="range" min="1" max="10" step="1"[^>]*value="5"/);
    expect(html).toContain("Mängd: 5 av 10 (förval)");
    expect(html).toContain("Gropsymbol från: 0,4 m djup");
    expect(html).toContain("Ring av hjälpkurva från: 0,85 m djup");
    expect(html).toContain("Minsta avstånd mellan två gropsymboler: 15 m");
    expect(html).toContain("12 gropsymboler och 3 ringar av 40 möjliga sänkor.");
  });
  it("visas inte för den som inte får föreslå", () => {
    expect(render(importer({}, false))).toBe("");
  });
});
