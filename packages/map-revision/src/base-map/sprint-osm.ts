import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { SourceData, SourceFeature } from "../index";

/**
 * OpenStreetMap för en sprintkarta (ägaren 2026-11-13: «utmaningen med sprint är att få till bebyggelse, gator,
 * avgränsningar för ytor»). På en sprintkarta ritas gator och gångvägar som belagda ytor med bredd (501), inte som linjer.
 * OpenStreetMap har bara mittlinjer, så här får varje väg med hård beläggning en bredd och blir en yta; ytorna slås ihop
 * med gångytor och parkeringar till sammanhängande belagda ytor, och ytornas kanter blir egna linjer (kant belagd yta).
 * Detta är reservvägen när ingen kommunal grundkarta finns: BREDDEN ÄR ANTAGEN, och det står i lagrens namn.
 *
 * - Bredden tas ur taggen `width` (eller `est_width`) när den finns, annars ur förvalen per vägklass nedan; en väg med
 *   `lanes` blir minst 3,25 m per körfält.
 * - Hård beläggning: vägar för bilar samt gång- och cykelvägar räknas som belagda om inte `surface` säger annat; stigar
 *   och traktorvägar räknas som obelagda om inte `surface` säger att de är belagda. Hårt packat grus (`compacted`) räknas som
 *   belagt, som i normens 501.
 * - Obelagda vägar och stigar förblir linjer (505–507) i egna lager; tunnlar och passager genom hus förblir linjer utan förslag.
 * - Träd med mått (kronans diameter minst 8 m, höjd minst 12 m eller stammens omkrets minst 2 m) hamnar i lagret
 *   «OSM träd (stort)» (417); övriga i «OSM träd» (418 på en sprintkarta).
 */
export const SPRINT_PAVED_LAYER = "OSM belagd yta (antagen bredd)";
export const SPRINT_PAVED_EDGE_LAYER = "OSM kant belagd yta (antagen bredd)";
const LARGE_TREE_LAYER = "OSM träd (stort)";
const TUNNEL_LAYER = "OSM tunnel eller passage";

/** Förvald bredd i meter per vägklass (OpenStreetMaps `highway`), när vägen saknar `width`. */
export const SPRINT_ROAD_WIDTHS: Readonly<Record<string, number>> = {
  motorway: 12, trunk: 12, primary: 10, secondary: 9, tertiary: 7.5, unclassified: 6, residential: 6, road: 6, living_street: 5,
  service: 4, pedestrian: 5, cycleway: 3, footway: 2.5, track: 3, path: 2, bridleway: 2
};
/** Påfarter och avfarter (`_link`). */
const LINK_WIDTH = 5;
const LANE_WIDTH = 3.25;
const WIDTH_LIMITS = { min: 1, max: 40 } as const;
/** Klasser som är obelagda när `surface` saknas. */
const UNPAVED_BY_DEFAULT = new Set(["path", "bridleway", "track"]);
const PAVED_SURFACE = /^(paved|asphalt|concrete(:.*)?|paving_stones(:.*)?|sett|cobblestone(:.*)?|unhewn_cobblestone|bricks?|metal|compacted|chipseal)$/;
const LARGE_TREE = { crown: 8, height: 12, circumference: 2 } as const;
/** Hål i den belagda ytan under den här storleken (m²) fylls: skärvor mellan två vägar som nästan möts. */
const MIN_HOLE_M2 = 25;
/** Brytpunkter tätare än så här (meter) slås ihop innan vägen får sin bredd. */
const MIN_STEP_M = 0.5;

type Position = readonly [number, number];
type Tags = Readonly<Record<string, unknown>>;

/** Ett mått i meter ur en tagg («3», «3.5 m», «3,5»); undefined om det inte är ett tal. */
export function osmMeters(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(m|meter|metres?)?\s*$/i.exec(String(value));
  const meters = match ? Number(match[1]!.replace(",", ".")) : NaN;
  return Number.isFinite(meters) && meters > 0 ? meters : undefined;
}

