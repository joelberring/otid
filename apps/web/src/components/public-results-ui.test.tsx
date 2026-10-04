import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { hasActivePublicResultFilters, PublicResults } from "./public-results";
import { PublicResultDetail } from "./public-result-detail";

const raceId = "10000000-0000-4000-8000-000000000001";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("publik resultatlista", () => {
  it("erbjuder återställning bara när minst ett filter är aktivt", () => {
    expect(hasActivePublicResultFilters("", "", false)).toBe(false);
    expect(hasActivePublicResultFilters("  ", "", false)).toBe(false);
    expect(hasActivePublicResultFilters("Ada", "", false)).toBe(true);
    expect(hasActivePublicResultFilters("", "D21", false)).toBe(true);
    expect(hasActivePublicResultFilters("", "", true)).toBe(true);

    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{ formatVersion: 1, results: [] }} />);
    expect(html).toContain("Inga publicerade resultat ännu.");
    expect(html).not.toContain("Rensa alla filter");
    const component = source("./public-results.tsx");
    expect(component).toContain("setQuery(\"\");");
    expect(component).toContain("setClassFilter(\"\");");
    expect(component).toContain("setFavoritesOnly(false);");
    expect(component).toContain("hasActivePublicResultFilters(query, classFilter, favoritesOnly)");
  });

  it("visar automatisk uppdateringsstatus även utan resultat och väntar med klocktid till klientpoll", () => {
    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{ formatVersion: 1, results: [] }} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Resultaten uppdateras direkt när anslutningen fungerar, annars var femte sekund.");
    expect(html).not.toContain("bekräftades senast");
  });

  it("visar exakt placering, millisekunder och tid efter utan interna identifierare", () => {
    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 1,
      results: [{
        className: "H21",
        givenName: "Ada",
        familyName: "Lovelace",
        organisationName: "OK Exempel",
        revision: 2,
        status: "OK",
        reason: "COMPLETE",
        elapsedMs: 61_250,
        splits: [
          { controlCode: 31, occurrence: 1, elapsedMs: 30_125, legMs: 30_125 },
          { controlCode: 31, occurrence: 2, elapsedMs: 61_250, legMs: 31_125 }
        ],
        rankingState: "RANKED",
        position: 1,
        timeBehindMs: 0
      }]
    }} />);
    expect(html).toContain("Placering");
    expect(html).toContain("Sök namn eller klass");
    expect(html).toContain("Välj klass");
    expect(html).toContain("Visar 1 av 1 resultat");
    expect(html).toContain("1:01");
    expect(html).not.toContain("1:01.250");
    expect(html).toContain("+0:00");
    expect(html).toContain("Visa sträcktider");
    expect(html).toContain("Kontroll</strong> 31");
    expect(html).toContain("Sträcka</strong> 0:30");
    expect(html).toContain("Totalt</strong> 0:30");
    expect(html).toContain("Kontroll</strong> 31 (2)");
    expect(html).not.toContain(raceId);
    expect(html).not.toContain("entryId");
  });

  it("visar textvarning och undertrycker ranking vid blandade banversioner", () => {
    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 1,
      results: [{
        className: "D21",
        givenName: "Grace",
        familyName: "Hopper",
        organisationName: null,
        revision: 1,
        status: "OK",
        reason: "COMPLETE",
        elapsedMs: 70_000,
        splits: [],
        rankingState: "MIXED_COURSE_VERSIONS"
      }]
    }} />);
    expect(html).toContain("olika historiska banversioner");
    expect(html).toContain("role=\"alert\"");
    expect(html).not.toContain("+0:00");
  });

  it("visar DSQ och manuell provenans på svenska utan ranking", () => {
    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 2,
      results: [{
        className: "H21",
        givenName: "Ada",
        familyName: "Löpare",
        organisationName: "Centrum OK",
        revision: 2,
        status: "DSQ",
        reason: "MANUAL_DISQUALIFICATION",
        elapsedMs: 2_400_000,
        splits: [],
        rankingState: "NOT_RANKABLE_STATUS"
      }]
    }} />);
    expect(html).toContain("Diskvalificerad");
    expect(html).toContain("Diskvalificerad manuellt av arrangör");
    expect(html).not.toContain("MANUAL_DISQUALIFICATION");
    expect(html).toContain("class=\"result-dsq\"");
  });

  it("visar manuellt godkännande och bevarad saknad kontroll i format 3", () => {
    const html = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 3,
      results: [{
        className: "D21",
        givenName: "Ada",
        familyName: "Löpare",
        organisationName: "Centrum OK",
        revision: 4,
        status: "OK",
        reason: "MANUAL_APPROVAL",
        elapsedMs: 2_400_000,
        missingControls: [32],
        extraPunches: [],
        splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }],
        rankingState: "RANKED",
        position: 1,
        timeBehindMs: 0
      }]
    }} />);
    expect(html).toContain("Godkänd manuellt av arrangör");
    expect(html).toContain("Saknas: 32");
    expect(html).toContain("Sträcka</strong> 10:00");
    expect(html).not.toContain("MANUAL_APPROVAL");
  });

  it("fabricerar inte tid eller sträckrapport för DNF eller utan tidtagning", () => {
    const dnf = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 4,
      results: [{
        className: "H21", givenName: "Bo", familyName: "Skog", organisationName: null,
        revision: 1, status: "DNF", reason: "DID_NOT_FINISH", splits: [],
        missingControls: [], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS"
      }]
    }} />);
    const withoutTiming = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{
      formatVersion: 6,
      results: [{
        className: "Öppen", givenName: "Cy", familyName: "Löpare", organisationName: null,
        revision: 1, status: "NT", reason: "WITHOUT_TIMING", rankingState: "NOT_RANKABLE_STATUS"
      }]
    }} />);
    expect(dnf).toContain("Ej fullföljt"); expect(dnf).not.toContain("Visa sträcktider");
    expect(withoutTiming).toContain("Utan tidtagning"); expect(withoutTiming).not.toContain("Visa sträcktider");
  });

  it("har avdelade 640 px-rader i stället för horisontell tabellscroll", () => {
    const css = source("../app/globals.css");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain(".public-results-table tbody tr { display: grid;");
    expect(css).toContain(".public-results-page .public-results-table tbody tr { display: grid;");
    expect(css).not.toContain(".public-results { overflow-x: auto; }");
  });

  it("återställer det filtrerade resultatunderlaget till en svartvit tabell vid browserutskrift", () => {
    const css = source("../app/globals.css");
    const component = source("./public-results.tsx");
    expect(component).toContain("filteredRows.map");
    expect(css).toContain("body:has(:is(.public-results-table, .public-result-detail)) > header, body:has(:is(.public-results-table, .public-result-detail)) main > nav { display: none; }");
    expect(css).toContain(".public-results-controls :is(label, input, select) { display: none; }");
    expect(css).toContain(".public-results-table thead { display: table-header-group;");
    expect(css).toContain(".public-results-table :is(tr, tbody tr) { display: table-row; break-inside: avoid;");
    expect(css).toContain(".public-results-refresh-status { display: none; }");
  });

  it("länkar en format 7-rad med opaque publik identitet och visar samma säkra detaljfakta", () => {
    const publicResultId = "e9b2bb2d-1af7-4bf2-8e36-21c32f02a537";
    const result = {
      className: "H21", givenName: "Ada", familyName: "Lovelace", organisationName: "OK Exempel",
      publicResultId, revision: 2, status: "OK" as const, reason: "COMPLETE" as const,
      elapsedMs: 61_250, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_125, legMs: 30_125 }],
      missingControls: [], extraPunches: [], rankingState: "RANKED" as const, position: 1, timeBehindMs: 0
    };
    const list = renderToStaticMarkup(<PublicResults raceId={raceId} initial={{ formatVersion: 7, results: [result] }} />);
    const detail = renderToStaticMarkup(<PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={{ formatVersion: 1, result }} />);
    expect(list).toContain(`/results/${raceId}/participants/${publicResultId}`);
    expect(list).toContain("Öppna resultat: Ada Lovelace");
    expect(list).toContain("Spara favorit");
    expect(list).toContain("Välj rutt för jämförelse");
    expect(list).toContain("0 av 3 rutter valda för jämförelse");
    expect(list).toContain('aria-pressed="false"');
    expect(detail).toContain("Ada Lovelace"); expect(detail).toContain("1:01");
    expect(`${list}${detail}`).not.toMatch(/entryId|cardNumber|readoutId|evaluation/i);
    expect(source("../lib/public-result-favorites.ts")).toContain("otid:public-result-favorites:v1");
    expect(source("../app/globals.css")).toContain("body:has(:is(.public-results-table, .public-result-detail))");
    expect(source("../app/api/public/races/[raceId]/results/[publicResultId]/route.ts")).toContain("publicResultDetail(db, raceId, publicResultId)");
    expect(source("../app/results/[raceId]/participants/[publicResultId]/page.tsx")).toContain("if (detail.status === \"not-found\") notFound();");
    expect(source("./public-results.tsx")).toContain("/route-comparison?first=");
  });

  it("behåller MP/DSQ-orsak och stämplingsfakta i den publika detaljen", () => {
    const publicResultId = "e9b2bb2d-1af7-4bf2-8e36-21c32f02a537";
    const mp = renderToStaticMarkup(<PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={{
      formatVersion: 1,
      result: {
        className: "H21", givenName: "Bo", familyName: "Kontroll", organisationName: "OK Exempel",
        publicResultId, revision: 3, status: "MP", reason: "MISSING_CONTROL",
        elapsedMs: 3_900_000, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 1_200_000, legMs: 1_200_000 }],
        missingControls: [42], extraPunches: [99], rankingState: "NOT_RANKABLE_STATUS"
      }
    }} />);
    expect(mp).toContain("Felstämplad");
    expect(mp).toContain("Obligatorisk kontroll saknas");
    expect(mp).toContain("<strong>Saknas:</strong> 42");
    expect(mp).toContain("<strong>Extra:</strong> 99");
    expect(mp).toContain("Visa sträcktider");
    expect(mp).toContain('class="result-mp"');
    expect(mp).not.toContain(publicResultId);

    const dsq = renderToStaticMarkup(<PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={{
      formatVersion: 1,
      result: {
        className: "H21", givenName: "Cia", familyName: "Diskad", organisationName: null,
        publicResultId, revision: 2, status: "DSQ", reason: "MANUAL_DISQUALIFICATION",
        elapsedMs: 3_700_000, splits: [], missingControls: [], extraPunches: [],
        rankingState: "NOT_RANKABLE_STATUS"
      }
    }} />);
    expect(dsq).toContain("Diskvalificerad manuellt av arrangör");
    expect(dsq).toContain('class="result-dsq"');
    expect(dsq).not.toContain("Visa sträcktider");
  });

  it("återanvänder den no-PII SSE-väckning som bara läser om exakt deltagardetalj", () => {
    const detailComponent = source("./public-result-detail.tsx");
    expect(detailComponent).toContain('startPublicResultEventStream(raceId, window.EventSource');
    expect(detailComponent).toContain('/api/public/races/${raceId}/results/${publicResultId}');
    expect(detailComponent).toContain("refreshInFlight.current");
    expect(detailComponent).toContain("stopEventStream?.()");
  });
});
