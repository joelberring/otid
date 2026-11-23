import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { geodeticToGrid, mapPointToWgs84, transverseMercatorFor, type MapGeoreference, type MapObject, type Point } from "@o-tid/map-file";
import { samplePoints, type SourceData, type SourceFeature } from "../index";
import { highwayOf, sprintPaved, tidyRing, unionAll } from "./sprint-osm";

/**
 * PLAN K4c Huvudkälla (ägaren 2026-11-23: «gör så»). En inläst vektorfil (t.ex. Stockholms baskarta som DXF) kan vara
 * kartprojektets huvudkälla inom sitt område för de slag den täcker (hus, vägar, järnväg, broar, vatten, murar, staket).
 * Då hoppar grundkartan över OpenStreetMaps objekt av de slagen där (`osmOutsidePrimary`, i `mergeBaseMap`), och läses
 * filen in efter grundkartan föreslås OpenStreetMaps orörda objekt av de slagen inom området för borttagning (`osmRemovals`).
 * OpenStreetMaps stigar, lasern, marktäcket och vegetationen påverkas aldrig.
 */
export const PRIMARY_KINDS = ["buildings", "roads", "railway", "bridges", "water", "walls", "fences"] as const;
export type PrimaryKind = (typeof PRIMARY_KINDS)[number];

type Ring = readonly Point[];
/** Täckningsområdet i kartans mm: ytor (yttre ring först, sedan hål) som inte överlappar varandra. */
export type PrimaryArea = readonly (readonly Ring[])[];

/** Slaget för ett symbolnummer (hus 521/522, vägar 501–503 på sprint och 502–504 i skog, järnväg 509, bro 512, vatten 301–304, mur 513–515, staket 516–518). */
export function primaryKindOfCode(code: string, sprint: boolean): PrimaryKind | undefined {
  const main = Number(code.replace(/\.0+$/, "").split(".")[0]);
  if (main === 521 || main === 522) return "buildings";
  if (sprint ? main >= 501 && main <= 503 : main >= 501 && main <= 504) return "roads";
  if (main === 509) return "railway";
  if (main === 512) return "bridges";
  if (main >= 301 && main <= 304) return "water";
  if (main >= 513 && main <= 515) return "walls";
  if (main >= 516 && main <= 518) return "fences";
  return undefined;
}

/** Slagen som symbolerna täcker, i fast ordning. */
export function primaryKinds(codes: Iterable<string>, sprint: boolean): PrimaryKind[] {
  const found = new Set<PrimaryKind>();
  for (const code of codes) { const kind = primaryKindOfCode(code, sprint); if (kind) found.add(kind); }
  return PRIMARY_KINDS.filter(kind => found.has(kind));
}

/** Rutor med högst så många celler per sida; större områden får större celler. */
const MAX_CELLS = 200;
/** Fler punkter än så i täckningen blir ett konvext hölje i stället (det sparas i databasen). */
const MAX_AREA_POINTS = 5000;
const round = (value: number) => Math.round(value * 100) / 100;

