import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicLegRoutes } from "@o-tid/contracts";
import { RouteMap } from "../split-analysis/route-map";
import { paceText, parsePace, RouteChoiceCalibration, RouteChoiceSettingsForm } from "./route-choice-settings";

// Arbetsytans knappar och besked byggs med tsx utan React i omfånget; här räcker enkla element.
vi.mock("../ui", () => ({
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", { onClick, disabled }, children),
  Notice: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children)
}));

/** Steg 60: inställningarna för vägvalen, kalibreringen och den publika linjen "Bästa vägval enligt kartan". */
const RACE = "10000000-0000-4000-8000-000000000002", RUNNER = "10000000-0000-4000-8000-000000000004";

describe("vägvalens inställningar", () => {
  it("visar okända symboler med val av klass och talen med svenska decimaler", () => {
    const html = renderToStaticMarkup(<RouteChoiceSettingsForm settings={{ version: 1, contourIntervalMeters: 2.5, classBySymbol: { "308": "SLOW" } }}
      unknownSymbols={[{ code: "999.0", name: "Namn", objects: 1 }, { code: "412.1", name: "Fruktodling", objects: 4 }]} onSave={async () => true} />);
    expect(html).toContain("Inställningar för vägvalen");
    expect(html).toContain('value="2,5"');
    expect(html).toContain('value="8"');
    expect(html).toContain('value="6:00"');
    expect(html).toContain("999.0 Namn (1 objekt)");
    expect(html).toContain("412.1 Fruktodling (4 objekt)");
    // Tävlingens eget val står kvar så att det kan ändras igen.
    expect(html).toContain('aria-label="Hur symbol 308 ska räknas"');
    expect(html).toContain("Ej passerbar");
    // Klassernas interna namn finns bara som värden, aldrig som text.
    expect(html.replace(/value="[^"]*"/g, "")).not.toMatch(/IMPASSABLE|FIGHT|sha256/);
  });

  it("säger när alla symboler finns i tabellen", () => {
    const html = renderToStaticMarkup(<RouteChoiceSettingsForm settings={{ version: 1 }} unknownSymbols={[]} onSave={async () => true} />);
    expect(html).toContain("Alla symboler på kartan finns i tabellen.");
  });

  it("tolkar farten som min/km", () => {
    expect(paceText(330)).toBe("5:30");
    expect(parsePace("5:30")).toBe(330);
    expect(parsePace("6")).toBe(360);
    expect(parsePace("6,15")).toBe(375);
    expect(parsePace("1:00")).toBeUndefined();
    expect(parsePace("5:75")).toBeUndefined();
    expect(parsePace("snabbt")).toBeUndefined();
  });

  it("kalibreringen: knappen när det finns rutter, annars en rad om att de saknas", () => {
    const none = renderToStaticMarkup(<RouteChoiceCalibration runners={0} onCalibrate={async () => undefined} onSave={async () => true} />);
    expect(none).toContain("Inga uppladdade GPS-rutter");
    expect(none).not.toContain("Justera farterna");
    const some = renderToStaticMarkup(<RouteChoiceCalibration runners={3} onCalibrate={async () => undefined} onSave={async () => true} />);
    expect(some).toContain("Justera farterna efter de här rutterna");
    expect(some).toContain("3 löpare med resultat på banan har en uppladdad GPS-rutt");
  });
});

describe("publika vägvalskartan", () => {
  const data: PublicLegRoutes = { formatVersion: 1, raceId: RACE, leg: "31.1-32.1", map: { width: 992, height: 832, version: "a".repeat(16) },
    runners: [{ publicResultId: RUNNER, name: "Anna Vägval", className: "H21", legMs: 300_000, selected: true, points: [[136, 480], [352, 328]] }] };
  it("ritar bästa vägvalet enligt kartan bara när svaret har det", () => {
    const without = renderToStaticMarkup(<RouteMap raceId={RACE} data={data} />);
    expect(without).not.toContain("best-route");
    expect(without).not.toContain("Bästa vägval enligt kartan");
    const html = renderToStaticMarkup(<RouteMap raceId={RACE} data={{ ...data, bestRoute: { points: [[136, 480], [256, 376], [352, 328]] } }} />);
    expect(html).toContain('data-testid="best-route"');
    expect(html).toContain('points="136,480 256,376 352,328"');
    expect(html).toContain("Bästa vägval enligt kartan");
  });
});
