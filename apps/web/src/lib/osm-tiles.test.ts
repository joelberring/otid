import { afterEach, describe, expect, it } from "vitest";
import {
  clampZoom, fitBoundsView, MAX_ZOOM, MIN_ZOOM, OSM_TILE_URL, project, projectMapFeatures, SWEDEN_BOUNDS,
  SWEDEN_VIEW, TILE_SIZE, unproject, viewportBounds, visibleTiles, type OsmMapFeature
} from "./osm-tiles";

describe("osm-tiles: Web Mercator, rutor, fitBounds och klustring", () => {
  const originalEnv = process.env.NEXT_PUBLIC_OSM_TILE_URL;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_OSM_TILE_URL;
    else process.env.NEXT_PUBLIC_OSM_TILE_URL = originalEnv;
  });

  it("projicerar och avprojicerar koordinater med hög noggrannhet", () => {
    const p = project(18.07, 59.33, 12);
    const back = unproject(p.x, p.y, 12);
    expect(back.lon).toBeCloseTo(18.07, 6);
    expect(back.lat).toBeCloseTo(59.33, 6);

    const pole = project(15, 95, 4);
    expect(Number.isFinite(pole.y)).toBe(true);
  });

  it("bygger standard-URL och respekterar NEXT_PUBLIC_OSM_TILE_URL samt uttrycklig mall", () => {
    delete process.env.NEXT_PUBLIC_OSM_TILE_URL;
    expect(OSM_TILE_URL(10, 563, 298)).toBe("https://tile.openstreetmap.org/10/563/298.png");

    process.env.NEXT_PUBLIC_OSM_TILE_URL = "https://tiles.example.org/{z}/{x}/{y}.webp";
    expect(OSM_TILE_URL(10, 563, 298)).toBe("https://tiles.example.org/10/563/298.webp");

    expect(OSM_TILE_URL(7, 1, 2, "https://custom.local/{z}/{x}/{y}.png")).toBe("https://custom.local/7/1/2.png");
  });

  it("klämmer zoom till 4–17 som förval och hanterar ogiltiga tal", () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(25)).toBe(MAX_ZOOM);
    expect(clampZoom(10.6)).toBe(11);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
  });

  it("beräknar synliga rutor med omslutning i x-led och giltiga y-gränser", () => {
    const tiles = visibleTiles({ lon: 179.9, lat: 60, zoom: 4 }, 512, 512);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.every(t => t.url.startsWith("https://"))).toBe(true);
    const atTop = visibleTiles({ lon: 15, lat: 84, zoom: 4 }, 512, 512);
    expect(atTop.every(t => !t.key.includes("/-1"))).toBe(true);
  });

  it("beräknar viewportBounds runt aktuell vy", () => {
    const bounds = viewportBounds({ lon: 18.07, lat: 59.33, zoom: 11 }, 600, 400);
    expect(bounds.minLon).toBeLessThan(18.07);
    expect(bounds.maxLon).toBeGreaterThan(18.07);
    expect(bounds.minLat).toBeLessThan(59.33);
    expect(bounds.maxLat).toBeGreaterThan(59.33);
  });

  it("fitBoundsView anpassar zoom för hela Sverige, en orienteringskarta och en punkt", () => {
    const sweden = fitBoundsView(SWEDEN_BOUNDS, 640, 440);
    expect(sweden.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(sweden.zoom).toBeLessThanOrEqual(6);
    expect(sweden.lon).toBeCloseTo(17.55, 1);

    // En lokal orienteringskarta (~2 × 2 km i Nacka).
    const local = fitBoundsView({ minLon: 18.14, minLat: 59.28, maxLon: 18.18, maxLat: 59.30 }, 640, 440);
    expect(local.zoom).toBeGreaterThanOrEqual(12);
    expect(local.zoom).toBeLessThanOrEqual(15);
    expect(local.lon).toBeCloseTo(18.16, 2);

    // Degenererad punkt-bbox får en rimlig lokal zoom.
    const point = fitBoundsView({ minLon: 18.1, minLat: 59.3, maxLon: 18.1, maxLat: 59.3 }, 640, 440);
    expect(point.zoom).toBe(13);
  });

  it("renderar stora ytor som area (rektangel eller polygon) och små (< 18×18 px) som markör eller kluster", () => {
    const features: OsmMapFeature[] = [
      {
        id: "nacka-1",
        title: "Nackareservatet",
        minLon: 18.14,
        minLat: 59.28,
        maxLon: 18.18,
        maxLat: 59.30,
        footprint: [[18.14, 59.28], [18.18, 59.28], [18.18, 59.30], [18.14, 59.30]],
        tone: "open",
        selected: true
      },
      {
        id: "nacka-2",
        title: "Hellasgården",
        minLon: 18.15,
        minLat: 59.29,
        maxLon: 18.17,
        maxLat: 59.305,
        tone: "otid"
      },
      {
        id: "skane-1",
        title: "Skrylle",
        minLon: 13.34,
        minLat: 55.68,
        maxLon: 13.38,
        maxLat: 55.70,
        tone: "info"
      }
    ];

    // På landsnivå (zoom 5) är de två Nacka-kartorna i samma klustercell, medan Skrylle blir en egen markör.
    const country = projectMapFeatures(features, SWEDEN_VIEW, 640, 440);
    expect(country.areas).toHaveLength(0);
    expect(country.markers.map(m => m.feature.id)).toEqual(["skane-1"]);
    expect(country.clusters).toHaveLength(1);
    expect(country.clusters[0]!.count).toBe(2);
    expect(country.clusters[0]!.hasSelected).toBe(true);
    expect(country.clusters[0]!.bounds.minLon).toBe(18.14);
    expect(country.clusters[0]!.bounds.maxLat).toBe(59.305);

    // Vid inzoomning runt Nacka blir båda kartorna klickbara ytor, och Nackareservatet behåller sin polygon.
    const zoomed = projectMapFeatures(features, { lon: 18.16, lat: 59.29, zoom: 13 }, 640, 440);
    expect(zoomed.clusters).toHaveLength(0);
    expect(zoomed.markers).toHaveLength(0);
    expect(zoomed.areas).toHaveLength(2);
    const poly = zoomed.areas.find(a => a.feature.id === "nacka-1");
    const rect = zoomed.areas.find(a => a.feature.id === "nacka-2");
    expect(poly?.points).toHaveLength(4);
    expect(rect?.points).toBeUndefined();
    expect(TILE_SIZE).toBe(256);
  });
});
