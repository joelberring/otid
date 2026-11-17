/** Ett hygge ur Skogsstyrelsens utförda avverkningar (`MapProjectClearCut` i kontrakten): ringar i SWEREF 99 TM och avverkningsdatum. */
export interface ClearCut { readonly rings: readonly (readonly (readonly [number, number])[])[]; readonly date: string | null }
import type { SourceFeature } from "../index";
import { maskOutlines } from "./photo-interpret";
import { generalizeVegetation, VEG_FOREST, VEG_OPEN, vegetationLayerMask, vegetationRing } from "./vegetation-shapes";

/**
 * Ägaren 2026-11-11 («gör beräkningar beroende på hur gamla fotona/underlaget är … om hyggen är helt färska eller hunnit växa
 * upp och blivit sly»): Skogsstyrelsens hyggen delas in efter hur gamla de är i dag.
 *
 * - yngre än `fresh` år: färskt hygge (`hygge_farskt`, 403 ödemark; ägaren 2026-11-12: «sällan starkt gula utan ljusgul eller
 *   ljusgul med vita prickar»)
 * - till `scrub` år: sly och plantor under midjehöjd: ödemark (`hygge_sly_mark`, 403) med undervegetation ovanpå (`hygge_sly`,
 *   407). Normen räknar hyggen och plantor under cirka 1 m till 403 och låter 407 kombineras med den; rastret ensamt på vitt
 *   skulle läsas som skog med undervegetation.
 * - till `young` år: tät ungskog (`hygge_ungskog`, 406 löphindrande)
 * - äldre: lasern visar skogen som den är; hygget tas inte med.
 *
 * Lasern går före åldern: är skanningen nyare än avverkningen ser lasern hur öppet, glest (404) eller tätt det är i dag, så
 * hygget tas då inte med alls (ägaren 2026-11-17: «gränserna är hackiga … ska helst inte användas om inget annat data finns»).
 *
 * Ett hygge som är yngre än laserskanningen (eller när skanningens datum saknas) tas med. Kanten kommer ur Skogsstyrelsens
 * skillnadsanalys av satellitbilder i 10 m-rutor och är full av trappsteg och hack; den generaliseras som vegetationen
 * (`cutRing`: små hack och uddar bort, rundade hörn) innan den blir yta och tydlig vegetationsgräns (`bestandsgrans`, 416).
 * Laserns vegetation inne i hygget tas bort i grundkartan (`afterScan`), eftersom skogen där står kvar i lasern. Åldrarna är
 * grova; tillväxten skiljer sig mellan norr och söder och mellan marker.
 */
export interface ClearCutAges { readonly fresh: number; readonly scrub: number; readonly young: number }
export const DEFAULT_CLEAR_CUT_AGES: ClearCutAges = { fresh: 3, scrub: 8, young: 15 };
type Ring = readonly (readonly [number, number])[];

const years = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000);

export function clearCutFeatures(cuts: readonly ClearCut[], today: string, scannedAt: string | null, ages: ClearCutAges = DEFAULT_CLEAR_CUT_AGES, borders = true)
  : { features: SourceFeature[]; afterScan: Ring[]; counts: Readonly<Record<"fresh" | "scrub" | "young", number>> } {
  const features: SourceFeature[] = [], afterScan: Ring[] = [];
  const counts = { fresh: 0, scrub: 0, young: 0 };
  for (const cut of cuts) {
    if (!cut.date || !cut.rings[0]) continue;
    const age = years(cut.date, today);
    if (!(age >= 0) || age >= ages.young) continue;
    const kind = age < ages.fresh ? "fresh" : age < ages.scrub ? "scrub" : "young";
    counts[kind] += 1;
    const layer = kind === "fresh" ? "hygge_farskt" : kind === "scrub" ? "hygge_sly" : "hygge_ungskog";
    // Lasern är nyare än avverkningen: den visar hygget som det är i dag, och Skogsstyrelsens hackiga kant behövs inte.
    if (scannedAt && cut.date <= scannedAt) continue;
    const ring = cutRing(cut.rings[0]);
    if (!ring) continue;
    const rings = [ring];
    if (kind === "scrub") features.push({ layer: "hygge_sly_mark", geometry: { kind: "area", rings } });
    features.push({ layer, geometry: { kind: "area", rings } });
    if (borders) features.push({ layer: "bestandsgrans", geometry: { kind: "line", closed: true, points: ring.slice(0, -1) } });
    if (scannedAt) afterScan.push(ring);
  }
  return { features, afterScan, counts };
}

