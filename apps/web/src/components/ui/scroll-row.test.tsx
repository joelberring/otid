import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { revealInRow, ScrollRow } from "./scroll-row";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

const box = (left: number, right: number) => ({ left, right }) as DOMRect;
function row(scrollLeft: number, scrollWidth = 800, clientWidth = 390) {
  return { scrollLeft, scrollWidth, clientWidth, getBoundingClientRect: () => box(0, clientWidth) } as unknown as HTMLElement;
}
const item = (left: number, right: number) => ({ getBoundingClientRect: () => box(left, right) }) as unknown as HTMLElement;

describe("raden som rullar i sidled (översynen 2026-11-17)", () => {
  it("rullar fram det valda med marginal mot kanten, men inte det som redan syns", () => {
    const right = row(0);
    revealInRow(right, item(400, 480));
    expect(right.scrollLeft).toBe(480 - (390 - 48));
    const left = row(300);
    revealInRow(left, item(-60, 20));
    expect(left.scrollLeft).toBe(300 - (48 + 60));
    const shown = row(100);
    revealInRow(shown, item(100, 200));
    expect(shown.scrollLeft).toBe(100);
    const fits = row(0, 390, 390);
    revealInRow(fits, item(400, 480));
    expect(fits.scrollLeft).toBe(0);
  });

  it("ritar raden med sina egenskaper och utan pilar innan den mätts", () => {
    const html = renderToStaticMarkup(<ScrollRow rowClassName="flikar" role="tablist" aria-label="Klubben">
      <button type="button" role="tab" aria-selected="true">Träningar</button></ScrollRow>);
    expect(html).toContain('class="flikar"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Klubben"');
    expect(html).not.toContain("scroll-row-forward");
  });
});
