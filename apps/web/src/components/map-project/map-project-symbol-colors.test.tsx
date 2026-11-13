import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MapColor } from "@o-tid/map-file";
import { EMPTY_LAYERS, standardSymbols } from "../../lib/map-project-layer-model";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import type { SymbolColorsControl } from "./map-project-symbol-colors";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte);
// komponenterna läses därför in efter att React lagts globalt (ikonerna i listan är JSX på modulnivå).
(globalThis as { React?: typeof React }).React = React;
const { SymbolColorsDialog } = await import("./map-project-symbol-colors");
const { MapProjectSymbolLayers } = await import("./map-project-symbol-layers");

const color = (id: number, name: string, rank: number, grey: number): MapColor =>
  ({ id, name, rank, cmyk: { c: 0, m: 0, y: 0, k: 1 - grey }, rgb: { r: grey, g: grey, b: grey }, opacity: 1 });
const colors = [color(0, "Svart", 0, 0), color(1, "Grå", 1, 0.6)];
const symbol = (id: string, code: string, name: string, kind: CatalogSymbol["kind"], palette: number[]): CatalogSymbol =>
  ({ id, code, name, kind, count: 3, group: "OTHER", icon: undefined, colors: palette });
const catalog = [symbol("a", "521", "Byggnad", "area", [1, 0]), symbol("b", "521.1", "Kant, byggnad", "line", [1])];
const control = (canChange: boolean): SymbolColorsControl => ({ colors, saved: [], canChange, ocad: false, onShow: vi.fn(), onSave: vi.fn(async () => true) });

describe("färg per symbol i symbollistan", () => {
  const list = (symbolColors?: SymbolColorsControl) => renderToStaticMarkup(<MapProjectSymbolLayers catalog={catalog} standard="ISOM" standardSymbols={standardSymbols("ISOM")}
    state={EMPTY_LAYERS} onState={() => undefined} canEdit onMerge={() => undefined} merging={undefined} message={undefined} symbolColors={symbolColors} />);

  it("har en färgknapp och en kryssruta per symbolrad för den som får ändra färgerna", () => {
    const html = list(control(true));
    expect(html).toContain('aria-label="Färg för 521 Byggnad"');
    expect(html).toContain('aria-label="Färg för 521.1 Kant, byggnad"');
    expect(html).toContain('aria-label="Markera 521 Byggnad"');
  });
  it("visar ingenting för den som inte får ändra färgerna, eller utan färgstyrning", () => {
    for (const html of [list(control(false)), list()]) {
      expect(html).not.toContain("Färg för 521");
      expect(html).not.toContain("map-project-layer-pick");
    }
  });
});

describe("dialogen för symbolens färger", () => {
  const dialog = (symbols: CatalogSymbol[], symbolControl = control(true)) => renderToStaticMarkup(<SymbolColorsDialog symbols={symbols} control={symbolControl} onClose={() => undefined} />);

  it("har en rullista över kartans färger för varje färg symbolen har (fyllning och kant)", () => {
    const html = dialog([catalog[0]!]);
    expect(html).toContain("Färg för 521 Byggnad");
    expect(html.match(/data-testid="map-project-symbol-color"/g)).toHaveLength(2);
    expect(html).toContain("Grå (som i filen)");
    expect(html).toContain("Svart (som i filen)");
  });
  it("tar flera symboler tillsammans: en rad per färg, med vilka symboler som har den", () => {
    const html = dialog(catalog);
    expect(html.match(/data-testid="map-project-symbol-color"/g)).toHaveLength(2);
    expect(html).toContain("i 521, 521.1");
  });
  it("låser rullistorna och döljer Spara när man inte får ändra", () => {
    const html = dialog([catalog[0]!], control(false));
    expect(html).toContain("Bara projektets ägare kan ändra symbolernas färger.");
    expect(html).toContain("disabled");
    expect(html).not.toContain("map-project-symbol-colors-save");
  });
  it("visar ett sparat byte som valt och ändrat", () => {
    const html = dialog([catalog[1]!], { ...control(true), saved: [{ symbol: "521.1", from: 1, to: 0 }] });
    expect(html).toContain('data-changed="true"');
    expect(html).toMatch(/<option value="0" selected="">Svart<\/option>/);
  });
});