/**
 * Cellen (m) som hyggets kant generaliseras i, läget (som vegetationens, 1–10) och skalan generaliseringen räknas för. Skalan
 * är satt så att minsta bredden blir 12 m: Skogsstyrelsens kant går i 10 m-rutor, och hack och uddar på en ruta ska bort
 * oavsett kartans skala.
 */
const CUT_CELL = 2, CUT_LEVEL = 5, CUT_SCALE = 30_000;

/**
 * Hyggets yttre ring (SWEREF 99 TM, sluten) generaliserad: rastrerad i 2 m-celler, smala hack, uddar och små fläckar bort och
 * kanten rundad (`generalizeVegetation`, som öppen mark mot skog), sedan som en ritad kurva. Den största ringen behålls.
 * Ger undefined om hygget blir för litet.
 */
export function cutRing(ring: Ring): [number, number][] | undefined {
  if (ring.length < 4) return undefined;
  const margin = 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const left = minX - margin, top = maxY + margin;
  const columns = Math.ceil((maxX - minX + 2 * margin) / CUT_CELL), rows = Math.ceil((maxY - minY + 2 * margin) / CUT_CELL);
  if (columns * rows > 4_000_000) return ring.map(([x, y]) => [x, y]);
  const labels = new Uint8Array(columns * rows).fill(VEG_FOREST);
  for (let column = 0; column < columns; column += 1) {
    const x = left + (column + 0.5) * CUT_CELL;
    for (let row = 0; row < rows; row += 1) if (inside(ring, x, top - (row + 0.5) * CUT_CELL)) labels[column * rows + row] = VEG_OPEN;
  }
  const general = generalizeVegetation(labels, columns, rows, { cellMeters: CUT_CELL, scale: CUT_SCALE, level: CUT_LEVEL });
  const outlines = maskOutlines(vegetationLayerMask(general, columns, rows, VEG_OPEN), columns, rows);
  let best: [number, number][] | undefined, bestArea = 0;
  for (const outline of outlines) {
    // Hörnen i lite större steg än vegetationens: hyggen har raka kanter.
    const smooth = vegetationRing(outline, 1.5, 2);
    if (smooth.length < 3) continue;
    let area = 0;
    for (let i = 0; i < smooth.length; i += 1) { const [ax, ay] = smooth[i]!, [bx, by] = smooth[(i + 1) % smooth.length]!; area += ax * by - bx * ay; }
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = smooth; }
  }
  return best && [...best, best[0]!].map(([column, row]) => [left + column * CUT_CELL, top - row * CUT_CELL]);
}

function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const VEGETATION = /^(oppen_mark|oppen_mark_laser|gron_|undervegetation_)/;
/** Laserns vegetationsytor vars mitt ligger i ett hygge som är yngre än skanningen tas bort (skogen där är avverkad). */
export function withoutCutVegetation(features: readonly SourceFeature[], afterScan: readonly Ring[]): SourceFeature[] {
  if (!afterScan.length) return [...features];
  return features.filter(feature => {
    if (!VEGETATION.test(feature.layer)) return true;
    const ring = feature.geometry.kind === "area" ? feature.geometry.rings[0] : feature.geometry.kind === "line" ? feature.geometry.points : undefined;
    if (!ring?.length) return true;
    const x = ring.reduce((sum, point) => sum + point[0], 0) / ring.length, y = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return !afterScan.some(cut => inside(cut, x, y));
  });
}
