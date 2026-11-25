/**
 * Delad Web Mercator- och rutmatematik för OpenStreetMap-kartor (`AreaMapPicker` och `OsmCatalogMap`).
 * Ren TypeScript utan externa kartbibliotek.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 17;
export const SMALL_FEATURE_PX = 18;
export const CLUSTER_CELL_PX = 48;

/** Hela Sverige (WGS84), för återställningsknappen och förvalt utsnitt. */
export const SWEDEN_BOUNDS: OsmBounds = { minLon: 10.9, minLat: 55.3, maxLon: 24.2, maxLat: 69.1 };
export const SWEDEN_VIEW: OsmView = { lon: 16.3, lat: 62.3, zoom: 4 };

const MAX_LAT = 85.0511;
const DEFAULT_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export interface OsmBounds {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface OsmView {
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}

export interface OsmTile {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly url: string;
}

export type OsmMapFeatureTone = "open" | "otid" | "info";

export interface OsmMapFeature {
  readonly id: string;
  readonly title: string;
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
  readonly footprint?: readonly (readonly [number, number])[];
  readonly tone: OsmMapFeatureTone;
  readonly selected?: boolean;
  readonly hovered?: boolean;
}

export interface ProjectedAreaItem {
  readonly kind: "area";
  readonly feature: OsmMapFeature;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly points?: readonly (readonly [number, number])[];
}

export interface ProjectedMarkerItem {
  readonly kind: "marker";
  readonly feature: OsmMapFeature;
  readonly x: number;
  readonly y: number;
}

export interface ProjectedClusterItem {
  readonly kind: "cluster";
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly bounds: OsmBounds;
  readonly features: readonly OsmMapFeature[];
  readonly hasSelected: boolean;
  readonly hasHovered: boolean;
}

/** URL till en OpenStreetMap-ruta, med valfri miljövariabel (`NEXT_PUBLIC_OSM_TILE_URL`). */
export function OSM_TILE_URL(z: number, x: number, y: number, template?: string): string {
  const configured = template ?? (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_OSM_TILE_URL : undefined);
  const pattern = configured && configured.includes("{z}") && configured.includes("{x}") && configured.includes("{y}")
    ? configured
    : DEFAULT_TILE_TEMPLATE;
  return pattern.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.max(min, Math.min(max, Math.round(zoom)));
}

export function clampLat(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  return Math.max(-180, Math.min(180, lon));
}

/** Längd och bredd → världens pixlar på zoomnivån (Web Mercator). */
export function project(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(clampLat(lat) * Math.PI / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
  };
}

/** Världens pixlar på zoomnivån → längd och bredd. */
export function unproject(x: number, y: number, zoom: number): { lon: number; lat: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lon: (x / size) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n))
  };
}

/** Synliga kartrutor för aktuellt fönster. */
export function visibleTiles(view: OsmView, width: number, height: number, tileUrl: (z: number, x: number, y: number) => string = OSM_TILE_URL): OsmTile[] {
  const zoom = clampZoom(view.zoom, 0, 19);
  const center = project(view.lon, view.lat, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const count = 2 ** zoom;
  const tiles: OsmTile[] = [];
  for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + width) / TILE_SIZE); tx++) {
    for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + height) / TILE_SIZE); ty++) {
      if (ty < 0 || ty >= count) continue;
      const wrappedX = ((tx % count) + count) % count;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        x: tx * TILE_SIZE - left,
        y: ty * TILE_SIZE - top,
        url: tileUrl(zoom, wrappedX, ty)
      });
    }
  }
  return tiles;
}

/** Geografisk begränsningsruta för det som syns i kartfönstret. */
export function viewportBounds(view: OsmView, width: number, height: number): OsmBounds {
  const center = project(view.lon, view.lat, view.zoom);
  const halfW = Math.max(1, width) / 2;
  const halfH = Math.max(1, height) / 2;
  const nw = unproject(center.x - halfW, center.y - halfH, view.zoom);
  const se = unproject(center.x + halfW, center.y + halfH, view.zoom);
  return {
    minLon: normalizeLon(Math.min(nw.lon, se.lon)),
    maxLon: normalizeLon(Math.max(nw.lon, se.lon)),
    minLat: clampLat(Math.min(nw.lat, se.lat)),
    maxLat: clampLat(Math.max(nw.lat, se.lat))
  };
}

