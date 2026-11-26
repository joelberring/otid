import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MapConversionReportView, MapProjectView } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { decodeConversionReportHeader } from "./map-project-convert-export";
import { MapProjectPage } from "./map-project-page";

(globalThis as { React?: typeof React }).React = React;

const PROJECT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTPUT_ID = "99999999-9999-4999-8999-999999999999";

function makeProject(overrides: Partial<MapProjectView> = {}): MapProjectView {
  return {
    formatVersion: 1,
    projectId: PROJECT_ID,
    name: "Kungshatt revidering",
    status: "OPEN",
    role: "OWNER",
    club: { clubId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Mälarö OK" },
    base: {
      source: "ARCHIVE",
      versionId: "11111111-1111-4111-8111-111111111111",
      mapId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      mapName: "Kungshatt",
      fileName: "kungshatt.omap",
      format: "OMAP",
      versionDate: "2026-03-01",
      sha256: "c".repeat(64)
    },
    createdAt: "2026-03-10T10:00:00Z",
    closedAt: null,
    lastActiveAt: "2026-04-01T10:00:00Z",
    changedObjects: 12,
    outputs: [{
      outputId: OUTPUT_ID,
      versionId: null,
      fileName: "kungshatt-v2.omap",
      changes: 12,
      createdAt: "2026-04-01T10:00:00Z"
    }],
    sourceDownloadPolicy: "ALLOWED",
    sourceDownloadLockedByArchive: false,
    effectiveSourceDownloadPolicy: "ALLOWED",
    publishedInCatalog: false,
    publicListingId: null,
    publicListingAccessMode: null,
    viewer: {
      accountId: "55555555-5555-4555-8555-555555555555",
      canEdit: true,
      canManage: true,
      canWriteVersion: true,
      canArchive: true,
      canPropose: true,
      canDecide: true,
      canDownloadSource: true
    },
    mode: "SHARED",
    area: null,
    recon: null,
    leaderboard: null,
    colors: [],
    symbolColors: [],
    textSymbols: [],
    normSymbols: { replace: [], add: [] },
    aiMode: "PROPOSE",
    areas: [],
    openProposals: 0,
    storage: { mapFileBytes: 1_500_000, totalBytes: 2_000_000 },
    readerVersion: 1,
    seq: 12,
    members: [{
      accountId: "55555555-5555-4555-8555-555555555555",
      name: "Stina",
      role: "OWNER",
      lastSeenAt: null,
      edits: 12
    }],
    invitations: [],
    joinLinks: [],
    ...overrides
  };
}

describe("MapProjectPage (Delning & skydd och nedladdningsspärr)", () => {
  it("lyfter upp synlig Delning & skydd-sektion direkt efter Exportera med lokal spärrväxlare och Kartbanken", () => {
    const html = renderToStaticMarkup(
      <MapProjectPage
        projectId={PROJECT_ID}
        initialView={makeProject()}
        initialCatalog={{ formatVersion: 1, listing: null, suggested: { title: "Kungshatt" } }}
      />
    );
    expect(html).toContain('data-testid="map-project-sharing-section"');
    expect(html).toContain('<h2 id="map-project-sharing">Delning &amp; skydd</h2>');
    expect(html).not.toContain('<summary id="map-project-sharing">');
    expect(html.indexOf('id="exportera"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="delning-skydd"')).toBeGreaterThan(html.indexOf('id="exportera"'));
    expect(html.indexOf('id="map-project-members"')).toBeGreaterThan(html.indexOf('id="delning-skydd"'));
    expect(html).toContain('data-testid="map-project-protection-form"');
    expect(html).toContain('data-testid="map-project-download-policy-select"');
    expect(html).toContain('data-testid="public-catalog-form-section"');
    expect(html).toContain(`/api/organizer/map-projects/${PROJECT_ID}/source`);
    expect(html).toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=omap`);
    expect(html).toContain(`/api/organizer/map-projects/${PROJECT_ID}/outputs/${OUTPUT_ID}`);
  });

  it("visar tydlig ärvd-arkivspärr-förklaring och inaktiverar växlaren när spärren kommer från klubbarkivet", () => {
    const html = renderToStaticMarkup(
      <MapProjectPage
        projectId={PROJECT_ID}
        initialView={makeProject({
          sourceDownloadPolicy: "ALLOWED",
          sourceDownloadLockedByArchive: true,
          effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
          publishedInCatalog: true
        })}
        initialCatalog={{ formatVersion: 1, listing: null, suggested: { title: "Kungshatt" } }}
      />
    );
    expect(html).toContain('data-testid="map-project-download-locked-badge"');
    expect(html).toContain('data-testid="map-project-catalog-published"');
    expect(html).toContain('data-testid="map-project-archive-lock-note"');
    expect(html).toContain("ärvd från grundkartan i klubbarkivet");
    expect(html).toMatch(/disabled=""[^>]*data-testid="map-project-download-policy-select"|data-testid="map-project-download-policy-select"[^>]*disabled=""/);
  });

  it("döljer råa nedladdningsknappar och vektorredigerarlänk men behåller GeoJSON-export när !viewer.canDownloadSource", () => {
    const html = renderToStaticMarkup(
      <MapProjectPage
        projectId={PROJECT_ID}
        initialView={makeProject({
          role: "EDIT",
          sourceDownloadPolicy: "CUSTODIANS_ONLY",
          effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
          viewer: {
            accountId: "66666666-6666-4666-8666-666666666666",
            canEdit: true,
            canManage: false,
            canWriteVersion: false,
            canArchive: false,
            canPropose: true,
            canDecide: false,
            canDownloadSource: false
          }
        })}
      />
    );
    expect(html).toContain('data-testid="map-project-download-locked-badge"');
    expect(html).toContain('data-testid="map-project-source-locked-notice"');
    expect(html).toContain('data-testid="map-project-export-locked-note"');
    expect(html).toContain('data-testid="map-project-output-locked"');
    expect(html).toContain('data-testid="map-project-protection-readonly"');
    expect(html).not.toContain(`/api/organizer/map-projects/${PROJECT_ID}/source`);
    expect(html).not.toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=omap`);
    expect(html).not.toContain(`/api/organizer/map-projects/${PROJECT_ID}/outputs/${OUTPUT_ID}`);
    expect(html).not.toContain('data-testid="map-project-open-map"');
    expect(html).toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=geojson`);
  });

  it("renderar engelska texter korrekt under LanguageProvider", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage
          projectId={PROJECT_ID}
          initialView={makeProject({
            sourceDownloadPolicy: "CUSTODIANS_ONLY",
            effectiveSourceDownloadPolicy: "CUSTODIANS_ONLY",
            viewer: {
              accountId: "66666666-6666-4666-8666-666666666666",
              canEdit: false,
              canManage: false,
              canWriteVersion: false,
              canArchive: false,
              canPropose: false,
              canDecide: false,
              canDownloadSource: false
            }
          })}
        />
      </LanguageProvider>
    );
    expect(html).toContain("Sharing &amp; protection");
    expect(html).toContain("Download locked");
    expect(html).toContain("GeoJSON change export still works");
  });
});

describe("MapProjectPage (Etapp 3B: OCAD Skapa ny kartversion upplåst via viewer.canWriteVersion)", () => {
  function makeOcdProject(viewerOverrides: Partial<MapProjectView["viewer"]> = {}): MapProjectView {
    const base = makeProject();
    return {
      ...base,
      name: "Högdalen revidering",
      base: {
        ...base.base,
        mapName: "Högdalen",
        fileName: "hogdalen.ocd",
        format: "OCD"
      },
      viewer: {
        ...base.viewer,
        ...viewerOverrides
      }
    };
  }

  it("låser upp knappen Skapa ny kartversion och döljer OCAD-spärrtexter när viewer.canWriteVersion är true", () => {
    const html = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: true, canWriteVersion: true, canArchive: true })} />
    );
    expect(html).toMatch(/<button(?![^>]*\bdisabled\b)[^>]*>Skapa ny kartversion<\/button>/);
    expect(html).toContain("Lägg också den nya versionen i klubbarkivet");
    expect(html).not.toContain('data-testid="map-project-ocad-note"');
    expect(html).not.toContain('data-testid="map-project-ocad-version-disabled"');
  });

  it("inaktiverar Skapa ny kartversion med tydlig förklaring för OCAD-ägare när viewer.canWriteVersion är false", () => {
    const html = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: true, canWriteVersion: false, canArchive: true })} />
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Skapa ny kartversion<\/button>/);
    expect(html).toContain('data-testid="map-project-ocad-note"');
    expect(html).toContain('data-testid="map-project-ocad-version-disabled"');
    expect(html).toContain("avstängt i serverns inställningar");
    expect(html).not.toContain("Bara projektets ägare skapar nya kartversioner.");
  });

  it("visar ägarbesked (inte knappen) för icke-ägare i OCAD-projekt samt engelsk text för inaktiverad OCAD-skrivning", () => {
    const nonOwnerHtml = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: false, canWriteVersion: false, canArchive: false })} />
    );
    expect(nonOwnerHtml).toContain("Bara projektets ägare skapar nya kartversioner.");
    expect(nonOwnerHtml).not.toContain(">Skapa ny kartversion</button>");
    expect(nonOwnerHtml).toContain('data-testid="map-project-ocad-note"');

    const enLockedHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: true, canWriteVersion: false, canArchive: false })} />
      </LanguageProvider>
    );
    expect(enLockedHtml).toMatch(/<button[^>]*disabled=""[^>]*>Create new map version<\/button>/);
    expect(enLockedHtml).toContain("Creating a new OCAD version is turned off in the server settings.");
    expect(enLockedHtml).toContain("Creating a new OCAD version requires owner permission and OCAD writing enabled in the server settings");

    const enUnlockedHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: true, canWriteVersion: true, canArchive: false })} />
      </LanguageProvider>
    );
    expect(enUnlockedHtml).toMatch(/<button(?![^>]*\bdisabled\b)[^>]*>Create new map version<\/button>/);
    expect(enUnlockedHtml).not.toContain('data-testid="map-project-ocad-note"');
    expect(enUnlockedHtml).not.toContain('data-testid="map-project-ocad-version-disabled"');
  });

  it("visar Exportera ändringar (.ocd) för OCAD-projekt när canDownloadSource är true och döljer den med låsnotis när false (sv + en)", () => {
    const allowedSv = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canDownloadSource: true })} />
    );
    expect(allowedSv).toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=ocd`);
    expect(allowedSv).toContain("Exportera ändringar (.ocd)");
    expect(allowedSv).not.toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=omap`);
    expect(allowedSv).toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=geojson`);
    expect(allowedSv).not.toContain('data-testid="map-project-export-locked-note"');

    const lockedSv = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: false, canWriteVersion: false, canDownloadSource: false })} />
    );
    expect(lockedSv).not.toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=ocd`);
    expect(lockedSv).toContain('data-testid="map-project-export-locked-note"');
    expect(lockedSv).toContain("OCAD-export av ändringarna är spärrad");
    expect(lockedSv).toContain(`/api/organizer/map-projects/${PROJECT_ID}/export?format=geojson`);

    const allowedEn = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canDownloadSource: true })} />
      </LanguageProvider>
    );
    expect(allowedEn).toContain("Export changes (.ocd)");

    const lockedEn = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: false, canWriteVersion: false, canDownloadSource: false })} />
      </LanguageProvider>
    );
    expect(lockedEn).toContain("OCAD change export is locked");
  });

  it("Etapp 5B: visar fullkarta-konvertering (.omap <-> .ocd) bara när canDownloadSource är true samt visar formatgapsvarningar (sv + en)", () => {
    const omapAllowed = renderToStaticMarkup(<MapProjectPage projectId={PROJECT_ID} initialView={makeProject()} />);
    expect(omapAllowed).toContain('data-testid="map-project-export-ocd-full"');
    expect(omapAllowed).toContain("Exportera som OCAD (.ocd)");
    expect(omapAllowed).not.toContain('data-testid="map-project-export-omap-full"');

    const ocdAllowed = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canDownloadSource: true })} />
    );
    expect(ocdAllowed).toContain('data-testid="map-project-export-omap-full"');
    expect(ocdAllowed).toContain("Exportera som Mapper (.omap)");
    expect(ocdAllowed).not.toContain('data-testid="map-project-export-ocd-full"');

    // Säkerhetsspärr: döljs helt när !canDownloadSource på både OMAP och OCD.
    const omapLocked = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeProject({
        viewer: { ...makeProject().viewer, canManage: false, canWriteVersion: false, canDownloadSource: false }
      })} />
    );
    expect(omapLocked).not.toContain('data-testid="map-project-export-ocd-full"');

    const ocdLocked = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeOcdProject({ canManage: false, canWriteVersion: false, canDownloadSource: false })} />
    );
    expect(ocdLocked).not.toContain('data-testid="map-project-export-omap-full"');

    // Formatgapsrapport renderas tydligt på både svenska och engelska.
    const reportWithWarnings: MapConversionReportView = {
      formatVersion: 1,
      sourceFormat: "OMAP",
      targetFormat: "OCD",
      fileName: "kungshatt.ocd",
      colors: 19,
      symbols: 110,
      objects: 420,
      skippedObjects: 0,
      warnings: [
        { code: "PRECISION_ROUNDED", count: 15, message: "15 objekt avrundades." },
        { code: "COMBINED_SPLIT", count: 2, message: "2 sammansatta symboler delades." }
      ]
    };
    const warningsSv = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeProject()} initialConversionReport={reportWithWarnings} />
    );
    expect(warningsSv).toContain('data-testid="map-project-conversion-warnings"');
    expect(warningsSv).toContain("kungshatt.ocd exporterad (420 objekt) med 2 formatnoteringar:");
    expect(warningsSv).toContain("15 objekt avrundades från 0,001 mm till OCAD:s 0,01 mm-upplösning.");

    const warningsEn = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapProjectPage projectId={PROJECT_ID} initialView={makeProject()} initialConversionReport={reportWithWarnings} />
      </LanguageProvider>
    );
    expect(warningsEn).toContain("Export as OCAD (.ocd)");
    expect(warningsEn).toContain("kungshatt.ocd exported (420 objects) with 2 format notes:");
    expect(warningsEn).toContain("15 objects were rounded from 0.001 mm to OCAD&#x27;s 0.01 mm precision.");

    const cleanReport: MapConversionReportView = { ...reportWithWarnings, warnings: [] };
    const cleanHtml = renderToStaticMarkup(
      <MapProjectPage projectId={PROJECT_ID} initialView={makeProject()} initialConversionReport={cleanReport} />
    );
    expect(cleanHtml).toContain('data-testid="map-project-conversion-ok"');

    // decodeConversionReportHeader avkodar UTF-8 base64-header (inkl. åäö) säkert.
    const header = Buffer.from(JSON.stringify({ ...reportWithWarnings, fileName: "Älvsjö.ocd" }), "utf8").toString("base64");
    expect(decodeConversionReportHeader(header)).toMatchObject({ fileName: "Älvsjö.ocd", objects: 420 });
    expect(decodeConversionReportHeader("not-valid-base64!!!")).toBeUndefined();
    expect(decodeConversionReportHeader(null)).toBeUndefined();
  });
});