function hull(points: readonly Point[]): Point[] {
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y), out: Point[] = [];
  for (const pass of [sorted, [...sorted].reverse()]) {
    const start = out.length;
    for (const point of pass) {
      while (out.length >= start + 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
  }
  return out;
}

const toPolygon = (rings: readonly Ring[]): Polygon => rings.filter(ring => ring.length >= 3).map(ring => [...ring.map(p => [p.x, p.y] as [number, number]), [ring[0]!.x, ring[0]!.y] as [number, number]]);
const fromMulti = (multi: MultiPolygon): PrimaryArea => multi.map(polygon => polygon.map(ring => tidyRing(ring)).filter(ring => ring.length >= 3)
  .map(ring => ring.map(([x, y]) => ({ x: round(x), y: round(y) })))).filter(polygon => polygon.length > 0);
const pointCount = (area: PrimaryArea) => area.reduce((sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0), 0);

/**
 * Filens täckningsområde: rutorna (`cellMm`, vidgade en ruta åt alla håll) där filens objekt ligger, sammanslagna och klippta mot
 * kartans område (`clip`, ringar i mm). Enkelt och robust före exakt: en sned eller oregelbunden fil ger inte hela sin ruta.
 */
export function coverageArea(objects: readonly MapObject[], options: { readonly cellMm: number; readonly clip?: readonly Ring[] | undefined }): PrimaryArea {
  const points = objects.flatMap(object => samplePoints(object, Math.max(0.1, options.cellMm / 2)));
  if (points.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cell = Math.max(options.cellMm, (maxX - minX) / MAX_CELLS, (maxY - minY) / MAX_CELLS, 0.01);
  const x0 = minX - cell, y0 = minY - cell;
  const cols = Math.ceil((maxX - x0) / cell) + 2, rows = Math.ceil((maxY - y0) / cell) + 2;
  const marked = new Uint8Array(cols * rows);
  for (const { x, y } of points) {
    const col = Math.floor((x - x0) / cell), row = Math.floor((y - y0) / cell);
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const c = col + dc, r = row + dr;
      if (c >= 0 && r >= 0 && c < cols && r < rows) marked[r * cols + c] = 1;
    }
  }
  // Rutorna radvis som rektanglar (sammanhängande rutor i en rad blir en), sedan sammanslagna.
  const pieces: Polygon[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!marked[row * cols + col]) continue;
      const start = col;
      while (col + 1 < cols && marked[row * cols + col + 1]) col += 1;
      const ax = round(x0 + start * cell), bx = round(x0 + (col + 1) * cell), ay = round(y0 + row * cell), by = round(y0 + (row + 1) * cell);
      pieces.push([[[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]]]);
    }
  }
  let union: MultiPolygon = unionAll(pieces);
  const clip = options.clip ? toPolygon(options.clip) : undefined;
  const clipped = (multi: MultiPolygon): MultiPolygon => {
    if (!clip || clip.length === 0) return multi;
    try { return polygonClipping.intersection(multi, clip); } catch { return multi; }
  };
  union = clipped(union);
  const area = fromMulti(union);
  if (pointCount(area) <= MAX_AREA_POINTS) return area;
  const shell = hull(points);
  return fromMulti(clipped([[[...shell.map(p => [p.x, p.y] as [number, number]), [shell[0]!.x, shell[0]!.y]]]]));
}

/** Ligger punkten i området (jämn–udda över alla ringar, så att hål är hål)? */
export function insideArea(rings: readonly (readonly (readonly [number, number])[])[], x: number, y: number): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
const ringsOf = (area: PrimaryArea) => area.flatMap(polygon => polygon.map(ring => ring.map(p => [p.x, p.y] as const)));

/** En huvudkälla som grundkartan använder: namnet, slagen och området i SWEREF 99 TM (alla ringar, jämn–udda). */
export interface PrimaryForMerge { readonly name: string; readonly kinds: readonly PrimaryKind[]; readonly rings: readonly (readonly [number, number])[][] }

/** Huvudkällans område (kartans mm) i SWEREF 99 TM, som grundkartan räknar i. */
export function primaryForMerge(source: { readonly name: string; readonly kinds: readonly PrimaryKind[]; readonly area: PrimaryArea }, georeference: MapGeoreference): PrimaryForMerge | undefined {
  const projection = transverseMercatorFor(3006);
  if (!projection) return undefined;
  const rings = source.area.flatMap(polygon => polygon.map(ring => ring.map(point => {
    const at = mapPointToWgs84(georeference, point), grid = geodeticToGrid(projection, at.latitude, at.longitude);
    return [grid.easting, grid.northing] as [number, number];
  })));
  return rings.every(ring => ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) ? { name: source.name, kinds: source.kinds, rings } : undefined;
}

