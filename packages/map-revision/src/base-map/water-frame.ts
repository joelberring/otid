import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { SourceFeature } from "../vector-parse";

/**
 * Ägaren 2026-11-22 (Kungshatt och Järflotta, öar):
 *
 * 1. **En strand, inte två.** Lantmäteriets marktäcke har också vatten. Geo-arbetaren tar bort marktäckets vattenytor vars
 *    kant till största delen ligger vid laserns vatten, men räknar också kantens punkter utanför laserkörningen, så havet blev
 *    ofta kvar två gånger: laserns strand (detaljerad) och marktäckets (grövre). Här tas marktäckets vattenyta bort när minst
 *    `LAND_COVER_OVERLAP` av den delen av ytan som ligger inom körningen täcks av laserns vatten; gölar som lasern missat blir kvar.
 *
 * 2. **Vattnet går ut till kartans ram.** Laserns vatten slutar vid körningens kant, som ofta ligger innanför kartans område
 *    (ramen läggs till efteråt, och utanför körningen finns ingen laser). Där vattnet är avskuret längs körningens kant
 *    fortsätter det rakt ut (`REACH_M`), och resten klipper kartans område bort när kandidaterna räknas om till kartan. Ett
 *    hörn som vattnet täcker fylls också. Strandlinjen ritas inte längs förlängningen (`shoreLines` får ytorna före).
 *
 * Allt i SWEREF 99 TM (meter).
 */
export const LAND_COVER_OVERLAP = 0.3;
const REACH_M = 20_000;
/** Samma som `shoreLines`: punkter så här nära körningens kant ligger på den, och en avskuren sträcka är minst 5 m. */
const EDGE_M = 1.5;
const MIN_CUT_M = 5;

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
type Pair = [number, number];

const closed = (ring: readonly (readonly [number, number])[]): Pair[] => {
  const points = ring.map(([x, y]) => [x, y] as Pair);
  if (points.length && (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])) points.push([...points[0]!]);
  return points;
};
const polygonOf = (feature: SourceFeature): Polygon | undefined =>
  feature.geometry.kind === "area" ? feature.geometry.rings.map(closed).filter(ring => ring.length >= 4) : undefined;
const areaOf = (multi: MultiPolygon) => multi.reduce((sum, polygon) => sum + polygon.reduce((inner, ring, index) => {
  let twice = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) twice += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return inner + (index === 0 ? 1 : -1) * Math.abs(twice) / 2;
}, 0), 0);
const boxPolygon = (box: Box): Polygon => [[[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY], [box.minX, box.minY]]];

/**
 * Marktäckets vattenytor (`landCover`) utan de som laserns vatten (`laser`) redan visar inom körningen (`extent`).
 * Ger listan utan dem; en yta som inte går att räkna (fel i geometrin) blir kvar.
 */
export function withoutDuplicateWater(landCover: readonly SourceFeature[], laser: readonly SourceFeature[], extent: Box | undefined): SourceFeature[] {
  const laserPolygons = laser.flatMap(feature => feature.layer === "vatten" ? [polygonOf(feature)].filter((p): p is Polygon => !!p && p.length > 0) : []);
  if (laserPolygons.length === 0 || !extent) return [...landCover];
  const inside = boxPolygon(extent);
  return landCover.filter(feature => {
    if (feature.layer !== "vatten") return true;
    const polygon = polygonOf(feature);
    if (!polygon || polygon.length === 0) return true;
    try {
      const within = polygonClipping.intersection(polygon, inside), total = areaOf(within);
      if (total <= 0) return true;
      const covered = areaOf(polygonClipping.intersection(within, ...laserPolygons));
      return covered < total * LAND_COVER_OVERLAP;
    } catch { return true; }
  });
}

/** Strimlorna utanför körningens kant där vattnet är avskuret, och hörnen som vattnet täcker. */
function edgeStrips(polygons: readonly Polygon[], extent: Box): Polygon[] {
  const strips: Polygon[] = [];
  const side = ([x, y]: Pair) => (Math.abs(x - extent.minX) <= EDGE_M ? 1 : 0) | (Math.abs(x - extent.maxX) <= EDGE_M ? 2 : 0)
    | (Math.abs(y - extent.minY) <= EDGE_M ? 4 : 0) | (Math.abs(y - extent.maxY) <= EDGE_M ? 8 : 0);
  const corners: [number, Pair, Box][] = [
    [1 | 4, [extent.minX, extent.minY], { minX: extent.minX - REACH_M, minY: extent.minY - REACH_M, maxX: extent.minX, maxY: extent.minY }],
    [2 | 4, [extent.maxX, extent.minY], { minX: extent.maxX, minY: extent.minY - REACH_M, maxX: extent.maxX + REACH_M, maxY: extent.minY }],
    [1 | 8, [extent.minX, extent.maxY], { minX: extent.minX - REACH_M, minY: extent.maxY, maxX: extent.minX, maxY: extent.maxY + REACH_M }],
    [2 | 8, [extent.maxX, extent.maxY], { minX: extent.maxX, minY: extent.maxY, maxX: extent.maxX + REACH_M, maxY: extent.maxY + REACH_M }]
  ];
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring) continue;
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i]!, b = ring[i + 1]!, shared = side(a) & side(b);
      if (!shared || Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_CUT_M) continue;
      const lowY = Math.min(a[1], b[1]), highY = Math.max(a[1], b[1]), lowX = Math.min(a[0], b[0]), highX = Math.max(a[0], b[0]);
      if (shared & 1) strips.push(boxPolygon({ minX: extent.minX - REACH_M, minY: lowY, maxX: extent.minX, maxY: highY }));
      if (shared & 2) strips.push(boxPolygon({ minX: extent.maxX, minY: lowY, maxX: extent.maxX + REACH_M, maxY: highY }));
      if (shared & 4) strips.push(boxPolygon({ minX: lowX, minY: extent.minY - REACH_M, maxX: highX, maxY: extent.minY }));
      if (shared & 8) strips.push(boxPolygon({ minX: lowX, minY: extent.maxY, maxX: highX, maxY: extent.maxY + REACH_M }));
    }
    for (const [, at, box] of corners) {
      if (ring.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) <= EDGE_M * 2)) strips.push(boxPolygon(box));
    }
  }
  return strips;
}

/**
 * Lagret `vatten` förlängt ut från körningens kant (`extent`) där det är avskuret. Övriga objekt orörda. Går ytorna inte att
 * lägga ihop (fel i geometrin) lämnas vattnet som det var.
 */
export function waterToFrame(features: readonly SourceFeature[], extent: Box | undefined): SourceFeature[] {
  if (!extent) return [...features];
  const water = features.filter(feature => feature.layer === "vatten" && feature.geometry.kind === "area");
  const polygons = water.map(polygonOf).filter((p): p is Polygon => !!p && p.length > 0);
  const strips = edgeStrips(polygons, extent);
  if (strips.length === 0) return [...features];
  let joined: MultiPolygon;
  try { joined = polygonClipping.union(polygons[0]!, ...polygons.slice(1), ...strips); } catch { return [...features]; }
  const others = features.filter(feature => !water.includes(feature));
  const template = water[0]!;
  return [...others, ...joined.map((polygon): SourceFeature => ({ ...template, geometry: { kind: "area", rings: polygon.map(ring => ring.slice(0, -1).map(([x, y]) => [x, y] as Pair)) } }))];
}
