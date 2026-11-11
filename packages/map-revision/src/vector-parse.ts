/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): GeoJSON och DXF (text) läses till objekt per lager i källans koordinater. Inget
 * ritas här; lagren mappas till symboler och räknas om till kartans mm i `vector-import.ts`. DWG läses senare i geo-arbetaren.
 */
export type SourceGeometry =
  | { readonly kind: "point"; readonly at: readonly [number, number] }
  | { readonly kind: "line"; readonly points: readonly (readonly [number, number])[]; readonly closed: boolean }
  | { readonly kind: "area"; readonly rings: readonly (readonly (readonly [number, number])[])[] };
/** `elevation`: höjden i meter när filen anger den (DXF:s kod 38 eller z i första punkten), t.ex. för höjdkurvor. */
export interface SourceFeature { readonly layer: string; readonly geometry: SourceGeometry; readonly elevation?: number | undefined }
export interface SourceData {
  readonly features: readonly SourceFeature[];
  /** EPSG-koden om filen anger den. */
  readonly crs?: number | undefined;
  /** Objekt som inte kunde läsas (okänd typ, för få punkter). */
  readonly skipped: number;
}
export class VectorParseError extends Error {}

type Position = readonly [number, number];
const position = (value: unknown): Position | undefined => Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number"
  && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? [value[0], value[1]] : undefined;
const positions = (value: unknown): Position[] => Array.isArray(value) ? value.map(position).filter((at): at is Position => !!at) : [];
/** En linje: sluten om flaggan säger det eller om sista punkten är den första (som då tas bort). */
function lineOf(points: Position[], flagged: boolean): SourceGeometry {
  const ring = openRing(points);
  return { kind: "line", points: ring, closed: flagged || ring.length < points.length };
}
/** En ring utan den upprepade sista punkten. */
function openRing(ring: Position[]): Position[] {
  const first = ring[0], last = ring[ring.length - 1];
  return first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

/** Egenskaperna som ger lagret, i den ordningen (stora och små bokstäver spelar ingen roll). */
export const LAYER_PROPERTIES = ["layer", "lager", "objekttyp", "obkod", "detaljtyp", "type", "kind", "class"];
export function layerOf(properties: unknown, fallback: string): string {
  if (properties && typeof properties === "object") {
    const byName = new Map(Object.entries(properties as Record<string, unknown>).map(([name, value]) => [name.toLowerCase(), value]));
    for (const name of LAYER_PROPERTIES) {
      const value = byName.get(name);
      if ((typeof value === "string" && value.trim()) || typeof value === "number") return String(value).trim().slice(0, 120);
    }
  }
  return fallback;
}

/** GeoJSON: en FeatureCollection, en Feature eller en geometri. Lagret ur egenskaper som `layer` eller `objekttyp`, annars typen. */
export function parseGeoJson(text: string): SourceData {
  let root: unknown;
  try { root = JSON.parse(text) as unknown; } catch { throw new VectorParseError("Filen är inte GeoJSON."); }
  const features: SourceFeature[] = [];
  let skipped = 0;
  const add = (geometry: unknown, layer: string) => {
    const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
    if (!g || typeof g !== "object") { skipped += 1; return; }
    const push = (item: SourceGeometry) => features.push({ layer, geometry: item });
    switch (g.type) {
      case "Point": { const at = position(g.coordinates); if (at) push({ kind: "point", at }); else skipped += 1; return; }
      case "MultiPoint": for (const at of positions(g.coordinates)) push({ kind: "point", at }); return;
      case "LineString": { const points = positions(g.coordinates); if (points.length >= 2) push(lineOf(points, false)); else skipped += 1; return; }
      case "MultiLineString":
        for (const part of Array.isArray(g.coordinates) ? g.coordinates : []) {
          const points = positions(part);
          if (points.length >= 2) push(lineOf(points, false)); else skipped += 1;
        }
        return;
      case "Polygon": case "MultiPolygon": {
        const polygons = g.type === "Polygon" ? [g.coordinates] : Array.isArray(g.coordinates) ? g.coordinates : [];
        for (const polygon of polygons) {
          const rings = (Array.isArray(polygon) ? polygon : []).map(ring => openRing(positions(ring))).filter(ring => ring.length >= 3);
          if (rings.length > 0) push({ kind: "area", rings }); else skipped += 1;
        }
        return;
      }
      case "GeometryCollection": for (const part of g.geometries ?? []) add(part, layer); return;
      default: skipped += 1;
    }
  };
  const value = root as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown; crs?: { properties?: { name?: unknown } } };
  const list = value?.type === "FeatureCollection" ? value.features ?? [] : value?.type === "Feature" ? [value] : [{ geometry: value, properties: {} }];
  for (const item of list) {
    const feature = item as { geometry?: { type?: string }; properties?: unknown } | null;
    add(feature?.geometry, layerOf(feature?.properties, feature?.geometry?.type ?? "Okänd"));
  }
  // Den gamla `crs`-medlemmen (t.ex. "urn:ogc:def:crs:EPSG::3006"); utan den är GeoJSON WGS 84.
  const named = typeof value?.crs?.properties?.name === "string" ? /EPSG:{1,2}(\d{4,5})$/i.exec(value.crs.properties.name) : null;
  return { features, crs: named ? Number(named[1]) : 4326, skipped };
}

