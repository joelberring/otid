import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../language-provider";
import { NewMapProject } from "./new-map-project";

(globalThis as { React?: typeof React }).React = React;

describe("Etapp 5B: NewMapProject formatval Mapper (.omap) / OCAD (.ocd)", () => {
  it("visar filformatval med Mapper (.omap) som förval och OCAD (.ocd) som val på svenska", () => {
    const html = renderToStaticMarkup(<NewMapProject />);
    expect(html).toContain('data-testid="new-map-format"');
    expect(html).toContain("Filformat");
    expect(html).toContain("Mapper (.omap)");
    expect(html).toContain("OCAD (.ocd)");
    expect(html).toMatch(/value="OMAP"[^>]*checked=""|checked=""[^>]*value="OMAP"/);
    expect(html).not.toMatch(/value="OCD"[^>]*checked=""|checked=""[^>]*value="OCD"/);
  });

  it("renderar filformatval på engelska under LanguageProvider", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider language="en">
        <NewMapProject />
      </LanguageProvider>
    );
    expect(html).toContain("File format");
    expect(html).toContain("Mapper (.omap)");
    expect(html).toContain("OCAD (.ocd)");
    expect(html).toContain("Choose OCAD (.ocd) if the map will be opened directly in OCAD 12 or later.");
  });
});
