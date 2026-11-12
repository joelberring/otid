import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LocalVerdict } from "./evaluate";
import { Verdict } from "./verdict-panel";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

/**
 * Användartestet 2026-11-12: en ny löpning på en bricka som redan har ett resultat för Bo Al. Beskedet sa "OKÄND BRICKA ·
 * Bo Al · Lång · Brickan är inte kopplad till någon deltagare" – namnet och "inte kopplad" samtidigt.
 */
describe("beskedet för en lånad bricka", () => {
  const current = { phase: "done" as const, cardNumber: "7505442", localSequence: 2 };
  const unknown: LocalVerdict = { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", missingControls: [], splits: [], name: "Bo Al", className: "Lång",
    variant: { code: "AC", assigned: true } };
  const render = (borrowed?: { name: string; className: string }) => renderToStaticMarkup(<Verdict current={current} verdict={unknown}
    item={undefined} qr={undefined} registration={undefined} timeZone="Europe/Stockholm" online={false} borrowed={borrowed} />);

  it("säger att brickan redan har ett resultat för löparen och frågar, utan namnet bredvid \"inte kopplad\"", () => {
    const html = render({ name: "Bo Al", className: "Lång" });
    expect(html).toContain("LÅNAD BRICKA?");
    expect(html).toContain("Bricka 7505442</p>");
    expect(html).toContain("Brickan har redan ett resultat för Bo Al (Lång). Är det samma löpare som läser av igen, eller har någon lånat brickan? " +
      "Anmäl den nya löparen nedan, eller välj att det är samma löpare.");
    expect(html).not.toContain("inte kopplad");
    expect(html).not.toContain("OKÄND BRICKA");
    expect(html).not.toContain("Variant AC");
  });

  it("en okänd bricka utan resultat är som förut", () => {
    const html = render();
    expect(html).toContain("OKÄND BRICKA");
    expect(html).toContain("Brickan är inte kopplad till någon deltagare. Anmäl löparen nedan.");
    expect(html).not.toContain("LÅNAD");
  });
});
