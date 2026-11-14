import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { SourceFeature } from "../index";
import { marshGeometry } from "./marsh-merge";
import { isSoilWater, type SoilArea } from "./soil";

const { polygonOf, ringArea, boxOf, touches } = marshGeometry;
type Ring = [number, number][];
type Box = ReturnType<typeof boxOf>;

/**
 * Sankmarkens lager som regeln minskar: bara laserns fuktsteg (`blott` 308 och `fuktigt` 310). Lantmäteriets marktäcke
 * (`sankmark_vat`, `sankmark_fast`) är karterad sankmark ur flygbild och är säkrare än jordartskartans 25–200 m; den rörs inte.
 * Fuktreglagets lager är desamma (`SOIL_PANEL_LAYERS`), så kryssrutan där styr samma sak som grundkartan.
 */
export const SOIL_MARSH_LAYERS: ReadonlySet<string> = new Set(["blott", "fuktigt"]);
export const SOIL_PANEL_LAYERS: ReadonlySet<string> = new Set(["blott", "fuktigt"]);
/** Strandkärr inom så här långt från vatten (meter) blir kvar, som i `marsh-merge` och fuktreglaget. */
export const SOIL_WATER_BUFFER_M = 30;
/** Minsta yta (m²) för en rest av sankmark, som fuktreglagets förval. */
export const SOIL_MIN_MARSH_M2 = 400;

export interface SoilMarshOptions {
  /** Lagren som minskas (förval: sankmarkens alla). */
  readonly layers?: ReadonlySet<string> | undefined;
  readonly minAreaM2?: number | undefined;
  /** Kartans egna vattenytor (lagret `vatten`); jordartskartans vatten (kod 91) läggs till. */
  readonly water?: readonly SourceFeature[] | undefined;
  /** Fuktstråken (306) följer med (förval); `false` i fuktreglaget, som bara ger ytor. */
  readonly streams?: boolean | undefined;
}
export interface SoilMarshResult { readonly features: SourceFeature[]; readonly removedHa: number }

const net = (polygon: Polygon) => polygon.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring as Ring), 0);
const near = (a: Box, b: Box, reach: number) => a.minX - reach <= b.maxX && b.minX - reach <= a.maxX && a.minY - reach <= b.maxY && b.minY - reach <= a.maxY;

/** Vattnets kanter som rektanglar (bredd två gånger `reach`, förlängda i ändarna): en grov buffert, nära nog för 30 m. */
function shoreBuffer(rings: readonly (readonly (readonly [number, number])[])[], targets: readonly Box[], reach: number): MultiPolygon {
  const pieces: Polygon[] = [];
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 1) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) continue;
    const box = { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) };
    if (!targets.some(target => near(box, target, reach))) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length, nx = -uy * reach, ny = ux * reach, ex = ux * reach, ey = uy * reach;
    pieces.push([[[ax - ex + nx, ay - ey + ny], [bx + ex + nx, by + ey + ny], [bx + ex - nx, by + ey - ny], [ax - ex - nx, ay - ey - ny], [ax - ex + nx, ay - ey + ny]]]);
  }
  if (pieces.length === 0) return [];
  return polygonClipping.union(pieces[0]!, ...pieces.slice(1));
}

/**
 * Sankmarkens ytor minus torr mark (sand och grus) ur jordartskartan: `difference(sankmark, torr − vattenbuffert)`. Strandkärr
 * inom `SOIL_WATER_BUFFER_M` från vatten (kartans `vatten` och jordartskartans) blir kvar, och rester under minsta ytan tas bort.
 * Ytor som inte rörs behålls som de är. Går en uträkning inte (trasig geometri) lämnas ytan orörd.
 */
