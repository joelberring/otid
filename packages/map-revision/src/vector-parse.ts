import { arcEntity, bulgedPoints, hatchAreas, splineEntity } from "./dxf-curves";

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): GeoJSON och DXF (text) läses till objekt per lager i källans koordinater. Inget
 * ritas här; lagren mappas till symboler och räknas om till kartans mm i `vector-import.ts`. DWG läses senare i geo-arbetaren.
 */
export type SourceGeometry =
  /** `toward`: en punkt som symbolen ska peka mot (t.ex. lutningsstreckets nedförsriktning). */
  | { readonly kind: "point"; readonly at: readonly [number, number]; readonly toward?: readonly [number, number] | undefined }
  | { readonly kind: "line"; readonly points: readonly (readonly [number, number])[]; readonly closed: boolean }
  | { readonly kind: "area"; readonly rings: readonly (readonly (readonly [number, number])[])[] };
/** `elevation`: höjden i meter när filen anger den (DXF:s kod 38 eller z i första punkten), t.ex. för höjdkurvor. */
export interface SourceFeature { readonly layer: string; readonly geometry: SourceGeometry; readonly elevation?: number | undefined;
  /** GeoJSON-objektets egenskaper, bara när läsningen ber om dem (`parseGeoJson(text, { properties: true })`). */
  readonly properties?: Readonly<Record<string, unknown>> | undefined }
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

/**
 * Egenskaperna som ger lagret, i den ordningen (stora och små bokstäver spelar ingen roll). Har objektet både `objekttyp` och
 * `undertyp` (Stockholms baskarta som GeoJSON eller Shape: «Markanläggning» + «Staket») blir lagret båda, «Markanläggning
 * Staket»: objekttypen ensam slår ihop staket, slänt och stödmur till ett lager som inte kan få en symbol (prov på
 * Älvsjö–Solberga 2026-11-13).
 */
export const LAYER_PROPERTIES = ["layer", "lager", "objekttyp", "obkod", "detaljtyp", "type", "kind", "class"];
export function layerOf(properties: unknown, fallback: string): string {
  if (properties && typeof properties === "object") {
    const byName = new Map(Object.entries(properties as Record<string, unknown>).map(([name, value]) => [name.toLowerCase(), value]));
    for (const name of LAYER_PROPERTIES) {
      const value = byName.get(name);
      if (!((typeof value === "string" && value.trim()) || typeof value === "number")) continue;
      const text = String(value).trim(), sub = name === "objekttyp" ? byName.get("undertyp") : undefined;
      const detail = typeof sub === "string" ? sub.trim() : "";
      return (detail && detail.toLowerCase() !== text.toLowerCase() ? `${text} ${detail}` : text).slice(0, 120);
    }
  }
  return fallback;
}

const MAX_COLLECTION_DEPTH = 8;

/** GeoJSON: en FeatureCollection, en Feature eller en geometri. Lagret ur egenskaper som `layer` eller `objekttyp`, annars typen. */
export function parseGeoJson(text: string, options: { readonly properties?: boolean } = {}): SourceData {
  let root: unknown;
  try { root = JSON.parse(text) as unknown; } catch { throw new VectorParseError("Filen är inte GeoJSON."); }
  const features: SourceFeature[] = [];
  let skipped = 0;
  const add = (geometry: unknown, layer: string, properties?: Readonly<Record<string, unknown>>, depth = 0) => {
    const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
    if (!g || typeof g !== "object") { skipped += 1; return; }
    const push = (item: SourceGeometry) => features.push(properties ? { layer, geometry: item, properties } : { layer, geometry: item });
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
      case "GeometryCollection":
        // Samlingar i samlingar används inte i praktiken; en djup nästling vore bara ett sätt att ta slut på stacken.
        if (depth >= MAX_COLLECTION_DEPTH) { skipped += 1; return; }
        for (const part of Array.isArray(g.geometries) ? g.geometries : []) add(part, layer, properties, depth + 1);
        return;
      default: skipped += 1;
    }
  };
  const value = root as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown; crs?: { properties?: { name?: unknown } } };
  const list = value?.type === "FeatureCollection" ? value.features ?? [] : value?.type === "Feature" ? [value] : [{ geometry: value, properties: {} }];
  for (const item of list) {
    const feature = item as { geometry?: { type?: string }; properties?: unknown } | null;
    add(feature?.geometry, layerOf(feature?.properties, feature?.geometry?.type ?? "Okänd"),
      options.properties && feature?.properties && typeof feature.properties === "object" ? feature.properties as Record<string, unknown> : undefined);
  }
  // Den gamla `crs`-medlemmen (t.ex. "urn:ogc:def:crs:EPSG::3006"); utan den är GeoJSON WGS 84.
  const named = typeof value?.crs?.properties?.name === "string" ? /EPSG:{1,2}(\d{4,5})$/i.exec(value.crs.properties.name) : null;
  return { features, crs: named ? Number(named[1]) : 4326, skipped };
}

