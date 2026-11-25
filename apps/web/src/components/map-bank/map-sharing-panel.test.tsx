import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClubMapView, PublicMapListingDetail } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { MapSharingPanel } from "./map-sharing-panel";
import { MunicipalityPicker } from "./municipality-picker";

(globalThis as { React?: typeof React }).React = React;

const CLUB_MAP: ClubMapView = {
  mapId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Erstavik",
  versions: [],
  latestVersionId: null,
  trainings: 2,
  description: "Skogskarta i Nacka",
  maker: "Pelle Ritare",
  years: { from: 2024, to: 2025 },
  merges: [],
  ownership: "CLUB",
  ownerKind: null,
  ownerName: null,
  agreement: null,
  validUntil: null,
  contact: "kartor@ok.se",
  trainingOnly: false,
  feePerPrint: false,
  noPublicDisplay: false,
  sourceDownloadPolicy: "CUSTODIANS_ONLY",
  usageScope: "CLUB_ACTIVITIES_ONLY"
};

const PUBLISHED_LISTING: PublicMapListingDetail = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "Erstavik",
  description: "Skogskarta i Nacka",
  clubName: "Nacka OK",
  maker: "Pelle Ritare",
  format: "OMAP",
  accessMode: "USE_IN_OTID_LOCKED",
  showPreview: false,
  hasPreview: true,
  scale: 10000,
  norm: "ISOM",
  mapYear: 2025,
  licenseNote: "Endast träning",
  contact: "kartor@ok.se",
  municipalityCodes: ["0182"],
  countyCodes: ["01"],
  minLon: 18.2,
  maxLon: 18.25,
  minLat: 59.25,
  maxLat: 59.28,
  footprint: null,
  publishedAt: "2026-01-12T10:00:00Z",
  updatedAt: "2026-01-12T10:00:00Z",
  clubId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  clubMapId: CLUB_MAP.mapId,
  clubMapVersionId: null,
  mapProjectId: null,
  canDownload: false,
  canUseInOtid: true
};

describe("MapSharingPanel", () => {
  it("renderar klubbskydd (nedladdningsspärr + användningsbegränsning) och publik kartbank med avlysningsvarning", () => {
    const html = renderToStaticMarkup(
      <MapSharingPanel
        kind="club-map"
        clubId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        map={CLUB_MAP}
        initialCatalog={{ formatVersion: 1, listing: PUBLISHED_LISTING, suggested: {} }}
      />
    );
    expect(html).toContain('data-testid="club-map-protection-form"');
    expect(html).toContain("Spärra nedladdning – endast kartansvariga/klubbadmin");
    expect(html).toContain("Endast klubbaktiviteter");
    expect(html).toContain('data-testid="preview-embargo-note"');
    expect(html).toContain("avlyst");
    expect(html).toContain("Nacka");
    expect(html).toContain("Avpublicera från kartbanken");
    expect(html).toContain('href="/kartbank"');
  });

  it("renderar kartprojekt utan klubbskyddsformulär och på engelska under LanguageProvider", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapSharingPanel
          kind="map-project"
          projectId="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
          projectName="Kungshatt"
          initialCatalog={{ formatVersion: 1, listing: null, suggested: { title: "Kungshatt", municipalityCodes: ["0180"] } }}
        />
      </LanguageProvider>
    );
    expect(html).not.toContain('data-testid="club-map-protection-form"');
    expect(html).toContain('data-testid="public-catalog-form-section"');
    expect(html).toContain("Publish in public map bank (/kartbank)");
  });
});

describe("MunicipalityPicker", () => {
  it("visar valda kommuner som brickor med tillgängliga borttagningsknappar", () => {
    const html = renderToStaticMarkup(
      <MunicipalityPicker value={["0180", "1480"]} onChange={() => undefined} />
    );
    expect(html).toContain("Stockholm");
    expect(html).toContain("Göteborg");
    expect(html).toContain('aria-label="Ta bort Stockholm"');
    expect(html).toContain('aria-label="Ta bort Göteborg"');
  });
});
