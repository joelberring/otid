import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Explain, Hint } from "./index";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

describe("förklaringar som syns på pekskärm (översynen 2026-11-17, C4)", () => {
  it("Explain: en knapp med den korta texten oförändrad; förklaringen som beskrivning (title) medan den är dold", () => {
    const html = renderToStaticMarkup(<Explain text="Antal förstaplatser">1:a</Explain>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="Antal förstaplatser"');
    // Bara knappen med sin text: förklaringen står inte synlig förrän man trycker.
    expect(html).toMatch(/>1:a<\/button>$/);
  });

  it("Explain utan text: ett litet i med namnet Förklaring", () => {
    const html = renderToStaticMarkup(<Explain text="Från Eventor: Inställningar → Eventor." />);
    expect(html).toContain('<span aria-hidden="true">i</span><span class="visually-hidden">Förklaring</span>');
    expect(html).toContain('title="Från Eventor: Inställningar → Eventor."');
  });

  it("Explain utfälld: förklaringen står synlig efter knappen och inte dubbelt i namnet", () => {
    const html = renderToStaticMarkup(<Explain text="Fri start" defaultOpen>–</Explain>);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/<\/button><span class="[^"]*"> Fri start<\/span>$/);
  });

  it("Hint: en kort dämpad rad med id för aria-describedby", () => {
    const html = renderToStaticMarkup(<Hint id="varfor">Välj en bana först.</Hint>);
    expect(html).toMatch(/^<span class="[^"]*" id="varfor">Välj en bana först\.<\/span>$/);
  });
});
