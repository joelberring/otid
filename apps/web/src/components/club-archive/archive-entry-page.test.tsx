import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClubArchiveEntryView, ClubMapView } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { ArchiveEntryPage } from "./archive-entry-page";

(globalThis as { React?: typeof React }).React = React;

const CLUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ENTRY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
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
      byteLength: 850_000,
      versionDate: "2026-04-01",
      note: null,
      uploadedAt: "2026-04-01T10:00:00Z",
      sourcePath: null,
      contentSha256: "b".repeat(64),
      trainings: 1,
      uploadedBy: "Karin",
      check: null,
      year: 2026,
      yearSource: "DATE",
      maker: null
    }],
    latestVersionId: VERSION_ID,
    trainings: 1,
    description: null,
    maker: null,
    years: { from: 2026, to: 2026 },
    merges: [],
    ownership: "CLUB",
    ownerKind: null,
    ownerName: null,
    agreement: null,
    validUntil: null,
    contact: null,
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

function makeView(overrides: {
  role?: ClubArchiveEntryView["viewer"]["role"];
  mapBank?: boolean;
  map?: Partial<ClubMapView>;
} = {}): ClubArchiveEntryView {
  return {
    formatVersion: 1,
    clubId: CLUB_ID,
    clubName: "Nacka OK",
    viewer: {
      role: overrides.role ?? "LEADER",
      access: { archive: true, mapBank: overrides.mapBank ?? true }
    },
    sourceRace: null,
    entry: {
      entryId: ENTRY_ID,
      trainingDate: "2026-04-05",
      year: 2026,
      place: "Erstavik",
      title: "Medelträning Erstavik",
      leader: "Karin",
      tags: [],
      moments: [],
      levels: [],
      courseNames: ["Gul"],
      courseFiles: 0,
      maps: [{ mapId: MAP_ID, name: "Erstavik" }],
      status: "MAP_ONLY",
      thumbnail: null,
      thumbnailSource: null,
      added: { name: "Karin", at: "2026-04-05T10:00:00Z", via: "ARCHIVE" },
      notes: null,
      sourcePath: null
    },
    courseFiles: [],
    maps: [makeMap(overrides.map)],
    folderVersionIds: [VERSION_ID],
    groups: [],
    organisationId: null
  };
}

describe("ArchiveEntryPage (karträttigheter & nedladdningsspärr)", () => {
  it("döljer trasig 403-nedladdningslänk och visar tydlig notis + statusbrickor när downloadLocked && !admin", () => {
    const html = renderToStaticMarkup(
      <ArchiveEntryPage clubId={CLUB_ID} entryId={ENTRY_ID} initialView={makeView({ role: "LEADER", mapBank: true })} />
    );
    expect(html).toContain('data-testid="archive-map-rights"');
    expect(html).toContain('data-testid="badge-download-locked"');
    expect(html).toContain('data-testid="badge-usage-club"');
    expect(html).toContain('data-testid="badge-catalog-published"');
    expect(html).toContain('data-testid="archive-map-download-locked-notice"');
    expect(html).toContain("kan fortfarande användas i O-Tid");
    expect(html).toContain('data-testid="archive-map-version-download-locked"');
    expect(html).toContain("<span>erstavik-2026.omap</span>");
    expect(html).not.toContain(`/map-versions/${VERSION_ID}`);
    expect(html).not.toContain('data-testid="map-rights-toggle"');
  });

  it("visar nedladdningslänk och enad rättighetspanel för klubbadmin även när kartan är nedladdningsspärrad", () => {
    const html = renderToStaticMarkup(
      <ArchiveEntryPage clubId={CLUB_ID} entryId={ENTRY_ID} initialView={makeView({ role: "ADMIN", mapBank: true })} />
    );
    expect(html).toContain(`href="/api/organizer/clubs/${CLUB_ID}/map-versions/${VERSION_ID}" download=""`);
    expect(html).toContain('data-testid="map-rights-toggle"');
    expect(html).toContain("Rättigheter, skydd &amp; delning");
    expect(html).not.toContain('data-testid="archive-map-download-locked-notice"');
  });

  it("visar nedladdningslänk och Ej publicerad-badge för icke-admin när kartan inte är spärrad (sv + en)", () => {
    const svHtml = renderToStaticMarkup(
      <ArchiveEntryPage
        clubId={CLUB_ID}
        entryId={ENTRY_ID}
        initialView={makeView({
          role: "READER",
          mapBank: true,
          map: { sourceDownloadPolicy: "ALLOWED", usageScope: "ANY", publishedInCatalog: false, publicListingId: null }
        })}
      />
    );
    expect(svHtml).toContain(`href="/api/organizer/clubs/${CLUB_ID}/map-versions/${VERSION_ID}" download=""`);
    expect(svHtml).toContain('data-testid="badge-catalog-unpublished"');
    expect(svHtml).toContain("Ej publicerad");
    expect(svHtml).not.toContain('data-testid="archive-map-download-locked-notice"');

    const enHtml = renderToStaticMarkup(
      <LanguageProvider language="en">
        <ArchiveEntryPage clubId={CLUB_ID} entryId={ENTRY_ID} initialView={makeView({ role: "LEADER", mapBank: true })} />
      </LanguageProvider>
    );
    expect(enHtml).toContain("Download locked");
    expect(enHtml).toContain("still be used in O-Tid");
    expect(enHtml).not.toContain(`/map-versions/${VERSION_ID}`);
  });
});
