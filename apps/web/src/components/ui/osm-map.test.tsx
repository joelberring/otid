import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../language-provider";
import { OsmCatalogMap, type OsmMapFeature } from "./osm-map";

(globalThis as { React?: typeof React }).React = React;

const FEATURES: OsmMapFeature[] = [
  {
    id: "map-open",
    title: "Nackareservatet",
    minLon: 18.14,
    minLat: 59.28,
    maxLon: 18.18,
    maxLat: 59.30,
    footprint: [[18.14, 59.28], [18.18, 59.28], [18.18, 59.30], [18.14, 59.30]],
    tone: "open"
  },
  {
    id: "map-otid",
    title: "Hellasgården",
    minLon: 18.15,
    minLat: 59.29,
    maxLon: 18.17,
    maxLat: 59.305,
    tone: "otid"
  },
  {
    id: "map-info",
    title: "Skrylle",
    minLon: 13.34,
    minLat: 55.68,
    maxLon: 13.38,
    maxLat: 55.70,
    tone: "info"
  }
];

describe("OsmCatalogMap", () => {
  it("ritar OSM-rutor med referrerPolicy, attribution, zoomkontroller och kluster/markörer på landsnivå", () => {
    const html = renderToStaticMarkup(<OsmCatalogMap features={FEATURES} selectedId="map-open" />);
    expect(html).toContain('data-testid="osm-catalog-map"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain("© OpenStreetMap");
    expect(html).toContain('aria-label="Zooma in"');
    expect(html).toContain('aria-label="Zooma ut"');
    expect(html).toContain(">Hela Sverige</button>");
    // Två kartor i Nacka klustras (2), Skrylle visas som egen markör.
    expect(html).toContain('data-cluster-count="2"');
    expect(html).toContain('data-feature-id="map-info"');
    expect(html).toContain('data-tone="info"');
  });

  it("ritar klickbara och tangentbordsfokuserbara polygoner och rektanglar vid inzoomad vy", () => {
    const html = renderToStaticMarkup(
      <OsmCatalogMap
        features={FEATURES}
        selectedId="map-open"
        initialBounds={{ minLon: 18.12, minLat: 59.27, maxLon: 18.20, maxLat: 59.31 }}
      />
    );
    expect(html).toContain("<polygon");
    expect(html).toContain("<rect");
    expect(html).toContain('data-feature-id="map-open"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain("Nackareservatet (Öppen nedladdning)");
    expect(html).toContain("Hellasgården (Använd i O-Tid)");
  });

  it("byter kontroller och etiketter till engelska under LanguageProvider", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider language="en">
        <OsmCatalogMap features={FEATURES} />
      </LanguageProvider>
    );
    expect(html).toContain('aria-label="Map of orienteering maps"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain(">All of Sweden</button>");
    expect(html).toContain("2 maps in this area – zoom in");
  });
});