/** DXF i textform: POINT, INSERT och CIRCLE (punkter), LINE, LWPOLYLINE, POLYLINE med VERTEX och SPLINE (anpassningspunkterna). */
export function parseDxf(text: string): SourceData {
  if (text.startsWith("AutoCAD Binary DXF")) throw new VectorParseError("Binär DXF stöds inte; spara som DXF i textform.");
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]!.trim());
    if (!Number.isInteger(code)) throw new VectorParseError("Filen är inte DXF.");
    pairs.push([code, lines[index + 1]!.trim()]);
  }
  const start = pairs.findIndex(([code, value], index) => code === 2 && value === "ENTITIES" && pairs[index - 1]?.[1] === "SECTION");
  if (start < 0) throw new VectorParseError("DXF-filen saknar ENTITIES.");
  const features: SourceFeature[] = [];
  let skipped = 0;
  let index = start + 1;
  // En entitet: från dess 0-kod till nästa.
  const entity = () => {
    const type = pairs[index]![1];
    const body: [number, string][] = [];
    index += 1;
    while (index < pairs.length && pairs[index]![0] !== 0) { body.push(pairs[index]!); index += 1; }
    return { type, body };
  };
  const layerOfBody = (body: [number, string][]) => body.find(([code]) => code === 8)?.[1] || "0";
  const coordinates = (body: [number, string][], xCode: number, yCode: number): Position[] => {
    const result: Position[] = [];
    let x: number | undefined;
    for (const [code, value] of body) {
      if (code === xCode) x = Number(value);
      else if (code === yCode && x !== undefined) { const y = Number(value); if (Number.isFinite(x) && Number.isFinite(y)) result.push([x, y]); x = undefined; }
    }
    return result;
  };
  const flags = (body: [number, string][]) => Number(body.find(([code]) => code === 70)?.[1] ?? 0);
  const elevationOf = (...bodies: ([number, string][] | undefined)[]) => {
    for (const body of bodies) {
      const value = Number(body?.find(([code]) => code === 38)?.[1] ?? body?.find(([code]) => code === 30)?.[1]);
      if (body?.some(([code]) => code === 38 || code === 30) && Number.isFinite(value)) return { elevation: value };
    }
    return {};
  };
  while (index < pairs.length) {
    const [code, value] = pairs[index]!;
    if (code === 0 && value === "ENDSEC") break;
    if (code !== 0) { index += 1; continue; }
    const { type, body } = entity();
    const layer = layerOfBody(body);
    if (type === "POINT" || type === "INSERT" || type === "CIRCLE") {
      const at = coordinates(body, 10, 20)[0];
      if (at) features.push({ layer, geometry: { kind: "point", at } }); else skipped += 1;
    } else if (type === "LINE") {
      const a = coordinates(body, 10, 20)[0], b = coordinates(body, 11, 21)[0];
      if (a && b) features.push({ layer, geometry: { kind: "line", points: [a, b], closed: false } }); else skipped += 1;
    } else if (type === "LWPOLYLINE") {
      const points = coordinates(body, 10, 20);
      if (points.length >= 2) features.push({ layer, geometry: lineOf(points, (flags(body) & 1) === 1), ...elevationOf(body) }); else skipped += 1;
    } else if (type === "SPLINE") {
      const fit = coordinates(body, 11, 21);
      const points = fit.length >= 2 ? fit : coordinates(body, 10, 20);
      if (points.length >= 2) features.push({ layer, geometry: { kind: "line", points, closed: (flags(body) & 1) === 1 } }); else skipped += 1;
    } else if (type === "POLYLINE") {
      const closed = (flags(body) & 1) === 1;
      const points: Position[] = [];
      let first: [number, string][] | undefined;
      while (index < pairs.length && pairs[index]![1] === "VERTEX") {
        const vertex = entity();
        first ??= vertex.body;
        const at = coordinates(vertex.body, 10, 20)[0];
        if (at) points.push(at);
      }
      if (pairs[index]?.[1] === "SEQEND") entity();
      if (points.length >= 2) features.push({ layer, geometry: lineOf(points, closed), ...elevationOf(body, first) }); else skipped += 1;
    } else skipped += 1;
  }
  return { features, skipped };
}
