import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILT_IN_PRINT_PROFILES, MAP_OWN_PRINT_PROFILE_ID, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import type { PrintJobSelection } from "../../lib/course-setting-print-jobs";
import { PdfPanel } from "./course-setting-pdf-panel";

(globalThis as { React?: typeof React }).React = React;

const selection: PrintJobSelection = {
  items: [{ course: "k" }], template: undefined, templateIsDraft: false, savedTemplateIds: [],
  header: false, fill: "FILL", perRunner: false, duplex: false
};
const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number], spot?: MapColor["spot"]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1, ...(spot ? { spot } : {}) });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage =>
  ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)) });

describe("PdfPanel (Etapp 1C)", () => {
  const mapOwn = BUILT_IN_PRINT_PROFILES.find(item => item.id === MAP_OWN_PRINT_PROFILE_ID)!;
  const blForest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;

  it("visar kryssruta för kontorsljusning som är av som förval", () => {
    const html = renderToStaticMarkup(<PdfPanel raceId="r1" selection={selection} profile={mapOwn} colors={[color(1, "Svart", 0, [0, 0, 0, 100])]} disabled={false} />);
    expect(html).toContain('data-testid="print-pdf-office-lighten"');
    expect(html).toContain("Ljusa upp grönt och gult för kontorsskrivare (+30 % / +15 %)");
    expect(html).not.toMatch(/data-testid="print-pdf-office-lighten"[^>]*checked=""|checked=""[^>]*data-testid="print-pdf-office-lighten"/);
  });

  it("räknar in profiler med egna mapColors[].spot i hasSpots och döljer valet när filens enda spot stängts av med spot: null", () => {
    const plain = [color(1, "Svart", 0, [0, 0, 0, 100])];
    expect(renderToStaticMarkup(<PdfPanel raceId="r1" selection={selection} profile={mapOwn} colors={plain} disabled={false} />))
      .not.toContain('name="pdf-map-colors"');
    const withCustomSpot: PrintProfile = { ...mapOwn, id: "egen-spot", mapColors: [{ match: { ocadIds: [1] }, spot: { name: "Svart", overprint: true } }] };
    expect(renderToStaticMarkup(<PdfPanel raceId="r1" selection={selection} profile={withCustomSpot} colors={plain} disabled={false} />))
      .toContain('name="pdf-map-colors"');

    const withFileSpot = [color(1, "Svart", 0, [0, 0, 0, 100], { name: "Svart", overprint: true })];
    const spotDisabled: PrintProfile = { ...mapOwn, id: "egen-no-spot", mapColors: [{ match: { ocadIds: [1] }, spot: null }] };
    expect(renderToStaticMarkup(<PdfPanel raceId="r1" selection={selection} profile={spotDisabled} colors={withFileSpot} disabled={false} />))
      .not.toContain('name="pdf-map-colors"');
  });

  it("pekar Till förslaget mot #bl-doubtful i BL-läget när Avancerat är stängt", () => {
    const mapColors = [color(1, "Svart", 0, [0, 0, 0, 100])];
    const mapUsage = new Map<number, ColorUsage>([[1, used(["505"], ["LINE"])]]);
    const html = renderToStaticMarkup(<PdfPanel raceId="r1" selection={selection} profile={blForest} colors={mapColors} usage={mapUsage} disabled={false} />);
    expect(html).toMatch(/href="#bl-doubtful"[^>]*data-testid="print-pdf-to-proposal"/);
  });
});
