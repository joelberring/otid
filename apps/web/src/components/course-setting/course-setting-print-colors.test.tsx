import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILT_IN_PRINT_PROFILES, emptyDocument, MAP_OWN_PRINT_PROFILE_ID, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { pressLayersFor } from "../../lib/course-setting-press-layers";
import { ColorDetails, ColorTable, PrintColors } from "./course-setting-print-colors";
import { PrintPanel } from "./course-setting-print-panel";

/**
 * ADR-0215 + Etapp 1C: "Färger för tryck", Avancerat (readOnly, inaktiverade normval, radering av egen profil,
 * `numbersOnTop`-hjälptext, `detailsNorm`), och `ColorTable` (justerad färgruta, OVER/UNDER, `spot: null`, `lighten: 0`).
 */
// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number], spot?: MapColor["spot"]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1, ...(spot ? { spot } : {}) });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage => ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)) });
const colors = [
  color(1, "Svart", 0, [0, 0, 0, 100], { name: "Svart", overprint: true }),
  color(2, "Brun 100%", 1, [0, 56, 100, 18]),
  color(3, "Gul 100%", 2, [0, 27, 79, 0])
];
const usage = new Map<number, ColorUsage>([[1, used(["201"], ["LINE"])], [2, used(["101"], ["LINE"])], [3, used(["401"], ["AREA"])]]);

function render(profile: PrintProfile, extra: Partial<Parameters<typeof PrintColors>[0]> = {}): string {
  return renderToStaticMarkup(<PrintColors saved={[]} profile={profile} colors={colors} usage={usage} norm="ISOM" detectedNorm="ISOM"
    layers={pressLayersFor(profile, colors, usage, 10000)} readOnly={false} onSelect={() => undefined} onSave={() => Promise.resolve(true)}
    cards={<div data-testid="bl-proposal" />} doubtful={<div data-testid="bl-doubtful" />} {...extra} />);
}

describe("Färger för tryck (ADR-0215 + Etapp 1C)", () => {
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

  it("Avancerat: respekterar readOnly på profilväljaren, inaktiverar Norm/numbersOnTop i TOP-läge, och visar raderingsknapp för egen profil", () => {
    const mapOwn = BUILT_IN_PRINT_PROFILES.find(item => item.id === MAP_OWN_PRINT_PROFILE_ID)!;
    const savedProfile: PrintProfile = { ...mapOwn, id: "egen-1", name: "Klubbens profil", basedOn: mapOwn.id, numbersOnTop: true };
    const ownHtml = render(savedProfile, { saved: [savedProfile], defaultAdvanced: true });
    expect(ownHtml).toContain('data-testid="print-colors-delete"');
    expect(ownHtml).toContain("Kontrollnummer, texter och markeringar ligger överst.");
    expect(ownHtml).not.toContain("Kurvorna korsar numren");

    const builtInHtml = render(mapOwn, { defaultAdvanced: true, readOnly: true });
    expect(builtInHtml).not.toContain('data-testid="print-colors-delete"');
    expect(builtInHtml).toMatch(/<select[^>]*disabled=""[^>]*data-testid="print-profile-select"/);

    const topProfile: PrintProfile = { ...mapOwn, id: "egen-top", name: "Top", courseLayer: "TOP" };
    const topHtml = render(topProfile, { saved: [topProfile], defaultAdvanced: true });
    expect(topHtml).toMatch(/<select[^>]*disabled=""[^>]*data-testid="print-colors-norm"/);
    expect(topHtml).toMatch(/<input[^>]*disabled=""[^>]*data-testid="print-colors-numbers-top"/);
  });

  it("ColorDetails visar vald norm, konsekvent numbersOnTop-text och justerade färgrutor", () => {
    const mapOwn = BUILT_IN_PRINT_PROFILES.find(item => item.id === MAP_OWN_PRINT_PROFILE_ID)!;
    const manual: PrintProfile = { ...mapOwn, id: "egen-2", pressNorm: "ISOM", numbersOnTop: true, mapColors: [{ match: { ocadIds: [3] }, lighten: 50 }] };
    const html = renderToStaticMarkup(<ColorDetails profile={manual} colors={colors} usage={usage} layers={pressLayersFor(manual, colors, usage, 10000)} norm="ISOM" />);
    expect(html).toContain("Vald norm: Skog (ISOM).");
    expect(html).toContain("Kontrollnummer, texter och markeringar ligger överst.");
    // Gul (rgb 0.5, 0.5, 0.5) med lighten 50 % blir rgb(191, 191, 191), inte rå rgb(128, 128, 128).
    expect(html).toContain("rgb(191, 191, 191)");
  });

  it("ColorTable visar justerad färgruta, OVER/UNDER-märke, avmarkerad spot: null och explicit lighten: 0", () => {
    const office = BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!;
    const edited: PrintProfile = {
      ...office, id: "egen-3",
      mapColors: [
        { match: { ocadIds: [1] }, spot: null },
        { match: { ocadIds: [3] }, lighten: 0 },
        ...office.mapColors
      ]
    };
    const html = renderToStaticMarkup(<ColorTable profile={edited} colors={colors} layers={pressLayersFor(edited, colors, usage, 10000)} readOnly={false} onChange={() => undefined} />);
    expect(html).toMatch(/data-color="1"[^>]*data-side="OVER"/);
    expect(html).toMatch(/data-color="3"[^>]*data-side="UNDER"/);
    // Svart hade spot.overprint: true i filen men spot: null i profilen => kryssrutan ska INTE vara checked.
    const row1 = html.slice(html.indexOf('data-color="1"'), html.indexOf('data-color="2"'));
    expect(row1).not.toMatch(/aria-label="Dekorfärg, övertryck: Svart"[^>]*checked=""|checked=""[^>]*aria-label="Dekorfärg, övertryck: Svart"/);
    // Gul hade mönsterregel +15 % i office men explicit lighten: 0 => input visar 0.
    const row3 = html.slice(html.indexOf('data-color="3"'));
    expect(row3).toMatch(/aria-label="Ljusare % \(− mörkare\): Gul 100%"[^>]*value="0"/);
  });
});

describe("fliken Utsnitt (skalan)", () => {
  it("Alla kontroller väljer bland samma skalor som banans egenskaper (COURSE_PRINT_SCALES), också 1:3 000", () => {
    const html = renderToStaticMarkup(<PrintPanel document={emptyDocument({ title: "Skala", mapScale: 10000 })} view={ALL_CONTROLS} readOnly={false}
      onEdits={() => undefined} onPreview={() => undefined} onLayout={() => undefined} />);
    const options = [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
    expect(options).toEqual([15000, 10000, 7500, 5000, 4000, 3000]);
  });
});