/** OpenStreetMaps lager → slaget (`sprint`: belagda vägar och gångytor blir belagd yta, så de räknas som vägar). Stigar har inget slag. */
export function osmKindOf(feature: SourceFeature, sprint: boolean): PrimaryKind | undefined {
  const { layer } = feature;
  if (/^OSM (byggnad|skärmtak)/.test(layer)) return "buildings";
  if (layer === "OSM järnväg") return "railway";
  if (layer === "OSM mur" || layer === "OSM stödmur") return "walls";
  if (layer === "OSM staket") return "fences";
  if (sprint) {
    if (/^OSM (gångyta|parkering)/.test(layer)) return "roads";
    const highway = feature.geometry.kind === "line" ? highwayOf(feature) : undefined;
    return highway && highway !== "steps" && sprintPaved(highway, feature.properties ?? {}) ? "roads" : undefined;
  }
  return /^OSM (väg \(|traktorväg)/.test(layer) ? "roads" : undefined;
}

type XY = readonly [number, number];
/** Var sträckan a–b korsar ringarnas kanter (andelar 0–1, sorterade). */
function crossings(rings: readonly (readonly XY[])[], a: XY, b: XY): number[] {
  const out: number[] = [];
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const c = ring[j]!, d = ring[i]!;
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (den === 0) continue;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    if (t > 0 && t < 1 && u >= 0 && u < 1) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

/** Linjens bitar utanför området: `projected` är punkterna i områdets system, `points` de som skrivs ut (samma antal). */
function piecesOutside(points: readonly XY[], projected: readonly XY[], rings: readonly (readonly XY[])[]): { pieces: [number, number][][]; cut: boolean } {
  const pieces: [number, number][][] = [];
  let current: [number, number][] = [], cut = false;
  const lerp = (p: XY, q: XY, t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  for (let index = 1; index < points.length; index += 1) {
    const a = projected[index - 1]!, b = projected[index]!, p = points[index - 1]!, q = points[index]!;
    const stops = [0, ...crossings(rings, a, b), 1];
    for (let k = 1; k < stops.length; k += 1) {
      const t0 = stops[k - 1]!, t1 = stops[k]!, mid = lerp(a, b, (t0 + t1) / 2);
      if (insideArea(rings, mid[0], mid[1])) { cut = true; if (current.length >= 2) pieces.push(current); current = []; continue; }
      if (current.length === 0) current.push(lerp(p, q, t0));
      current.push(lerp(p, q, t1));
    }
  }
  if (current.length >= 2) pieces.push(current);
  return { pieces, cut };
}

/** Det som grundkartan hoppade över inom en huvudkälla: källans namn, slagen och antalet av OpenStreetMaps objekt. */
export interface PrimaryOutcome { readonly name: string; readonly kinds: readonly PrimaryKind[]; readonly removed: number }

/**
 * OpenStreetMap (som hämtat, WGS 84, eller i SWEREF 99 TM) utan objekten av huvudkällornas slag inom deras områden: hus och
 * punkter med mitten i området tas bort, linjer klipps så att bitarna utanför blir kvar. Görs före sprintens belagda ytor och
 * tomterna kring husen, så att också det som räknas fram ur OpenStreetMap följer.
 */
export function osmOutsidePrimary(osm: SourceData, primary: readonly PrimaryForMerge[], sprint: boolean): { data: SourceData; outcomes: PrimaryOutcome[] } {
  const relevant = primary.filter(source => source.kinds.length > 0 && source.rings.length > 0);
  if (relevant.length === 0) return { data: osm, outcomes: [] };
  const projection = osm.crs === undefined || osm.crs === 4326 ? transverseMercatorFor(3006) : undefined;
  const project = (point: XY): XY => { if (!projection) return point; const grid = geodeticToGrid(projection, point[1], point[0]); return [grid.easting, grid.northing]; };
  const removed = relevant.map(() => 0);
  const features: SourceFeature[] = [];
  for (const feature of osm.features) {
    const kind = osmKindOf(feature, sprint);
    const sources = kind ? relevant.map((source, index) => ({ source, index })).filter(row => row.source.kinds.includes(kind)) : [];
    if (sources.length === 0) { features.push(feature); continue; }
    const { geometry } = feature;
    if (geometry.kind === "line") {
      const whole = geometry.points.map(([x, y]) => [x, y] as [number, number]);
      let pieces: [number, number][][] = [geometry.closed && whole[0] ? [...whole, whole[0]] : whole], anyCut = false;
      for (const { source, index } of sources) {
        const next: [number, number][][] = [];
        let cut = false;
        for (const piece of pieces) { const out = piecesOutside(piece, piece.map(project), source.rings); next.push(...out.pieces); cut ||= out.cut; }
        if (cut) { removed[index]! += 1; anyCut = true; }
        pieces = next;
      }
      if (!anyCut) { features.push(feature); continue; }
      for (const points of pieces) features.push({ ...feature, geometry: { kind: "line", points, closed: false } });
      continue;
    }
    const ring = geometry.kind === "point" ? [geometry.at] : geometry.rings[0] ?? [];
    const center = project([ring.reduce((sum, p) => sum + p[0], 0) / Math.max(1, ring.length), ring.reduce((sum, p) => sum + p[1], 0) / Math.max(1, ring.length)]);
    const hit = sources.find(({ source }) => insideArea(source.rings, center[0], center[1]));
    if (hit) removed[hit.index]! += 1; else features.push(feature);
  }
  return { data: { ...osm, features }, outcomes: relevant.map((source, index) => ({ name: source.name, kinds: source.kinds, removed: removed[index]! })).filter(row => row.removed > 0) };
}

/** Ett utkasts lager som det sparades (0132): lagret, symbolens nummer och om det lades in. */
export interface DecisionLayer { readonly layer: string; readonly symbol: string | null; readonly accepted: boolean }
const OSM_LAYER = /^(OSM |tomtmark_osm$)/;
/**
 * Symbolnumren som i ett inlagt utkast bara fick objekt ur OpenStreetMaps lager: objekten med de symbolerna kom från
 * OpenStreetMap. Fick en symbol objekt också ur ett annat lager (laserns belagda yta, Lantmäteriets hus) går det inte att avgöra.
 */
export function osmOnlyCodes(layers: readonly DecisionLayer[]): string[] {
  const bySymbol = new Map<string, boolean>();
  for (const layer of layers) {
    if (!layer.accepted || !layer.symbol) continue;
    const code = layer.symbol.replace(/\.0+$/, "");
    bySymbol.set(code, (bySymbol.get(code) ?? true) && OSM_LAYER.test(layer.layer));
  }
  return [...bySymbol].filter(([, osm]) => osm).map(([code]) => code).sort();
}

/** Kartobjekt som ett utkast lade in och som ingen ändrat sedan (`keys`), med symbolnumren som bara kom ur OpenStreetMap (`codes`). */
export interface OsmOrigin { readonly codes: readonly string[]; readonly keys: readonly string[] }

/**
 * Urvalet när huvudkällan läses in efter grundkartan: kartans objekt av huvudkällans slag med minst hälften inom området, som
 * kom från OpenStreetMap och inte ändrats (`origin`). Övriga av de slagen inom området räknas (`kept`: egenritade, ändrade
 * eller med okänt ursprung); `exclude` är det som just lades in.
 */
export function osmRemovals(input: { readonly objects: readonly { readonly key: string; readonly code: string; readonly object: MapObject }[];
  readonly origin: readonly OsmOrigin[]; readonly area: PrimaryArea; readonly kinds: readonly PrimaryKind[]; readonly sprint: boolean;
  readonly exclude?: ReadonlySet<string> | undefined; readonly stepMm?: number | undefined }): { remove: string[]; kept: number } {
  const rings = ringsOf(input.area);
  const fromOsm = new Map<string, Set<string>>();
  for (const decision of input.origin) for (const key of decision.keys) {
    const codes = fromOsm.get(key) ?? new Set<string>();
    for (const code of decision.codes) codes.add(code);
    fromOsm.set(key, codes);
  }
  const remove: string[] = [];
  let kept = 0;
  for (const { key, code, object } of input.objects) {
    const kind = primaryKindOfCode(code, input.sprint);
    if (!kind || !input.kinds.includes(kind) || input.exclude?.has(key)) continue;
    const points = samplePoints(object, input.stepMm ?? 1);
    const inside = points.filter(point => insideArea(rings, point.x, point.y)).length;
    if (points.length === 0 || inside * 2 < points.length) continue;
    if (fromOsm.get(key)?.has(code.replace(/\.0+$/, ""))) remove.push(key); else kept += 1;
  }
  return { remove, kept };
}
