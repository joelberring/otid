import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClubMapView, PublicMapListingDetail } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { ClubMapsPanel } from "./club-maps-panel";
import { MapRightsEditor } from "./map-rights-editor";
import type { useArchiveChecks } from "./use-archive-checks";

(globalThis as { React?: typeof React }).React = React;

const CLUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MAP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function makeMap(overrides: Partial<ClubMapView> = {}): ClubMapView {
  return {
    mapId: MAP_ID,
    name: "Erstavik",
    versions: [{
      versionId: VERSION_ID,
      mapId: MAP_ID,
      fileName: "erstavik-2026.omap",
      format: "OMAP",
      byteLength: 1_200_000,
      versionDate: "2026-04-01",
      note: null,
      uploadedAt: "2026-04-01T10:00:00Z",
      sourcePath: null,
      contentSha256: "a".repeat(64),
      trainings: 2,
      uploadedBy: "Karin",
      check: null,
      year: 2026,
      yearSource: "DATE",
      maker: "Pelle Ritare"
    }],
    latestVersionId: VERSION_ID,
    trainings: 2,
    description: "Skogskarta i Nacka",
    maker: "Pelle Ritare",
    years: { from: 2025, to: 2026 },
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
    usageScope: "CLUB_ACTIVITIES_ONLY",
    publishedInCatalog: true,
    publicListingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    publicListingAccessMode: "USE_IN_OTID_LOCKED",
    ...overrides
  };
}

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
  mapYear: 2026,
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
  clubId: CLUB_ID,
  clubMapId: MAP_ID,
  clubMapVersionId: VERSION_ID,
  mapProjectId: null,
  canDownload: false,
  canUseInOtid: true
};

const IDLE_CHECKS = {
  state: { running: false, forced: false, done: 0, total: 0, label: "" },
  recheckAll: vi.fn(),
  stop: vi.fn()
} as unknown as ReturnType<typeof useArchiveChecks>;

describe("ClubMapsPanel & MapRightsEditor", () => {
  it("visar statusbrickor och enad knapp direkt på kartkortet utan hopfälld delnings-<details> för admin", () => {
    const html = renderToStaticMarkup(
      <ClubMapsPanel
        clubId={CLUB_ID}
        maps={[makeMap(), makeMap({ mapId: "22222222-2222-4222-8222-222222222222", name: "Nackareservatet", sourceDownloadPolicy: "ALLOWED", usageScope: "ANY", publishedInCatalog: false, publicListingId: null })]}
        admin
        mapBank
        onChanged={async () => undefined}
        checks={IDLE_CHECKS}
      />
    );
    expect(html).toContain('data-testid="map-rights-toggle"');
    expect(html).toContain("Rättigheter, skydd &amp; delning");
    expect(html).toContain('data-testid="badge-download-locked"');
    expect(html).toContain("Nedladdningsspärrad");
    expect(html).toContain('data-testid="badge-usage-club"');
    expect(html).toContain("Endast klubbaktiviteter");
    expect(html).toContain('data-testid="badge-catalog-published"');
    expect(html).toContain("Publicerad i Kartbanken");
    expect(html).toContain('data-testid="badge-catalog-unpublished"');
    expect(html).toContain("Ej publicerad");
    expect(html).not.toContain("<summary>Delning &amp; skydd</summary>");
    expect(html).toContain(`/api/organizer/clubs/${CLUB_ID}/map-versions/${VERSION_ID}`);
  });

  it("visar skrivskyddade statusbrickor, spärrförklaring och döljer källfilslänk för icke-admin när kartan är spärrad", () => {
    const html = renderToStaticMarkup(
      <ClubMapsPanel
        clubId={CLUB_ID}
        maps={[makeMap({ sourceDownloadPolicy: "CUSTODIANS_ONLY", usageScope: "ADMIN_ONLY", publishedInCatalog: true })]}
        admin={false}
        mapBank
        onChanged={async () => undefined}
        checks={IDLE_CHECKS}
      />
    );
    expect(html).not.toContain('data-testid="map-rights-toggle"');
    expect(html).toContain('data-testid="badge-download-locked"');
    expect(html).toContain('data-testid="badge-usage-admin"');
    expect(html).toContain("Endast klubbadmin");
    expect(html).toContain('data-testid="badge-catalog-published"');
    expect(html).toContain('data-testid="club-map-download-locked-note"');
    expect(html).toContain('data-testid="club-map-download-locked"');
    expect(html).not.toContain(`/map-versions/${VERSION_ID}" download`);
  });

  it("visar alla tre block i ett sammanhängande flöde när MapRightsEditor är öppen (sv + en)", () => {
    const svHtml = renderToStaticMarkup(
      <MapRightsEditor
        clubId={CLUB_ID}
        map={makeMap()}
        onSaved={() => undefined}
        defaultOpen
        initialCatalog={{ formatVersion: 1, listing: PUBLISHED_LISTING, suggested: {} }}
      />
    );
    expect(svHtml).toContain('data-testid="map-rights-panel"');
    expect(svHtml).toContain('data-testid="club-map-protection-section"');
    expect(svHtml).toContain("1. Vem får ladda ner &amp; använda kartfilen");
    expect(svHtml).toContain('data-testid="club-map-agreement-section"');
    expect(svHtml).toContain("2. Ägare &amp; avtal");
    expect(svHtml).toContain('data-testid="public-catalog-form-section"');
    expect(svHtml).toContain("3. Publik kartbank (/kartbank)");
    // Ingen duplicerad skyddssektion inne i inbäddad MapSharingPanel.
    expect(svHtml).not.toContain('data-testid="club-map-protection-form"');

    const enHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <MapRightsEditor
          clubId={CLUB_ID}
          map={makeMap()}
          onSaved={() => undefined}
          defaultOpen
          initialCatalog={{ formatVersion: 1, listing: PUBLISHED_LISTING, suggested: {} }}
        />
      </LanguageProvider>
    );
    expect(enHtml).toContain("Rights, protection &amp; sharing");
    expect(enHtml).toContain("1. Who can download &amp; use the map file");
    expect(enHtml).toContain("2. Owner &amp; agreement");
    expect(enHtml).toContain("3. Public map bank (/kartbank)");
  });
});