/** Vägklassen: ur taggen, annars ur lagrets namn (äldre hämtningar utan taggar). */
function highwayOf(feature: SourceFeature): string | undefined {
  const tagged = feature.properties?.highway;
  if (typeof tagged === "string") return tagged;
  const road = /^OSM väg \((\w+)\)$/.exec(feature.layer)?.[1];
  if (road) return road;
  return feature.layer === "OSM gångväg och cykelväg" ? "footway" : feature.layer === "OSM stig" ? "path" : feature.layer === "OSM traktorväg (track)" ? "track" : undefined;
}

/** Vägens bredd i meter och om den är antagen (ur förvalen) eller ur vägens egna taggar. */
export function sprintRoadWidth(highway: string, tags: Tags = {}): { meters: number; assumed: boolean } {
  const tagged = osmMeters(tags.width) ?? osmMeters(tags.est_width);
  if (tagged !== undefined) return { meters: Math.min(WIDTH_LIMITS.max, Math.max(WIDTH_LIMITS.min, tagged)), assumed: false };
  const base = SPRINT_ROAD_WIDTHS[highway.replace(/_link$/, "")] ?? SPRINT_ROAD_WIDTHS.service!;
  const preset = /_link$/.test(highway) ? LINK_WIDTH : base;
  const lanes = osmMeters(tags.lanes);
  return { meters: Math.min(WIDTH_LIMITS.max, Math.max(preset, lanes ? lanes * LANE_WIDTH : 0)), assumed: true };
}

/** Har vägen hård beläggning? `surface` avgör när den finns, annars vägklassen. */
export function sprintPaved(highway: string, tags: Tags = {}): boolean {
  const surface = typeof tags.surface === "string" ? tags.surface.trim().toLowerCase() : "";
  if (surface) return PAVED_SURFACE.test(surface);
  return !UNPAVED_BY_DEFAULT.has(highway);
}

const ringArea = (ring: readonly Position[]) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
const cm = (value: number) => Math.round(value * 100) / 100;

/** Sträckan a–b med halva bredden `r` som en konvex månghörning med avrundade ändar (åtta hörn per hel cirkel). */
function capsule(a: Position, b: Position, r: number): Polygon {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ring: [number, number][] = [];
  for (let step = -2; step <= 2; step += 1) ring.push([cm(b[0] + r * Math.cos(angle + step * Math.PI / 4)), cm(b[1] + r * Math.sin(angle + step * Math.PI / 4))]);
  for (let step = 2; step <= 6; step += 1) ring.push([cm(a[0] + r * Math.cos(angle + step * Math.PI / 4)), cm(a[1] + r * Math.sin(angle + step * Math.PI / 4))]);
  ring.push([ring[0]![0], ring[0]![1]]);
  return [ring];
}

/** Alla ytor som en (parvis, så att varje sammanslagning är liten). En sammanslagning som inte går lämnar ytorna var för sig. */
function unionAll(polygons: readonly Polygon[]): MultiPolygon {
  let level: MultiPolygon[] = polygons.map(polygon => [polygon]);
  while (level.length > 1) {
    const next: MultiPolygon[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const a = level[index]!, b = level[index + 1];
      if (!b) { next.push(a); continue; }
      try { next.push(polygonClipping.union(a, b)); } catch { next.push([...a, ...b]); }
    }
    level = next;
  }
  return level[0] ?? [];
}

