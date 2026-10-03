import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { entryTransferCandidatesSchema } from "@o-tid/contracts";
import { RacePreparationGuide } from "./race-preparation-guide";

const raceId = "10000000-0000-4000-8000-000000000001";
const data = entryTransferCandidatesSchema.parse({ formatVersion: 2, raceId,
  eventName: "Syntetisk tävling", raceName: "Lång", snapshotVersion: 1,
  raceDate: "2026-09-27", generatedAt: "2026-09-27T10:00:00.000Z",
  timeZone: "Europe/Stockholm", classes: [], entries: [] });

describe("TASK245 importingång i upplägget", () => {
  it("visar exakt lopplänk och den separata importgränsen", () => {
    const html = renderToStaticMarkup(<RacePreparationGuide data={data} disabled={false} />);
    expect(html).toContain(`href="/admin/${raceId}/imports"`);
    expect(html).toContain("IOF XML: banor, anmälningar eller startlista.");
    expect(html).toContain("Eventoranmälningar använder separat importbidrag och manuell klasskoppling.");
    expect(html).toContain("vanlig tävlingsadministration ger inte importrätt");
    expect(html).not.toMatch(/ApiKey|accessCredential|secretKey/i);
    expect(html).toContain("I hämtat minutstartunderlag saknas inga fasta starttider.");
  });

  it("spärrar import och alla sex arbetssteg när arbetsytan är låst", () => {
    const html = renderToStaticMarkup(<RacePreparationGuide data={data} disabled onOpenArea={() => undefined} />);
    expect(html).toContain("aria-disabled=\"true\"");
    expect(html).toContain("Öppna import för detta lopp");
    expect(html).not.toContain(`href="/admin/${raceId}/imports"`);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(6);
  });
});
