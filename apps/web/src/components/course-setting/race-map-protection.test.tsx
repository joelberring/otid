import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRaceMapSource } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { MapFileSummary, MapFileUpload } from "../race-administrator/map-file-upload";
import { RaceMapProtectionPanel } from "./race-map-protection";
import { updateRaceMapDownloadLock } from "../../lib/course-setting-map-upload";

(globalThis as { React?: typeof React }).React = React;

const RACE_ID = "77777777-7777-4777-8777-777777777777";

function makeSource(overrides: Partial<AdminRaceMapSource> = {}): AdminRaceMapSource {
  return {
    fileName: "hogdalen.ocd",
    format: "OCD",
    version: "12.0",
    byteLength: 2_500_000,
    scale: 10000,
    crs: { kind: "EPSG", code: 3006 },
    georeferencedFromFile: true,
    summary: { objectCount: 1400, warnings: [], simplifications: [] },
    uploadedAt: "2026-04-01T10:00:00.000Z",
    sourceDownloadLocked: false,
    sourceDownloadLockedByOrigin: false,
    ...overrides
  };
}

describe("Tävlingskartans nedladdningsspärr (uppladdning & kartinställningar)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("visar tydlig spärrkryssruta vid manuell uppladdning av kartfil (sv + en)", () => {
    const svHtml = renderToStaticMarkup(
      <MapFileUpload disabled={false} hasMap={false} upload={async () => undefined} onMessage={() => undefined} />
    );
    expect(svHtml).toContain('data-testid="map-upload-lock-checkbox"');
    expect(svHtml).toContain("Spärra nedladdning av kartfil (.ocd/.omap) för övriga");

    const checkedHtml = renderToStaticMarkup(
      <MapFileUpload disabled={false} hasMap={false} defaultLockDownload upload={async () => undefined} onMessage={() => undefined} />
    );
    expect(checkedHtml).toMatch(/checked=""[^>]*data-testid="map-upload-lock-checkbox"|data-testid="map-upload-lock-checkbox"[^>]*checked=""/);

    const enHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapFileUpload disabled={false} hasMap={false} upload={async () => undefined} onMessage={() => undefined} />
      </LanguageProvider>
    );
    expect(enHtml).toContain("Lock map file download (.ocd/.omap) for others");
  });

  it("döljer källfilslänk i MapFileSummary när tävlingskartan är nedladdningsspärrad", () => {
    const lockedHtml = renderToStaticMarkup(
      <MapFileSummary source={makeSource({ sourceDownloadLocked: true })} downloadHref="/api/admin/races/r/administrator/map/source" />
    );
    expect(lockedHtml).toContain('data-testid="race-map-summary-locked"');
    expect(lockedHtml).toContain("Nedladdningsspärrad");
    expect(lockedHtml).not.toContain('href="/api/admin/races/r/administrator/map/source"');

    const openHtml = renderToStaticMarkup(
      <MapFileSummary source={makeSource({ sourceDownloadLocked: false })} downloadHref="/api/admin/races/r/administrator/map/source" />
    );
    expect(openHtml).toContain('href="/api/admin/races/r/administrator/map/source" download=""');
  });

  it("visar aktiv växlare för egen tävlingskarta och låst/disabled växlare med förklaring vid ärvd spärr", () => {
    const editableHtml = renderToStaticMarkup(
      <RaceMapProtectionPanel raceId={RACE_ID} locked={false} lockedByOrigin={false} admin />
    );
    expect(editableHtml).toContain('data-testid="race-map-lock-badge"');
    expect(editableHtml).toContain("Nedladdning tillåten");
    expect(editableHtml).toContain('data-testid="race-map-lock-toggle"');
    expect(editableHtml).not.toContain('data-testid="race-map-lock-origin-note"');
    expect(editableHtml).not.toMatch(/disabled=""[^>]*data-testid="race-map-lock-toggle"|data-testid="race-map-lock-toggle"[^>]*disabled=""/);

    const inheritedHtml = renderToStaticMarkup(
      <RaceMapProtectionPanel raceId={RACE_ID} locked lockedByOrigin admin />
    );
    expect(inheritedHtml).toContain("Nedladdningsspärrad");
    expect(inheritedHtml).toContain('data-testid="race-map-lock-origin-note"');
    expect(inheritedHtml).toContain("ärvd från klubbarkivet, kartprojektet eller publika kartbanken");
    expect(inheritedHtml).toMatch(/disabled=""[^>]*data-testid="race-map-lock-toggle"|data-testid="race-map-lock-toggle"[^>]*disabled=""/);

    const nonAdminHtml = renderToStaticMarkup(
      <RaceMapProtectionPanel raceId={RACE_ID} locked lockedByOrigin={false} admin={false} />
    );
    expect(nonAdminHtml).toContain('data-testid="race-map-lock-readonly"');
    expect(nonAdminHtml).not.toContain('data-testid="race-map-lock-toggle"');
  });

  it("skickar PATCH till /administrator/map/source vid växling av nedladdningsspärr", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      formatVersion: 1,
      sourceDownloadLocked: true,
      sourceDownloadLockedByOrigin: false
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const csrf = "c".repeat(43);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: `otid_organizer_csrf=${csrf}` });
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1:3000/admin/race/course-setting" } });

    const result = await updateRaceMapDownloadLock(RACE_ID, true);
    expect(result).toEqual({ ok: true, sourceDownloadLocked: true, sourceDownloadLockedByOrigin: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/races/${RACE_ID}/administrator/map/source`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ formatVersion: 1, sourceDownloadLocked: true });
    expect((init.headers as Record<string, string>)["x-otid-csrf"]).toBe(csrf);
  });
});
