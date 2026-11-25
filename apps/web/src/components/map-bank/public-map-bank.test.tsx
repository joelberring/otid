import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicMapListingDetail, PublicMapListingSummary } from "@o-tid/contracts";
import { LanguageProvider } from "../language-provider";
import { PublicMapBank } from "./public-map-bank";
import { PublicMapBankDetail } from "./public-map-bank-detail";

(globalThis as { React?: typeof React }).React = React;

const BASE_SUMMARY: PublicMapListingSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Nackareservatet",
  clubName: "OK Södertörn",
  maker: "Anna Ritare",
  format: "OMAP",
  accessMode: "OPEN_DOWNLOAD",
  showPreview: true,
  hasPreview: true,
  scale: 10000,
  norm: "ISOM",
  mapYear: 2025,
  municipalityCodes: ["0182"],
  countyCodes: ["01"],
  minLon: 18.14,
  maxLon: 18.18,
  minLat: 59.28,
  maxLat: 59.30,
  footprint: null,
  publishedAt: "2026-01-10T10:00:00Z",
  updatedAt: "2026-01-10T10:00:00Z"
};

const LOCKED_SUMMARY: PublicMapListingSummary = {
  ...BASE_SUMMARY,
  id: "22222222-2222-4222-8222-222222222222",
  title: "Hellasgården",
  accessMode: "USE_IN_OTID_LOCKED",
  showPreview: false,
  scale: 7500,
  norm: "ISSprOM"
};

const INFO_SUMMARY: PublicMapListingSummary = {
  ...BASE_SUMMARY,
  id: "33333333-3333-4333-8333-333333333333",
  title: "Skrylle",
  clubName: "Lunds OK",
  accessMode: "INFO_ONLY",
  showPreview: false,
  hasPreview: false,
  municipalityCodes: ["1281"],
  countyCodes: ["12"]
};

function makeDetail(summary: PublicMapListingSummary): PublicMapListingDetail {
  return {
    ...summary,
    description: "Kuprerad skogsterräng med tydliga stigar.",
    licenseNote: "Fri för klubbträning.",
    contact: "kartor@exempel.se",
    clubId: null,
    clubMapId: null,
    clubMapVersionId: null,
    mapProjectId: null,
    canDownload: summary.accessMode === "OPEN_DOWNLOAD",
    canUseInOtid: summary.accessMode === "OPEN_DOWNLOAD" || summary.accessMode === "USE_IN_OTID_LOCKED"
  };
}

describe("PublicMapBank", () => {
  it("renderar delad vy med OsmCatalogMap, filter, kommunnamn, skala och tillgänglighetsbrickor på svenska", () => {
    const html = renderToStaticMarkup(
      <PublicMapBank
        initialItems={[BASE_SUMMARY, LOCKED_SUMMARY, INFO_SUMMARY]}
        initialTotal={3}
        initialMunicipalityCounts={{ "0182": 2, "1281": 1 }}
      />
    );
    expect(html).toContain('data-testid="public-map-bank"');
    expect(html).toContain('data-testid="osm-catalog-map"');
    expect(html).toContain("Publik kartbank");
    expect(html).toContain("Nackareservatet");
    expect(html).toContain("Hellasgården");
    expect(html).toContain("Skrylle");
    expect(html).toContain("Nacka");
    expect(html).toContain("Lund");
    expect(html).toContain("1:10\u00A0000");
    expect(html).toContain("Öppen nedladdning");
    expect(html).toContain("Använd i O-Tid");
    expect(html).toContain("Endast kontaktinfo");
    expect(html).toContain("Lista (3)");
  });

  it("byter till engelska under LanguageProvider", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider language="en">
        <PublicMapBank initialItems={[BASE_SUMMARY]} initialTotal={1} />
      </LanguageProvider>
    );
    expect(html).toContain("Public map bank");
    expect(html).toContain("Open download");
    expect(html).toContain("Forest (ISOM)");
  });
});

describe("PublicMapBankDetail", () => {
  it("visar förhandsvisning, Använd i ny träning och nedladdningslänk för OPEN_DOWNLOAD när showPreview är sant", () => {
    const detail = makeDetail(BASE_SUMMARY);
    const html = renderToStaticMarkup(<PublicMapBankDetail listing={detail} loading={false} onClose={() => undefined} />);
    expect(html).toContain('data-testid="map-bank-preview"');
    expect(html).toContain(`/api/public/map-bank/${detail.id}/preview`);
    expect(html).toContain('data-testid="map-bank-use-button"');
    expect(html).toContain("Använd i ny träning");
    expect(html).toContain('data-testid="map-bank-download-link"');
    expect(html).toContain(`/api/public/map-bank/${detail.id}/download`);
    expect(html).toContain("Ladda ned kartfil (.omap)");
  });

  it("döljer förhandsvisning när showPreview är falskt och döljer nedladdning för USE_IN_OTID_LOCKED", () => {
    const detail = makeDetail(LOCKED_SUMMARY);
    const html = renderToStaticMarkup(<PublicMapBankDetail listing={detail} loading={false} onClose={() => undefined} />);
    expect(html).not.toContain('data-testid="map-bank-preview"');
    expect(html).not.toContain("/preview");
    expect(html).toContain('data-testid="map-bank-use-button"');
    expect(html).not.toContain('data-testid="map-bank-download-link"');
  });

  it("visar kontakt- och tillståndsruta utan åtgärdsknappar för INFO_ONLY", () => {
    const detail = makeDetail(INFO_SUMMARY);
    const html = renderToStaticMarkup(<PublicMapBankDetail listing={detail} loading={false} onClose={() => undefined} />);
    expect(html).toContain('data-testid="map-bank-info-only"');
    expect(html).toContain("Kontakta kartägaren för tillstånd");
    expect(html).toContain("kartor@exempel.se");
    expect(html).not.toContain('data-testid="map-bank-use-button"');
    expect(html).not.toContain('data-testid="map-bank-download-link"');
  });
});