/**
 * DXF i textform: POINT, INSERT och CIRCLE (punkter), LINE, ARC, LWPOLYLINE och POLYLINE med VERTEX (bågarna i hörnens bulge
 * utplattade), SPLINE (anpassningspunkterna eller De Boor-evaluerad B-spline) och HATCH (gränsvägarna som ytor, med hål;
 * `dxf-curves.ts`). Läser rader med indexskanning (`indexOf("\n")`) utan full-fils `split` eller par-array över hela filen.
 */
export function parseDxf(text: string): SourceData {
  if (text.startsWith("AutoCAD Binary DXF")) throw new VectorParseError("Binär DXF stöds inte; spara som DXF i textform.");
  const len = text.length;
  let pos = 0, eof = false;
  const nextLine = (): string | undefined => {
    if (eof) return undefined;
    const nl = text.indexOf("\n", pos);
    if (nl < 0) {
      eof = true;
      const end = len > pos && text.charCodeAt(len - 1) === 13 ? len - 1 : len;
      return text.slice(pos, end);
    }
    const end = nl > pos && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    const line = text.slice(pos, end);
    pos = nl + 1;
    return line;
  };
  const nextPair = (): [number, string] | undefined => {
    const codeLine = nextLine();
    if (codeLine === undefined) return undefined;
    const valueLine = nextLine();
    if (valueLine === undefined) return undefined;
    const code = Number(codeLine.trim());
    if (!Number.isInteger(code)) throw new VectorParseError("Filen är inte DXF.");
    return [code, valueLine.trim()];
  };
  // Hoppa fram till SECTION / ENTITIES utan att spara föregående sektioner i minnet.
  let foundEntities = false;
  let prevValue = "";
  for (;;) {
    const pair = nextPair();
    if (!pair) break;
    if (pair[0] === 2 && pair[1] === "ENTITIES" && prevValue === "SECTION") { foundEntities = true; break; }
    prevValue = pair[1];
  }
  if (!foundEntities) throw new VectorParseError("DXF-filen saknar ENTITIES.");
  const features: SourceFeature[] = [];
  let skipped = 0;
  let lookahead = nextPair();
  // En entitet: från dess 0-kod till nästa.
  const entity = () => {
    const type = lookahead![1];
    const body: [number, string][] = [];
    lookahead = nextPair();
    while (lookahead && lookahead[0] !== 0) {
      body.push(lookahead);
      lookahead = nextPair();
    }
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
  // LWPOLYLINE:s hörn med buktighet (42 efter hörnets 10/20); inget när ingen sträcka buktar (det vanliga, och snabbare).
  const bulged = (body: [number, string][], closed: boolean): Position[] | undefined => {
    if (!body.some(([code, value]) => code === 42 && Number(value) !== 0)) return undefined;
    const vertices: { at: Position; bulge: number }[] = [];
    let x: number | undefined;
    for (const [code, value] of body) {
      if (code === 10) x = Number(value);
      else if (code === 20 && x !== undefined) { const y = Number(value); if (Number.isFinite(x) && Number.isFinite(y)) vertices.push({ at: [x, y], bulge: 0 }); x = undefined; }
      else if (code === 42 && vertices.length) vertices[vertices.length - 1]!.bulge = Number(value) || 0;
    }
    return bulgedPoints(vertices, closed);
  };
  const flags = (body: [number, string][]) => Number(body.find(([code]) => code === 70)?.[1] ?? 0);
  const elevationOf = (...bodies: ([number, string][] | undefined)[]) => {
    for (const body of bodies) {
      const value = Number(body?.find(([code]) => code === 38)?.[1] ?? body?.find(([code]) => code === 30)?.[1]);
      if (body?.some(([code]) => code === 38 || code === 30) && Number.isFinite(value)) return { elevation: value };
    }
    return {};
  };
  while (lookahead) {
    const [code, value] = lookahead;
    if (code === 0 && value === "ENDSEC") break;
    if (code !== 0) { lookahead = nextPair(); continue; }
    const { type, body } = entity();
    const layer = layerOfBody(body);
    if (type === "POINT" || type === "INSERT" || type === "CIRCLE") {
      const at = coordinates(body, 10, 20)[0];
      if (!at) { skipped += 1; continue; }
      // DXF-grupp 50 på POINT/INSERT: vinkel i grader moturs från öster (+X), t.ex. avlång punkthöjd (`dotknoll_avlang`, 110).
      // Kodas som `toward` precis som `elongatedKnoll`, så att både symbolvinkeln och kartans meridiankonvergens följer med.
      const anglePair = type === "CIRCLE" ? undefined : body.find(([c]) => c === 50);
      const deg = anglePair ? Number(anglePair[1]) : Number.NaN;
      if (Number.isFinite(deg)) {
        const rad = deg * Math.PI / 180;
        features.push({ layer, geometry: { kind: "point", at, toward: [at[0] + Math.sin(rad) * 5, at[1] - Math.cos(rad) * 5] } });
      } else {
        features.push({ layer, geometry: { kind: "point", at } });
      }
    } else if (type === "LINE") {
      const a = coordinates(body, 10, 20)[0], b = coordinates(body, 11, 21)[0];
      if (a && b) features.push({ layer, geometry: { kind: "line", points: [a, b], closed: false } }); else skipped += 1;
    } else if (type === "ARC") {
      const points = arcEntity(body);
      if (points) features.push({ layer, geometry: { kind: "line", points, closed: false } }); else skipped += 1;
    } else if (type === "HATCH") {
      const areas = hatchAreas(body);
      for (const rings of areas) features.push({ layer, geometry: { kind: "area", rings } });
      if (areas.length === 0) skipped += 1;
    } else if (type === "LWPOLYLINE") {
      const closed = (flags(body) & 1) === 1;
      const points = bulged(body, closed) ?? coordinates(body, 10, 20);
      if (points.length >= 2) features.push({ layer, geometry: lineOf(points, closed), ...elevationOf(body) }); else skipped += 1;
    } else if (type === "SPLINE") {
      const points = splineEntity(body);
      if (points.length >= 2) features.push({ layer, geometry: { kind: "line", points, closed: (flags(body) & 1) === 1 } }); else skipped += 1;
    } else if (type === "POLYLINE") {
      const closed = (flags(body) & 1) === 1;
      let points: Position[] = [];
      const bulges: number[] = [];
      let first: [number, string][] | undefined;
      while (lookahead && lookahead[0] === 0 && lookahead[1] === "VERTEX") {
        const vertex = entity();
        first ??= vertex.body;
        const at = coordinates(vertex.body, 10, 20)[0];
        if (at) { points.push(at); bulges.push(Number(vertex.body.find(([c]) => c === 42)?.[1] ?? 0) || 0); }
      }
      if (lookahead && lookahead[0] === 0 && lookahead[1] === "SEQEND") entity();
      if (bulges.some(bulge => bulge !== 0)) points = bulgedPoints(points.map((at, k) => ({ at, bulge: bulges[k]! })), closed);
      if (points.length >= 2) features.push({ layer, geometry: lineOf(points, closed), ...elevationOf(body, first) }); else skipped += 1;
    } else skipped += 1;
  }
  return { features, skipped };
}
