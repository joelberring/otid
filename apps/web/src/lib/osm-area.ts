/**
 * Ägaren 2026-11-10: kartans område valt på en karta. Bakgrunden är OpenStreetMaps rutor; området ritas för hand eller tas
 * från en yta i OpenStreetMap (park, skog, naturreservat, ö …) som innehåller punkten man klickar på. Rena funktioner:
 * rutornas matematik, Overpass-frågan och svaret som ytor att välja bland.
 */
import { joinRings } from "@o-tid/map-revision";
import type { AreaInput } from "./map-project-area-input";

export const OSM_TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const TILE = 256;
/** Ett område större än så här (km²) visas inte som val (en ny karta får inte vara så stor ändå). */
export const MAX_AREA_KM2 = 60;
/** API:t tar högst så många punkter per ring. */
const MAX_POINTS = 2000;

/** Längd och bredd → världens pixlar på zoomnivån (Web Mercator). */
export function project(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
  return { x: (lon + 180) / 360 * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

/** Världens pixlar på zoomnivån → längd och bredd. */
export function unproject(x: number, y: number, zoom: number): { lon: number; lat: number } {
  const size = TILE * 2 ** zoom;
  const n = Math.PI - 2 * Math.PI * y / size;
  return { lon: x / size * 360 - 180, lat: 180 / Math.PI * Math.atan(Math.sinh(n)) };
}

/** Overpass: alla ytor (vägar och relationer) som innehåller punkten, med geometri. Kommunerna och större tas inte med. */
export function overpassContaining(lat: number, lon: number): string {
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `[out:json][timeout:25];is_in(${at})->.a;(way(pivot.a)[!"admin_level"];relation(pivot.a)[!"admin_level"][type=multipolygon];` +
    `relation(pivot.a)[!"admin_level"][type=boundary][boundary~"protected_area|national_park"];);out geom;`;
}

export interface OsmAreaChoice { readonly id: string; readonly name: string; readonly kind: string; readonly km2: number; readonly area: AreaInput }

type Point = [number, number];
interface Element { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

const positions = (geometry: Element["geometry"]): Point[] => (geometry ?? []).filter(point => point && Number.isFinite(point.lat))
  .map(point => [point.lon, point.lat]);

/** Ringens yta i km² (ungefär, lokalt plan). */
export function ringKm2(ring: readonly Point[]): number {
  if (ring.length < 3) return 0;
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  let sum = 0;
  ring.forEach(([x1, y1], index) => { const [x2, y2] = ring[(index + 1) % ring.length]!; sum += x1 * kx * y2 * ky - x2 * kx * y1 * ky; });
  return Math.abs(sum) / 2;
}

/** Högst `MAX_POINTS` punkter: var n:te punkt (formen behålls tillräckligt för en kartgräns). */
function thin(ring: Point[]): Point[] {
  if (ring.length <= MAX_POINTS) return ring;
  const step = Math.ceil(ring.length / MAX_POINTS);
  return ring.filter((_, index) => index % step === 0);
}

function closedRing(points: Point[]): Point[] | undefined {
  if (points.length < 4) return undefined;
  const [first] = points, last = points[points.length - 1]!;
  return first![0] === last[0] && first![1] === last[1] ? points.slice(0, -1) : undefined;
}

const KIND_KEYS = ["leisure", "landuse", "natural", "boundary", "place", "amenity", "tourism"] as const;

/** Overpass-svaret som ytor att välja bland, minst först (den närmaste ytan runt punkten är oftast den man menar). */
export function osmAreaChoices(json: unknown): OsmAreaChoice[] {
  const elements = (json as { elements?: Element[] } | undefined)?.elements ?? [];
  const out: OsmAreaChoice[] = [];
  for (const element of elements) {
    let rings: Point[][] = [];
    if (element.type === "way") { const ring = closedRing(positions(element.geometry)); if (ring) rings = [ring]; }
    else if (element.type === "relation") {
      const outer = joinRings((element.members ?? []).filter(member => member.role !== "inner").map(member => positions(member.geometry)));
      const inner = joinRings((element.members ?? []).filter(member => member.role === "inner").map(member => positions(member.geometry)));
      // Den största yttre ringen och dess hål (en kartgräns är en sammanhängande yta).
      const largest = outer.sort((a, b) => ringKm2(b as Point[]) - ringKm2(a as Point[]))[0];
      if (largest) rings = [largest as Point[], ...(inner as Point[][])].slice(0, 20);
    }
    if (rings.length === 0) continue;
    const km2 = ringKm2(rings[0]!) - rings.slice(1).reduce((sum, ring) => sum + ringKm2(ring), 0);
    if (km2 <= 0 || km2 > MAX_AREA_KM2) continue;
    const tags = element.tags ?? {};
    const key = KIND_KEYS.find(entry => tags[entry]);
    out.push({ id: `${element.type}/${element.id}`, name: tags.name ?? tags["name:sv"] ?? "", kind: key ? `${key}=${tags[key]}` : element.type, km2,
      area: { crs: "WGS84", rings: rings.map(ring => thin(ring.map(([x, y]) => [x, y]))) } });
  }
  return out.sort((a, b) => a.km2 - b.km2);
}
