import type { SourceData, SourceFeature, SourceGeometry } from "./vector-parse";

/**
 * ADR-0219 tillägget om hämtningen (K4c): OpenStreetMap för kartans område eller en etapp, via Overpass. Svaret blir samma
 * lager och objekt som en importerad vektorfil (`SourceData`, WGS 84), så att symbolerna väljs per lager och kandidaterna
 * lämnas som förslag på samma sätt (K4b). Lagernamnen är svenska och valda så att förslagen ur namnen (`suggestSymbol`)
 * träffar: byggnad, staket, mur, trappa, väg, stig, vatten. OSM-data är ODbL: källan anges i förslagets anteckning.
 */
export interface Wgs84Box { readonly south: number; readonly west: number; readonly north: number; readonly east: number }
export const OSM_LIMITS = { maxSpanDegrees: 0.12, maxAreaKm2: 40, maxFeatures: 30_000 } as const;
export const OSM_ATTRIBUTION = "© OpenStreetMap-bidragsgivare (ODbL)";

/** Ytan i km² (ungefär, på latituden mitt i rutan). */
export function boxAreaKm2(box: Wgs84Box): number {
  const middle = (box.south + box.north) / 2 * Math.PI / 180;
  return Math.abs(box.north - box.south) * 111.32 * Math.abs(box.east - box.west) * 111.32 * Math.cos(middle);
}

/** Rutan är giltig och inte för stor. */
export function validOsmBox(box: Wgs84Box): boolean {
  const values = [box.south, box.west, box.north, box.east];
  return values.every(Number.isFinite) && box.south >= -85 && box.north <= 85 && box.west >= -180 && box.east <= 180
    && box.north > box.south && box.east > box.west && box.north - box.south <= OSM_LIMITS.maxSpanDegrees
    && box.east - box.west <= OSM_LIMITS.maxSpanDegrees * 2 && boxAreaKm2(box) <= OSM_LIMITS.maxAreaKm2;
}

/**
 * Sökningen efter laserrutor får vara större än OpenStreetMap-hämtningen (ägaren 2026-11-12: «kan man höja max-storleken»):
 * den hämtar bara en lista med rutor. Jobbet tar högst 25 rutor, och kartan i webbläsaren blir tung långt före 100 km².
 */
export const LASER_SEARCH_LIMITS = { maxSpanDegrees: 0.25, maxAreaKm2: 100 } as const;
export function validLaserBox(box: Wgs84Box): boolean {
  const values = [box.south, box.west, box.north, box.east];
  return values.every(Number.isFinite) && box.south >= -85 && box.north <= 85 && box.west >= -180 && box.east <= 180
    && box.north > box.south && box.east > box.west && box.north - box.south <= LASER_SEARCH_LIMITS.maxSpanDegrees
    && box.east - box.west <= LASER_SEARCH_LIMITS.maxSpanDegrees * 2 && boxAreaKm2(box) <= LASER_SEARCH_LIMITS.maxAreaKm2;
}

/**
 * Ägaren 2026-11-12 («varför kan man inte hämta openstreetmap och hyggen i omgångar så att gränsen blir samma?»): en ruta
 * upp till laserns gräns delas i rutor som var för sig ryms i en Overpass-fråga. Samma objekt kan komma i flera rutor och
 * räknas en gång (`mergeOverpass`).
 */
export function osmTiles(box: Wgs84Box): Wgs84Box[] {
  if (!validLaserBox(box)) return [];
  let rows = Math.ceil((box.north - box.south) / OSM_LIMITS.maxSpanDegrees), cols = Math.ceil((box.east - box.west) / (OSM_LIMITS.maxSpanDegrees * 2));
  while (boxAreaKm2(box) / (rows * cols) > OSM_LIMITS.maxAreaKm2) { if (rows <= cols) rows += 1; else cols += 1; }
  const tiles: Wgs84Box[] = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    tiles.push({ south: box.south + (box.north - box.south) * row / rows, north: box.south + (box.north - box.south) * (row + 1) / rows,
      west: box.west + (box.east - box.west) * col / cols, east: box.west + (box.east - box.west) * (col + 1) / cols });
  }
  return tiles;
}

/** Flera Overpass-svar som ett; ett objekt (typ och id) tas med en gång. */
export function mergeOverpass(answers: readonly unknown[]): { elements: unknown[] } {
  const seen = new Set<string>(), elements: unknown[] = [];
  for (const answer of answers) {
    const list = (answer as { elements?: unknown } | null)?.elements;
    if (!Array.isArray(list)) throw new Error("Svaret från OpenStreetMap gick inte att läsa");
    for (const element of list as { type?: unknown; id?: unknown }[]) {
      const key = `${String(element?.type)}/${String(element?.id)}`;
      if (element?.id !== undefined && seen.has(key)) continue;
      seen.add(key); elements.push(element);
    }
  }
  return { elements };
}

