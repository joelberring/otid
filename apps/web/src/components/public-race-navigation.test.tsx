import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicRaceNavigation } from "./public-race-navigation";

const raceId = "10000000-0000-4000-8000-000000000001";

describe("publik tävlingsnavigering", () => {
  it("länkar från resultatet till tävlingssidan och samma lopps startlista utan självlänk", () => {
    const html = renderToStaticMarkup(<PublicRaceNavigation raceId={raceId} shortCode="k7m2qx" currentPage="results" />);
    expect(html).toContain('<nav class="nav" aria-label="Publik navigering">');
    expect(html).toContain('href="/t/k7m2qx"');
    expect(html).toContain("Tävlingssidan");
    expect(html).toContain('href="/starts/10000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Till startlistan");
    expect(html).not.toContain('href="/"');
    expect(html).not.toContain(`href="/results/${raceId}"`);
  });

  it("länkar från startlistan till tävlingssidan och samma lopps resultat utan självlänk", () => {
    const html = renderToStaticMarkup(<PublicRaceNavigation raceId={raceId} shortCode="k7m2qx" currentPage="starts" />);
    expect(html).toContain('href="/t/k7m2qx"');
    expect(html).toContain('href="/results/10000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Till resultatlistan");
    expect(html).not.toContain(`href="/starts/${raceId}"`);
  });
});