export function marshOffDrySoil(features: readonly SourceFeature[], soil: readonly SoilArea[], options: SoilMarshOptions = {}): SoilMarshResult {
  const layers = options.layers ?? SOIL_MARSH_LAYERS, minArea = options.minAreaM2 ?? SOIL_MIN_MARSH_M2;
  const marsh = features.map(feature => ({ feature, polygon: layers.has(feature.layer.toLowerCase()) ? polygonOf(feature) : undefined }))
    .filter((row): row is { feature: SourceFeature; polygon: Polygon } => !!row.polygon).map(row => ({ ...row, box: boxOf(row.polygon) }));
  const streams = options.streams === false ? [] : features.filter(feature => STREAM_LAYER.test(feature.layer) && feature.geometry.kind === "line" && feature.geometry.points.length >= 2)
    .map(feature => ({ feature, box: lineBox((feature.geometry as { points: readonly (readonly [number, number])[] }).points) }));
  const dry = soil.filter(area => area.cls === "dry").map(area => area.rings.map(ring => ring.map(([x, y]) => [x, y] as [number, number])).filter(ring => ring.length >= 4) as Polygon)
    .filter(polygon => polygon.length > 0).map(polygon => ({ polygon, box: boxOf(polygon) }))
    .filter(row => marsh.some(m => touches(m.box, row.box)) || streams.some(line => touches(line.box, row.box)));
  if ((marsh.length === 0 && streams.length === 0) || dry.length === 0) return { features: [...features], removedHa: 0 };
  let effective: { polygon: Polygon; box: Box }[];
  try {
    const waterRings = [...soil.filter(isSoilWater).flatMap(area => area.rings),
      ...(options.water ?? []).flatMap(feature => feature.layer.toLowerCase() === "vatten" ? (polygonOf(feature) ?? []) : [])];
    const buffer = shoreBuffer(waterRings, dry.map(row => row.box), SOIL_WATER_BUFFER_M);
    const united = polygonClipping.union(dry[0]!.polygon, ...dry.slice(1).map(row => row.polygon));
    const rest = buffer.length ? polygonClipping.difference(united, buffer) : united;
    effective = rest.map(polygon => ({ polygon, box: boxOf(polygon) }));
  } catch { return { features: [...features], removedHa: 0 }; }
  const replaced = new Map<SourceFeature, SourceFeature[]>();
  let removed = 0;
  for (const row of marsh) {
    const over = effective.filter(other => touches(row.box, other.box)).map(other => other.polygon);
    if (over.length === 0) continue;
    let pieces: Polygon[];
    try { pieces = polygonClipping.difference(row.polygon, ...over); } catch { continue; }
    const kept = pieces.filter(piece => net(piece) >= minArea);
    const before = net(row.polygon), after = kept.reduce((sum, piece) => sum + net(piece), 0);
    if (pieces.length === 1 && kept.length === 1 && Math.abs(after - before) < 1) continue;
    removed += before - after;
    replaced.set(row.feature, kept.map(piece => ({ layer: row.feature.layer,
      geometry: { kind: "area" as const, rings: piece.map(ring => ring.map(([x, y]) => [x, y] as [number, number])) } })));
  }
  // Ägaren 2026-11-14 («när man tar bort kärr på sandig mark så verkar dikena hänga kvar»): fuktstråken (306) ur samma fuktsteg
  // följer samma torra mark; bitarna utanför den blir kvar om de är minst `SOIL_MIN_STREAM_M` långa.
  for (const row of streams) {
    const over = effective.filter(other => touches(row.box, other.box));
    if (over.length === 0) continue;
    const pieces = streamOutside((row.feature.geometry as { points: readonly (readonly [number, number])[] }).points, over);
    if (pieces.length === 1 && pieces[0]!.whole) continue;
    replaced.set(row.feature, pieces.filter(piece => piece.length >= SOIL_MIN_STREAM_M)
      .map(piece => ({ ...row.feature, geometry: { kind: "line" as const, closed: false, points: piece.points } })));
  }
  return { features: features.flatMap(feature => replaced.get(feature) ?? [feature]), removedHa: Math.round(removed / 100) / 100 };
}

