import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MapColor } from "@o-tid/map-file";
import { EMPTY_LAYERS, standardSymbols } from "../../lib/map-project-layer-model";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { LanguageProvider } from "../language-provider";
import type { SymbolColorsControl } from "./map-project-symbol-colors";

// Testerna byggs med den klassiska JSX-omvandlingen, som letar efter React globalt (komponenterna importerar det inte);
// komponenterna läses därför in efter att React lagts globalt (ikonerna i listan är JSX på modulnivå).
(globalThis as { React?: typeof React }).React = React;
const { ColorsDialog } = await import("./map-project-colors");
const { SymbolColorsDialog } = await import("./map-project-symbol-colors");
const { MapProjectSymbolLayers } = await import("./map-project-symbol-layers");

const color = (id: number, name: string, rank: number, grey: number, spot?: MapColor["spot"]): MapColor =>
  ({ id, name, rank, cmyk: { c: 0, m: 0, y: 0, k: 1 - grey }, rgb: { r: grey, g: grey, b: grey }, opacity: 1, ...(spot ? { spot } : {}) });
const colors = [color(0, "Svart", 0, 0), color(1, "Grå", 1, 0.6)];
const spotColors = [color(0, "Svart", 0, 0, { name: "BLACK", overprint: true, separations: [{ name: "BLACK", factor: 1 }] })];
const symbol = (id: string, code: string, name: string, kind: CatalogSymbol["kind"], palette: number[]): CatalogSymbol =>
  ({ id, code, name, kind, count: 3, group: "OTHER", icon: undefined, colors: palette });
const catalog = [symbol("a", "521", "Byggnad", "area", [1, 0]), symbol("b", "521.1", "Kant, byggnad", "line", [1])];
const control = (canChange: boolean): SymbolColorsControl => ({ colors, saved: [], canChange, onShow: vi.fn(), onSave: vi.fn(async () => true) });

describe("färg per symbol i symbollistan", () => {
  const list = (symbolColors?: SymbolColorsControl) => renderToStaticMarkup(<MapProjectSymbolLayers catalog={catalog} standard="ISOM" standardSymbols={standardSymbols("ISOM")}
    state={EMPTY_LAYERS} onState={() => undefined} canEdit onMerge={() => undefined} merging={undefined} message={undefined} symbolColors={symbolColors} />);

  it("har en färgknapp och en kryssruta per symbolrad för den som får ändra färgerna", () => {
    const html = list(control(true));
    expect(html).toContain('aria-label="Färg för 521 Byggnad"');
    expect(html).toContain('aria-label="Färg för 521.1 Kant, byggnad"');
    expect(html).toContain('aria-label="Markera 521 Byggnad"');
  });
  it("visar ingenting för den som inte får ändra färgerna eller utan färgstyrning", () => {
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

describe("dialogen för kartans färgtabell (full paritet för både OMAP/OCAD och dekorfärger)", () => {
  it("håller CMYK-fälten och Spara öppna för ägare (även för dekorfärger) och låser för icke-ägare (sv och en)", () => {
    const editableHtml = renderToStaticMarkup(
      <ColorsDialog colors={spotColors} saved={[]} canChange onShow={vi.fn()} onSave={vi.fn(async () => true)} onClose={() => undefined} />
    );
    expect(editableHtml).toContain('data-testid="map-project-colors-save"');
    expect(editableHtml).toContain('data-testid="map-project-colors-reset"');
    expect(editableHtml).toContain("Dekorfärg");
    expect(editableHtml).toMatch(/<input(?![^>]*\bdisabled\b)[^>]*aria-label="Svart, C i procent"/);

    const readOnlySvHtml = renderToStaticMarkup(
      <ColorsDialog colors={colors} saved={[]} canChange={false} onShow={vi.fn()} onSave={vi.fn(async () => true)} onClose={() => undefined} />
    );
    expect(readOnlySvHtml).toContain("Bara projektets ägare kan ändra färgerna.");
    expect(readOnlySvHtml).not.toContain('data-testid="map-project-colors-save"');
    expect(readOnlySvHtml).not.toContain('data-testid="map-project-colors-reset"');
    expect(readOnlySvHtml).toMatch(/<input[^>]*disabled=""[^>]*aria-label="Svart, C i procent"|<input[^>]*aria-label="Svart, C i procent"[^>]*disabled=""/);

    const readOnlyEnHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <ColorsDialog colors={spotColors} saved={[]} canChange={false} onShow={vi.fn()} onSave={vi.fn(async () => true)} onClose={() => undefined} />
      </LanguageProvider>
    );
    expect(readOnlyEnHtml).toContain("Only the owners of the project can change the colours.");
    expect(readOnlyEnHtml).toContain("Spot colour");
    expect(readOnlyEnHtml).not.toContain('data-testid="map-project-colors-save"');
  });
});