/** Räknar ut centrum och högsta heltal-zoom som ryms inom kartfönstret för en bbox. */
export function fitBoundsView(
  bounds: OsmBounds,
  width: number,
  height: number,
  options?: { readonly paddingPx?: number; readonly minZoom?: number; readonly maxZoom?: number }
): OsmView {
  const minZoom = options?.minZoom ?? MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? MAX_ZOOM;
  const padding = options?.paddingPx ?? 36;
  const minLon = normalizeLon(Math.min(bounds.minLon, bounds.maxLon));
  const maxLon = normalizeLon(Math.max(bounds.minLon, bounds.maxLon));
  const minLat = clampLat(Math.min(bounds.minLat, bounds.maxLat));
  const maxLat = clampLat(Math.max(bounds.minLat, bounds.maxLat));

  // Visuell mitt i Web Mercator så att området hamnar mitt i kartan även långt norrut.
  const nw0 = project(minLon, maxLat, 0);
  const se0 = project(maxLon, minLat, 0);
  const center = unproject((nw0.x + se0.x) / 2, (nw0.y + se0.y) / 2, 0);

  const spanX0 = Math.abs(se0.x - nw0.x);
  const spanY0 = Math.abs(se0.y - nw0.y);
  if (spanX0 < 1e-7 && spanY0 < 1e-7) {
    return { lon: center.lon, lat: center.lat, zoom: clampZoom(13, minZoom, maxZoom) };
  }

  const innerW = Math.max(32, width - padding * 2);
  const innerH = Math.max(32, height - padding * 2);
  const zoomX = spanX0 > 0 ? Math.log2(innerW / spanX0) : maxZoom;
  const zoomY = spanY0 > 0 ? Math.log2(innerH / spanY0) : maxZoom;
  const zoom = clampZoom(Math.floor(Math.min(zoomX, zoomY)), minZoom, maxZoom);
  return { lon: center.lon, lat: center.lat, zoom };
}

/**
 * Projicerar kartområden till skärmkoordinater: större områden blir rektanglar/polygoner,
 * medan små områden (< 18×18 px) blir tydliga markörer eller rutnätskluster i världspixlar
 * (stabilt utan flimmer när man drar kartan).
 */
export function projectMapFeatures(
  features: readonly OsmMapFeature[],
  view: OsmView,
  width: number,
  height: number,
  options?: { readonly smallPx?: number; readonly clusterCellPx?: number; readonly marginPx?: number }
): {
  readonly areas: readonly ProjectedAreaItem[];
  readonly markers: readonly ProjectedMarkerItem[];
  readonly clusters: readonly ProjectedClusterItem[];
} {
  const smallPx = options?.smallPx ?? SMALL_FEATURE_PX;
  const cellPx = options?.clusterCellPx ?? CLUSTER_CELL_PX;
  const margin = options?.marginPx ?? 48;

  const center = project(view.lon, view.lat, view.zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;

  const areas: ProjectedAreaItem[] = [];
  const buckets = new Map<string, { items: { feature: OsmMapFeature; x: number; y: number }[] }>();

  for (const feature of features) {
    const nw = project(feature.minLon, feature.maxLat, view.zoom);
    const se = project(feature.maxLon, feature.minLat, view.zoom);
    const x1 = Math.min(nw.x, se.x) - left;
    const y1 = Math.min(nw.y, se.y) - top;
    const x2 = Math.max(nw.x, se.x) - left;
    const y2 = Math.max(nw.y, se.y) - top;

    if (x2 < -margin || x1 > width + margin || y2 < -margin || y1 > height + margin) continue;

    const w = Math.max(0, x2 - x1);
    const h = Math.max(0, y2 - y1);
    if (w < smallPx && h < smallPx) {
      const worldCx = (nw.x + se.x) / 2;
      const worldCy = (nw.y + se.y) / 2;
      const key = `${Math.floor(worldCx / cellPx)}:${Math.floor(worldCy / cellPx)}`;
      const entry = buckets.get(key) ?? { items: [] };
      entry.items.push({ feature, x: worldCx - left, y: worldCy - top });
      buckets.set(key, entry);
    } else {
      const points = feature.footprint && feature.footprint.length >= 3
        ? feature.footprint.map(([lon, lat]) => {
            const p = project(lon, lat, view.zoom);
            return [p.x - left, p.y - top] as const;
          })
        : undefined;
      areas.push(points ? { kind: "area", feature, x: x1, y: y1, width: w, height: h, points } : { kind: "area", feature, x: x1, y: y1, width: w, height: h });
    }
  }

  const markers: ProjectedMarkerItem[] = [];
  const clusters: ProjectedClusterItem[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.items.length === 1) {
      const only = bucket.items[0]!;
      markers.push({ kind: "marker", feature: only.feature, x: only.x, y: only.y });
      continue;
    }
    let sumX = 0;
    let sumY = 0;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let hasSelected = false;
    let hasHovered = false;
    const grouped: OsmMapFeature[] = [];
    for (const item of bucket.items) {
      sumX += item.x;
      sumY += item.y;
      const f = item.feature;
      minLon = Math.min(minLon, f.minLon);
      minLat = Math.min(minLat, f.minLat);
      maxLon = Math.max(maxLon, f.maxLon);
      maxLat = Math.max(maxLat, f.maxLat);
      if (f.selected) hasSelected = true;
      if (f.hovered) hasHovered = true;
      grouped.push(f);
    }
    clusters.push({
      kind: "cluster",
      key,
      x: sumX / bucket.items.length,
      y: sumY / bucket.items.length,
      count: bucket.items.length,
      bounds: { minLon, minLat, maxLon, maxLat },
      features: grouped,
      hasSelected,
      hasHovered
    });
  }

  return { areas, markers, clusters };
}