/** Ringen utan upprepad slutpunkt och utan punkter som ligger på linjen mellan sina grannar (inom `tolerance` meter). */
function tidyRing(ring: readonly Position[], tolerance = 0.05): [number, number][] {
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : [...ring];
  const kept: [number, number][] = [];
  for (let index = 0; index < open.length; index += 1) {
    const before = kept[kept.length - 1] ?? open[(index + open.length - 1) % open.length]!, here = open[index]!, after = open[(index + 1) % open.length]!;
    const chord = Math.hypot(after[0] - before[0], after[1] - before[1]);
    const off = chord === 0 ? 0 : Math.abs((after[0] - before[0]) * (before[1] - here[1]) - (before[0] - here[0]) * (after[1] - before[1])) / chord;
    if (off > tolerance || chord === 0) kept.push([here[0], here[1]]);
  }
  return kept.length >= 3 ? kept : open.map(([x, y]) => [x, y]);
}

/**
 * Ett gatunät som hänger ihop blir en enda yta med varje kvarter som ett hål. Ett kartobjekt får ha högst 200 ringar och
 * 20 000 punkter (`LIMITS`), så en yta med fler än `MAX_HOLES` hål eller `MAX_POINTS` punkter delas mitt itu (längs sin
 * längsta sida) tills bitarna ryms. Skarvarna syns inte: bitarna har samma symbol och kanten ritas av kantlinjerna.
 */
const MAX_HOLES = 40, MAX_POINTS = 4000;
function splitLarge(polygon: Polygon, depth = 0): Polygon[] {
  const points = polygon.reduce((sum, ring) => sum + ring.length, 0);
  if ((polygon.length - 1 <= MAX_HOLES && points <= MAX_POINTS) || depth >= 12) return [polygon];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0]!) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const wide = maxX - minX >= maxY - minY, mid = wide ? cm((minX + maxX) / 2) : cm((minY + maxY) / 2);
  const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  const halves = wide ? [box(minX - 1, minY - 1, mid, maxY + 1), box(mid, minY - 1, maxX + 1, maxY + 1)]
    : [box(minX - 1, minY - 1, maxX + 1, mid), box(minX - 1, mid, maxX + 1, maxY + 1)];
  try {
    return halves.flatMap(half => polygonClipping.intersection([polygon], [half])).flatMap(piece => splitLarge(piece, depth + 1));
  } catch { return [polygon]; }
}

export interface SprintOsmSummary {
  /** Vägar som blev belagd yta, och hur många av dem som fick en antagen bredd. */
  readonly paved: number; readonly assumed: number;
  /** Obelagda vägar och stigar som förblev linjer, och tunnlar och passager. */
  readonly unpaved: number; readonly tunnels: number;
  /** Belagda ytor efter sammanslagningen (ett stort gatunät delas i flera objekt). */
  readonly surfaces: number;
}

/**
 * OpenStreetMaps objekt för en sprintkarta: vägarna med hård beläggning som sammanhängande belagda ytor
 * (`SPRINT_PAVED_LAYER`) med kanterna som slutna linjer (`SPRINT_PAVED_EDGE_LAYER`); resten som förut. Koordinaterna är som
 * i `data` (WGS 84 från hämtningen, eller ett plant system i meter).
 */