/** Overpass-frågan: det som orienteringskartan har nytta av, med geometrin direkt (`out geom`). */
export function overpassQuery(box: Wgs84Box): string {
  const b = `(${[box.south, box.west, box.north, box.east].map(value => value.toFixed(7)).join(",")})`;
  return `[out:json][timeout:90][maxsize:268435456];
(
  way["building"]${b}; relation["building"]["type"="multipolygon"]${b};
  way["highway"]${b};
  way["barrier"]${b};
  way["railway"]${b};
  way["power"="line"]${b};
  way["waterway"]${b};
  way["natural"~"^(water|wetland|scrub|wood|bare_rock|sand|cliff|tree_row)$"]${b};
  relation["natural"~"^(water|wetland|wood)$"]["type"="multipolygon"]${b};
  way["landuse"]${b}; relation["landuse"]["type"="multipolygon"]${b};
  way["leisure"]${b};
  way["amenity"="parking"]${b};
  way["man_made"~"^(bridge|pier)$"]${b};
  node["natural"="tree"]${b};
);
out geom qt;`;
}

type Tags = Readonly<Record<string, string>>;
/** Lagret för ett objekt med de här taggarna, och om en sluten form är en yta. Undefined = hoppas över. */
export function osmLayer(tags: Tags, closed: boolean): { layer: string; area: boolean } | undefined {
  const t = (key: string) => tags[key];
  if (t("area") === "no") closed = false;
  if (t("building")) {
    if (t("building") === "roof") return { layer: "OSM skärmtak (building=roof)", area: true };
    return { layer: "OSM byggnad", area: true };
  }
  const barrier = t("barrier");
  if (barrier) {
    if (barrier === "fence") return { layer: "OSM staket", area: false };
    if (barrier === "retaining_wall") return { layer: "OSM stödmur", area: false };
    if (barrier === "wall" || barrier === "city_wall") return { layer: "OSM mur", area: false };
    if (barrier === "hedge") return { layer: "OSM häck", area: closed && t("area") === "yes" };
    if (barrier === "kerb") return { layer: "OSM kantsten", area: false };
    return { layer: `OSM hinder (barrier=${barrier})`, area: false };
  }
  const highway = t("highway");
  if (highway) {
    if (highway === "steps") return { layer: "OSM trappa", area: false };
    if (closed && t("area") === "yes") return { layer: "OSM gångyta (highway=pedestrian)", area: true };
    if (highway === "footway" || highway === "pedestrian" || highway === "cycleway") return { layer: "OSM gångväg och cykelväg", area: false };
    if (highway === "path" || highway === "bridleway") return { layer: "OSM stig", area: false };
    if (highway === "track") return { layer: "OSM traktorväg (track)", area: false };
    if (["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street", "road"]
      .some(kind => highway === kind || highway === `${kind}_link`)) return { layer: `OSM väg (${highway})`, area: false };
    return undefined;
  }
  if (t("railway") && t("railway") !== "abandoned" && t("railway") !== "razed") return { layer: "OSM järnväg", area: false };
  if (t("power") === "line") return { layer: "OSM kraftledning", area: false };
  const waterway = t("waterway");
  if (waterway) {
    if (waterway === "ditch" || waterway === "drain") return { layer: "OSM dike", area: false };
    if (waterway === "stream" || waterway === "brook") return { layer: "OSM bäck", area: false };
    if (waterway === "riverbank") return { layer: "OSM vatten", area: true };
    return { layer: `OSM vattendrag (${waterway})`, area: false };
  }
  const natural = t("natural");
  if (natural === "water") return { layer: "OSM vatten", area: true };
  if (natural === "wetland") return { layer: "OSM sankmark (wetland)", area: true };
  if (natural === "cliff") return { layer: "OSM brant (cliff)", area: false };
  if (natural === "tree_row") return { layer: "OSM trädrad (tree_row)", area: false };
  if (natural) return { layer: `OSM natur (${natural})`, area: closed };
  if (t("amenity") === "parking") return { layer: "OSM parkering", area: closed };
  if (t("landuse")) return { layer: `OSM markanvändning (${t("landuse")})`, area: closed };
  if (t("leisure")) return { layer: `OSM fritid (${t("leisure")})`, area: closed };
  if (t("man_made")) return { layer: `OSM anläggning (${t("man_made")})`, area: closed };
  return undefined;
}

