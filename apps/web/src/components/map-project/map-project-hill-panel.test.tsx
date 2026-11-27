import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_HILL_LIMITS } from "@o-tid/map-revision/base-map";
import { MapProjectHillPanel } from "./map-project-hill-panel";
import type { useMapProjectImport } from "./use-map-project-import";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte).
(globalThis as { React?: typeof React }).React = React;

type Importer = ReturnType<typeof useMapProjectImport>;
const importer = (hills?: Partial<NonNullable<Importer["hills"]>>, canImport = true) => ({ canImport, chooseHillLimits: () => undefined,
  hills: hills && { candidates: [], limits: DEFAULT_HILL_LIMITS, level: 5, scale: 15000, rings: 0, contours: 0, hidden: [], ...hills } }) as unknown as Importer;
const render = (value: Importer) => renderToStaticMarkup(<MapProjectHillPanel importer={value} />);

describe("panelen Små höjder som ring", () => {
  it("säger vad den gör, och att grundkartan behöver läsas in från ett jobb med markens höjd", () => {
    const html = render(importer());
    expect(html).toContain("Små höjder som ring (101, 103)");
    expect(html).toContain("Inga sökta höjder i utkastet. Läs in grundkartan från ett laserjobb som har markens höjd sparad (hojd.png).");
    expect(html).not.toContain('data-testid="map-project-hills-amount"');
  });
  it("visar mängden 1–10 med förvalet 5, gränsen under Finjustera och vad som valdes", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({ at: [i, 0] as const, top: 40, rise: 1.2, areaM2: 200 }));
    const hidden = [{ layer: "dotknoll", geometry: { kind: "point" as const, at: [0, 0] as [number, number] } }];
    const html = render(importer({ candidates, rings: 7, contours: 4, hidden }));
    expect(html).toMatch(/<input type="range" min="1" max="10" step="1"[^>]*value="5"/);
    expect(html).toContain("Mängd: 5 av 10 (förval)");
    expect(html).toContain("Ring från: 0,8 m hög");
    expect(html).toContain("7 ringar (4 höjdkurvor, 3 hjälpkurvor) av 30 möjliga höjder; 1 punkthöjd ersattes av en ring.");
  });
  it("visas inte för den som inte får föreslå", () => {
    expect(render(importer({}, false))).toBe("");
  });
});