export function sprintOsm(data: SourceData): SourceData & { readonly sprint: SprintOsmSummary } {
  const geographic = data.crs === undefined || data.crs === 4326;
  // WGS 84 räknas om till meter kring områdets mitt (ekvirektangulärt; felet är millimeter över en sprintkarta).
  let lon0 = 0, lat0 = 0;
  if (geographic) {
    let count = 0;
    for (const { geometry } of data.features) {
      if (geometry.kind !== "line") continue;
      for (const [lon, lat] of geometry.points) { lon0 += lon; lat0 += lat; count += 1; }
    }
    if (count) { lon0 /= count; lat0 /= count; }
  }
  const kx = geographic ? 111_320 * Math.cos(lat0 * Math.PI / 180) : 1, ky = geographic ? 110_574 : 1;
  const toMeters = ([x, y]: Position): [number, number] => [(x - lon0) * kx, (y - lat0) * ky];
  const fromMeters = ([x, y]: Position): [number, number] => geographic
    ? [Math.round((x / kx + lon0) * 1e8) / 1e8, Math.round((y / ky + lat0) * 1e8) / 1e8] : [cm(x), cm(y)];

  const rest: SourceFeature[] = [], pieces: Polygon[] = [];
  let paved = 0, assumed = 0, unpaved = 0, tunnels = 0;
  for (const feature of data.features) {
    const { geometry, layer } = feature;
    // Gångytor och parkeringar som ytor går in i samma belagda yta.
    if (/^OSM (gångyta|parkering)/.test(layer) && (geometry.kind === "area" || (geometry.kind === "line" && geometry.closed))) {
      const rings = (geometry.kind === "area" ? geometry.rings : [geometry.points]).map(ring => ring.map(toMeters).map(([x, y]) => [cm(x), cm(y)] as [number, number]))
        .filter(ring => ring.length >= 3).map(ring => [...ring, ring[0]!]);
      if (rings.length) { pieces.push(rings); continue; }
    }
    if (layer === "OSM träd" && geometry.kind === "point") {
      const tags = feature.properties ?? {};
      const large = (osmMeters(tags.diameter_crown) ?? 0) >= LARGE_TREE.crown || (osmMeters(tags.height) ?? 0) >= LARGE_TREE.height
        || (osmMeters(tags.circumference) ?? 0) >= LARGE_TREE.circumference;
      rest.push({ layer: large ? LARGE_TREE_LAYER : layer, geometry });
      continue;
    }
    const highway = geometry.kind === "line" ? highwayOf(feature) : undefined;
    if (!highway || geometry.kind !== "line" || highway === "steps") { rest.push(feature); continue; }
    const tags = feature.properties ?? {};
    if (typeof tags.tunnel === "string" && tags.tunnel !== "no") { tunnels += 1; rest.push({ layer: TUNNEL_LAYER, geometry }); continue; }
    if (!sprintPaved(highway, tags)) {
      unpaved += 1;
      // Stigar och traktorvägar har redan egna lager; en obelagd väg eller gångväg får ett eget, så att den blir en stig (505).
      rest.push({ layer: UNPAVED_BY_DEFAULT.has(highway) ? layer : `OSM obelagd väg (${highway})`, geometry });
      continue;
    }
    const width = sprintRoadWidth(highway, tags);
    const points: [number, number][] = [];
    for (const point of [...geometry.points, ...(geometry.closed && geometry.points[0] ? [geometry.points[0]] : [])]) {
      const at = toMeters(point), last = points[points.length - 1];
      if (!last || Math.hypot(at[0] - last[0], at[1] - last[1]) >= MIN_STEP_M) points.push(at);
    }
    if (points.length < 2) { rest.push(feature); continue; }
    paved += 1; if (width.assumed) assumed += 1;
    for (let index = 1; index < points.length; index += 1) pieces.push(capsule(points[index - 1]!, points[index]!, width.meters / 2));
  }
  const surface = unionAll(pieces);
  const areas: SourceFeature[] = [], edges: SourceFeature[] = [];
  for (const polygon of surface) {
    const rings = polygon.map(ring => tidyRing(ring)).filter((ring, index) => ring.length >= 3 && (index === 0 || ringArea(ring) >= MIN_HOLE_M2));
    if (!rings.length || ringArea(rings[0]!) <= 0) continue;
    for (const ring of rings) edges.push({ layer: SPRINT_PAVED_EDGE_LAYER, geometry: { kind: "line", points: ring.map(fromMeters), closed: true } });
    for (const piece of splitLarge(rings.map(ring => [...ring, ring[0]!]))) {
      const placed = piece.map(ring => tidyRing(ring, 0)).filter(ring => ring.length >= 3).map(ring => ring.map(fromMeters));
      if (placed.length) areas.push({ layer: SPRINT_PAVED_LAYER, geometry: { kind: "area", rings: placed } });
    }
  }
  return { ...data, features: [...rest, ...areas, ...edges], sprint: { paved, assumed, unpaved, tunnels, surfaces: areas.length } };
}