/** Fuktstegets stråk (306): `fuktstrak` ur fukt.dxf och `fuktstrak_terrang`. Diken ur terrängformen (`dike`) rörs inte. */
const STREAM_LAYER = /^fuktstrak/i;
/** Kortaste bit av ett fuktstråk som blir kvar utanför torr mark (m). */
export const SOIL_MIN_STREAM_M = 25;
const STREAM_STEP_M = 4;

function lineBox(points: readonly (readonly [number, number])[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY } as Box;
}

function insidePolygon(polygon: Polygon, x: number, y: number): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Linjens bitar utanför ytorna (punkterna tätade till `STREAM_STEP_M`); `whole` när inget av linjen ligger inne. */
function streamOutside(points: readonly (readonly [number, number])[], over: readonly { polygon: Polygon; box: Box }[]) {
  const dense: [number, number][] = [];
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i]!;
    dense.push([ax, ay]);
    const next = points[i + 1];
    if (!next) break;
    const steps = Math.floor(Math.hypot(next[0] - ax, next[1] - ay) / STREAM_STEP_M);
    for (let s = 1; s < steps; s += 1) dense.push([ax + (next[0] - ax) * s / steps, ay + (next[1] - ay) * s / steps]);
  }
  const dryAt = ([x, y]: readonly [number, number]) => over.some(row => x >= row.box.minX && x <= row.box.maxX && y >= row.box.minY && y <= row.box.maxY && insidePolygon(row.polygon, x, y));
  const dry = dense.map(dryAt);
  if (!dry.some(Boolean)) return [{ points: points.map(([x, y]) => [x, y] as [number, number]), length: Infinity, whole: true }];
  // Ägaren 2026-11-14 («ibland stämmer de kanske, ser ut som att det finns diken åtminstone»): ett grävt dike är rakt. Raka
  // sträckor (minst `STRAIGHT_M` utan att avvika mer än `STRAIGHT_TOLERANCE_M`) blir kvar också på torr mark.
  const keep = dry.map(value => !value);
  for (let start = 0; start < dense.length;) {
    if (!dry[start]) { start += 1; continue; }
    let end = start;
    while (end + 1 < dense.length && dry[end + 1]) end += 1;
    for (const [a, b] of straightSpans(dense, Math.max(0, start - 1), Math.min(dense.length - 1, end + 1))) for (let i = a; i <= b; i += 1) keep[i] = true;
    start = end + 1;
  }
  const pieces: { points: [number, number][]; length: number; whole: boolean }[] = [];
  let current: [number, number][] = [];
  const flush = () => {
    if (current.length >= 2) pieces.push({ points: current, length: current.reduce((sum, p, i) => i === 0 ? 0 : sum + Math.hypot(p[0] - current[i - 1]![0], p[1] - current[i - 1]![1]), 0), whole: false });
    current = [];
  };
  dense.forEach((point, i) => { if (keep[i]) current.push(point); else flush(); });
  flush();
  return pieces;
}

const STRAIGHT_M = 30, STRAIGHT_TOLERANCE_M = 2;
/** De delar av `points[from..to]` som är raka: Douglas–Peucker med toleransen, och sträckor minst `STRAIGHT_M` långa. */
function straightSpans(points: readonly [number, number][], from: number, to: number): [number, number][] {
  const corners = [from, to];
  const split = (a: number, b: number) => {
    const [ax, ay] = points[a]!, [bx, by] = points[b]!, length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1, distance = 0;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs((bx - ax) * (ay - points[i]![1]) - (ax - points[i]![0]) * (by - ay)) / length;
      if (d > distance) { distance = d; worst = i; }
    }
    if (worst >= 0 && distance > STRAIGHT_TOLERANCE_M) { corners.push(worst); split(a, worst); split(worst, b); }
  };
  split(from, to);
  corners.sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < corners.length; i += 1) {
    const a = corners[i]!, b = corners[i + 1]!;
    if (Math.hypot(points[b]![0] - points[a]![0], points[b]![1] - points[a]![1]) >= STRAIGHT_M) spans.push([a, b]);
  }
  return spans;
}
