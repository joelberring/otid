import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILT_IN_PRINT_PROFILES, emptyDocument, MAP_OWN_PRINT_PROFILE_ID, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { pressLayersFor } from "../../lib/course-setting-press-layers";
import { PrintColors } from "./course-setting-print-colors";
import { PrintPanel } from "./course-setting-print-panel";

/**
 * ADR-0215: "Färger för tryck" är en statusrad och två lägen; profilen, tabellen för hand och BL:s hela lista ligger under
 * "Avancerat", som är stängt som förval. Fliken Utskrift har samma skallista som banans egenskaper.
 */
// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage => ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)) });
const colors = [color(1, "Svart", 0, [0, 0, 0, 100]), color(2, "Brun 100%", 1, [0, 56, 100, 18]), color(3, "Gul 100%", 2, [0, 27, 79, 0])];
const usage = new Map<number, ColorUsage>([[1, used(["201"], ["LINE"])], [2, used(["101"], ["LINE"])], [3, used(["401"], ["AREA"])]]);

function render(profile: PrintProfile): string {
  return renderToStaticMarkup(<PrintColors saved={[]} profile={profile} colors={colors} usage={usage} norm="ISOM" detectedNorm="ISOM"
    layers={pressLayersFor(profile, colors, usage, 10000)} readOnly={false} onSelect={() => undefined} onSave={() => Promise.resolve(true)}
    cards={<div data-testid="bl-proposal" />} doubtful={<div data-testid="bl-doubtful" />} />);
}

describe("Färger för tryck (ADR-0215)", () => {
  it("förvalet: en statusrad, Kartans egna färger valt och Avancerat stängt utan profilval och tabell", () => {
    const html = render(BUILT_IN_PRINT_PROFILES.find(item => item.id === MAP_OWN_PRINT_PROFILE_ID)!);
    expect(html).toContain("Färger: kartans egna, i normens ordning (3 färger, 2 över banan)");
    expect(html).toMatch(/data-testid="print-colors-mode-map"[^>]*checked=""|checked=""[^>]*data-testid="print-colors-mode-map"/);
    expect(html).toMatch(/<details[^>]*data-testid="print-colors-advanced"/);
    expect(html).not.toMatch(/<details[^>]*open=""[^>]*data-testid="print-colors-advanced"/);
    expect(html).toContain("Avancerat");
    for (const hidden of ["print-profile-select", "print-profile-colors", "bl-course-layer", "bl-proposal", "bl-doubtful", "print-colors-details"]) {
      expect(html).not.toContain(`data-testid="${hidden}"`);
    }
  });

  it("Tryck hos BL visar bara de tveksamma färgerna; ett tidigare lagrat val säger Egna inställningar (Avancerat)", () => {
    const bl = render(BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!);
    expect(bl).toContain('data-testid="bl-doubtful"');
    expect(bl).not.toContain('data-testid="bl-proposal"');
    expect(bl).toContain("Färger: tryck hos BL (skog)");
    const custom = render(BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!);
    expect(custom).toContain("Färger: Egna inställningar (Avancerat) – Tryckeri (som i filen)");
    expect(custom).not.toMatch(/checked=""/);
  });
});

describe("fliken Utskrift (skalan)", () => {
  it("Alla kontroller väljer bland samma skalor som banans egenskaper (COURSE_PRINT_SCALES), också 1:3 000", () => {
    const html = renderToStaticMarkup(<PrintPanel document={emptyDocument({ title: "Skala", mapScale: 10000 })} view={ALL_CONTROLS} readOnly={false}
      onEdits={() => undefined} onPreview={() => undefined} onLayout={() => undefined} />);
    const options = [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
    expect(options).toEqual([15000, 10000, 7500, 5000, 4000, 3000]);
  });
});
