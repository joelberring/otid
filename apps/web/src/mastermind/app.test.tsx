import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;
const { MastermindApp } = await import("./app");

describe("MastermindApp UX", () => {
  it("visar tydlig lägesbricka för lokal dator, träning och publik station samt spara-knapp i inställningar", () => {
    const localHtml = renderToStaticMarkup(<MastermindApp language="sv" />);
    expect(localHtml).toContain("data-mode=\"local\"");
    expect(localHtml).toContain("Lokal dator – sparas bara här");
    expect(localHtml).toContain("data-testid=\"mastermind-save-settings\"");
    expect(localHtml).toContain("Spara inställningar");

    const trainingHtml = renderToStaticMarkup(<MastermindApp language="sv" raceId="11111111-1111-4111-8111-111111111111" />);
    expect(trainingHtml).toContain("data-mode=\"training\"");
    expect(trainingHtml).toContain("Träning");

    const stationHtml = renderToStaticMarkup(<MastermindApp language="en" raceId="11111111-1111-4111-8111-111111111111" station />);
    expect(stationHtml).toContain("data-mode=\"station\"");
    expect(stationHtml).toContain("Public station");
    expect(stationHtml).not.toContain("data-testid=\"mastermind-save-settings\"");
  });
});