type Position = readonly [number, number];
interface OverpassPoint { readonly lat: number; readonly lon: number }
interface OverpassElement {
  readonly type: string; readonly tags?: Tags; readonly lat?: number; readonly lon?: number; readonly geometry?: readonly (OverpassPoint | null)[];
  readonly members?: readonly { readonly type: string; readonly role?: string; readonly geometry?: readonly (OverpassPoint | null)[] }[];
}

const positionsOf = (geometry: readonly (OverpassPoint | null)[] | undefined): Position[] => (geometry ?? [])
  .filter((point): point is OverpassPoint => !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon))
  .map(point => [point.lon, point.lat]);
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Relationens vägar fogade till slutna ringar (ändarna möts); öppna rester hoppas över. */
export function joinRings(parts: readonly Position[][]): Position[][] {
  const rings: Position[][] = [];
  const open = parts.filter(part => part.length >= 2).map(part => [...part]);
  while (open.length > 0) {
    let ring = open.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      const end = ring[ring.length - 1]!;
      const index = open.findIndex(part => same(part[0]!, end) || same(part[part.length - 1]!, end));
      if (index < 0) break;
      const [next] = open.splice(index, 1) as [Position[]];
      ring = [...ring, ...(same(next[0]!, end) ? next : [...next].reverse()).slice(1)];
      grew = true;
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(ring.slice(0, -1));
  }
  return rings;
}

/**
 * Taggarna som följer med objektet som egenskaper, för sprintkartans steg (`sprintOsm` i base-map): vägens bredd och
 * beläggning (vägar och gångvägar blir belagda ytor) och trädets storlek (stort träd 417 eller litet 418). Bara vägar och
 * träd bär dem, och bara de taggar som finns.
 */
const WAY_TAGS = ["highway", "width", "est_width", "lanes", "surface", "tunnel", "service"] as const;
const TREE_TAGS = ["height", "diameter_crown", "circumference"] as const;
function keptTags(tags: Tags, keys: readonly string[]): { properties: Record<string, string> } | undefined {
  const found = keys.filter(key => typeof tags[key] === "string").map(key => [key, tags[key]!] as const);
  return found.length ? { properties: Object.fromEntries(found) } : undefined;
}

/** Overpass-svaret (`out geom`) som lager och objekt i WGS 84 (längd, bredd). Kastar om svaret inte är Overpass JSON. */
export function osmToSourceData(json: unknown): SourceData {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error("Svaret från OpenStreetMap gick inte att läsa");
  const features: SourceFeature[] = [];
  let skipped = 0;
  for (const element of elements as OverpassElement[]) {
    if (features.length >= OSM_LIMITS.maxFeatures) { skipped += 1; continue; }
    const tags = element.tags ?? {};
    let geometry: SourceGeometry | undefined, layer: string | undefined, kept: { properties: Record<string, string> } | undefined;
    if (element.type === "node") {
      if (tags.natural === "tree" && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
        layer = "OSM träd"; geometry = { kind: "point", at: [element.lon!, element.lat!] }; kept = keptTags(tags, TREE_TAGS);
      }
    } else if (element.type === "way") {
      const points = positionsOf(element.geometry);
      if (points.length >= 2) {
        const closed = points.length >= 4 && same(points[0]!, points[points.length - 1]!);
        const kind = osmLayer(tags, closed);
        if (kind) {
          layer = kind.layer;
          const ring = closed ? points.slice(0, -1) : points;
          geometry = kind.area && closed ? { kind: "area", rings: [ring] } : { kind: "line", points: ring, closed };
          if (tags.highway && geometry.kind === "line") kept = keptTags(tags, WAY_TAGS);
        }
      }
    } else if (element.type === "relation") {
      const kind = osmLayer(tags, true);
      if (kind?.area) {
        const members = element.members ?? [];
        const outer = joinRings(members.filter(member => member.type === "way" && member.role !== "inner").map(member => positionsOf(member.geometry)));
        const inner = joinRings(members.filter(member => member.type === "way" && member.role === "inner").map(member => positionsOf(member.geometry)));
        // En ytterring per objekt, med alla inre ringar som hål (Overpass ger inte vilken ring hålet hör till).
        for (const [index, ring] of outer.entries()) {
          features.push({ layer: kind.layer, geometry: { kind: "area", rings: index === 0 ? [ring, ...inner] : [ring] } });
        }
        if (outer.length === 0) skipped += 1;
        continue;
      }
    }
    if (layer && geometry) features.push({ layer, geometry, ...kept }); else skipped += 1;
  }
  return { features, crs: 4326, skipped };
}
