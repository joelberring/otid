import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "./language-provider";

// `shell.tsx` har modulnivå-JSX (`PHONE_ICON`), så React måste sitta på globalThis före importen.
(globalThis as { React?: typeof React }).React = React;
const { RaceAdministratorWorkspace } = await import("./race-administrator-workspace");

const RACE_ID = "10000000-0000-4000-8000-000000000001";

describe("RaceAdministratorWorkspace (lat laddning av sällan använda/tävlingstypsspecifika paneler)", () => {
  it("laddar PartyPanel, RogainingPanel, SettingsPanel, PeoplePanel, PublishPanel och AfterRacePanel dynamiskt med ssr: false bakom ws.shows", () => {
    const source = readFileSync(fileURLToPath(new URL("./race-administrator-workspace.tsx", import.meta.url)), "utf8");
    const lazyPanels = [
      ["PartyPanel", "./race-administrator/party-panel", "PARTY"],
      ["RogainingPanel", "./race-administrator/rogaining-panel", "ROGAINING"],
      ["SettingsPanel", "./race-administrator/settings-panel", "SETTINGS"],
      ["PeoplePanel", "./race-administrator/people-section", "PEOPLE"],
      ["PublishPanel", "./race-administrator/race-publication-section", "PUBLISH"],
      ["AfterRacePanel", "./race-administrator/after-race-panel", "RESULTS"]
    ] as const;

    const staticValueImports = [...source.matchAll(/^import\s+(?!type\b)[^;\n]+from\s+["']([^"']+)["']/gm)].map(match => match[1]!);
    for (const [name, modulePath, panel] of lazyPanels) {
      expect(staticValueImports, `${name} ska inte importeras statiskt`).not.toContain(modulePath);
      expect(source, `${name} ska laddas via next/dynamic`).toContain(`import("${modulePath}").then(m => m.${name})`);
      expect(source, `${name} ska bara monteras när ws.shows("${panel}") är sant`).toContain(`ws.shows("${panel}")`);
    }
    expect(source).toContain("ssr: false");
    expect(source).toContain("Hämtar…");
    expect(source).toContain("Loading…");
  });

  it("renderar utloggat arbetsyteskal rent på svenska och engelska utan att utlösa dynamiska paneler", () => {
    const svHtml = renderToStaticMarkup(<RaceAdministratorWorkspace raceId={RACE_ID} />);
    expect(svHtml).toContain('data-authenticated="false"');
    expect(svHtml).toContain("/organizer");

    const enHtml = renderToStaticMarkup(
      <LanguageProvider language="en"><RaceAdministratorWorkspace raceId={RACE_ID} /></LanguageProvider>
    );
    expect(enHtml).toContain('data-authenticated="false"');
    expect(enHtml).toContain("My O-Tid");
  });
});
