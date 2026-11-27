/** Ett hygge ur Skogsstyrelsens utförda avverkningar (`MapProjectClearCut` i kontrakten): ringar i SWEREF 99 TM och avverkningsdatum. */
export interface ClearCut { readonly rings: readonly (readonly (readonly [number, number])[])[]; readonly date: string | null }
import type { SourceFeature } from "../index";
import { maskOutlines } from "./photo-interpret";
import { generalizeVegetation, simplifyClosed, VEG_FOREST, VEG_OPEN, vegetationLayerMask } from "./vegetation-shapes";

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
  fillRingScanline(labels, ring, left, top, columns, rows, CUT_CELL, VEG_OPEN);
  const general = generalizeVegetation(labels, columns, rows, { cellMeters: CUT_CELL, scale: CUT_SCALE, level: CUT_LEVEL });
  const outlines = maskOutlines(vegetationLayerMask(general, columns, rows, VEG_OPEN), columns, rows);
  let best: [number, number][] | undefined, bestArea = 0;
  for (const outline of outlines) {
    // Hörnen i lite större steg än vegetationens: hyggen har raka kanter, och stora hyggens hörn hålls skarpa (ägaren 2026-11-18).
    const smooth = cutOutline(outline);
    if (smooth.length < 3) continue;
    let area = 0;
    for (let i = 0; i < smooth.length; i += 1) { const [ax, ay] = smooth[i]!, [bx, by] = smooth[(i + 1) % smooth.length]!; area += ax * by - bx * ay; }
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = smooth; }
  }
  // Ett litet hygge (under generaliseringens minsta yta) är fortfarande ett hygge: det behåller sin egen kant.
  if (!best) return ring.map(([x, y]) => [x, y]);
  return [...best, best[0]!].map(([column, row]) => [left + column * CUT_CELL, top - row * CUT_CELL]);
}

type Point = [number, number];
/**
 * Raka sidor minst så här långa (celler, 28 m) möts i ett skarpt hörn. Generaliseringen rundar hörnen med ca 25 m radie, så
 * den rundade kanten däremellan får vara upp till 80 m och hörnet ligga upp till 50 m från dess ändar.
 */
const LONG_SIDE = 14, SHORT_RUN = 40, CORNER_REACH = 25, MIN_TURN = Math.PI / 4, MAX_TURN = Math.PI * 3 / 4;

/**
 * Ägaren 2026-11-18: «hyggenas form ska generaliseras i de mindre formerna för att få bort konstiga hack, men det finns ofta raka
 * hörn på större former.» Kanten förenklas; där två raka sidor på minst 28 m (efter rundningen) möts i 45–135° (efter högst 80 m avrundad kant
 * från generaliseringen) läggs hörnet i sidornas skärning och hålls skarpt. Övriga hörn rundas som förut (Chaikin, två varv).
 */
export function cutOutline(outline: readonly Point[]): Point[] {
  const closed = outline.length > 1 && outline[0]![0] === outline[outline.length - 1]![0] && outline[0]![1] === outline[outline.length - 1]![1];
  const simple = simplifyClosed(closed ? outline.slice(0, -1) : outline.slice(), 1.5);
  if (simple.length < 3) return [];
  const { points, sharp } = squaredCorners(simple);
  return roundExcept(points, sharp, 2);
}

/** Hörnen mellan långa raka sidor (i ringens ordning) som skarpa punkter i sidornas skärning. */
export function squaredCorners(ring: readonly Point[]): { points: Point[]; sharp: boolean[] } {
  const n = ring.length, at = (i: number) => ring[((i % n) + n) % n]!;
  const length = (i: number) => Math.hypot(at(i + 1)[0] - at(i)[0], at(i + 1)[1] - at(i)[1]);
  const first = Array.from({ length: n }, (_, i) => i).find(i => length(i) >= LONG_SIDE);
  if (first === undefined) return { points: ring.slice(), sharp: ring.map(() => false) };
  // Vriden så att den första långa sidan blir den sista (n − 1): ingen följd av korta sidor går då runt index 0.
  const rotated = Array.from({ length: n }, (_, i) => at(i + first + 1));
  const side = (i: number) => Math.hypot(rotated[(i + 1) % n]![0] - rotated[i]![0], rotated[(i + 1) % n]![1] - rotated[i]![1]);
  const long = Array.from({ length: n }, (_, i) => i).filter(i => side(i) >= LONG_SIDE);
  const corners = new Map<number, { to: number; point: Point }>();
  for (let k = 0; k < long.length; k += 1) {
    const a = k === 0 ? long[long.length - 1]! : long[k - 1]!, b = long[k]!;
    if (a === b) continue;
    const from = (a + 1) % n, to = b; // hörnpunkterna from..to (inga varv runt 0)
    if (to < from) continue;
    const a0 = rotated[a]!, a1 = rotated[(a + 1) % n]!, b0 = rotated[b]!, b1 = rotated[(b + 1) % n]!;
    const ux = a1[0] - a0[0], uy = a1[1] - a0[1], vx = b1[0] - b0[0], vy = b1[1] - b0[1];
    const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy))));
    if (turn < MIN_TURN || turn > MAX_TURN) continue;
    let run = 0;
    for (let i = from; i < to; i += 1) run += side(i);
    if (run > SHORT_RUN) continue;
    const cross = ux * vy - uy * vx;
    // Den rundade kanten svänger hela vägen åt samma håll som hörnet (ett hack eller en udde däremellan ger inget hörn).
    let bends = true;
    for (let i = from; i <= to && bends; i += 1) {
      const p0 = rotated[(i - 1 + n) % n]!, p1 = rotated[i]!, p2 = rotated[(i + 1) % n]!;
      const bend = ((p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]))
        / (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1);
      // Små vickningar (under ca 10°) åt andra hållet är förenklingens och räknas inte.
      if (bend * Math.sign(cross) < -0.17) bends = false;
    }
    if (!bends) continue;
    const t = ((b0[0] - a0[0]) * vy - (b0[1] - a0[1]) * vx) / cross;
    const point: Point = [a0[0] + ux * t, a0[1] + uy * t];
    if (Math.hypot(point[0] - rotated[from]![0], point[1] - rotated[from]![1]) > CORNER_REACH
      || Math.hypot(point[0] - rotated[to]![0], point[1] - rotated[to]![1]) > CORNER_REACH) continue;
    corners.set(from, { to, point });
  }
  const points: Point[] = [], sharp: boolean[] = [];
  for (let i = 0; i < n; i += 1) {
    const corner = corners.get(i);
    if (corner) { points.push(corner.point); sharp.push(true); i = corner.to; continue; }
    points.push(rotated[i]!); sharp.push(false);
  }
  return { points, sharp };
}

/** Chaikin för en sluten ring där de skarpa punkterna står kvar (sidorna intill dem förblir raka). */
function roundExcept(ring: readonly Point[], sharp: readonly boolean[], rounds: number): Point[] {
  let points = ring.slice(), flags = sharp.slice();
  for (let round = 0; round < rounds; round += 1) {
    const next: Point[] = [], nextFlags: boolean[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]!;
      if (flags[i]) { next.push(p); nextFlags.push(true); continue; }
      const prev = points[(i - 1 + points.length) % points.length]!, after = points[(i + 1) % points.length]!;
      next.push([p[0] * 0.75 + prev[0] * 0.25, p[1] * 0.75 + prev[1] * 0.25], [p[0] * 0.75 + after[0] * 0.25, p[1] * 0.75 + after[1] * 0.25]);
      nextFlags.push(false, false);
    }
    points = next; flags = nextFlags;
  }
  return points;
}

/** Scanline-fyllning av `ring` i kolumn-major-rastret `labels` med exakt paritet mot `inside(ring, x, y)`. */
export function fillRingScanline(labels: Uint8Array, ring: Ring, left: number, top: number, columns: number, rows: number, cell: number, fillValue: number) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const y = ring[i]![1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const firstRow = Math.max(0, Math.floor((top - maxY) / cell - 0.5));
  const lastRow = Math.min(rows - 1, Math.ceil((top - minY) / cell - 0.5));
  const xs: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = top - (row + 0.5) * cell;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y)) xs.push((xj - xi) * (y - yi) / (yj - yi) + xi);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = xs[k]!, xEnd = xs[k + 1]!;
      let start = Math.max(0, Math.ceil((xStart - left) / cell - 0.5));
      let end = Math.min(columns - 1, Math.ceil((xEnd - left) / cell - 0.5) - 1);
      // Exakt flyttalsjustering mot `x = left + (col + 0.5) * cell` så pariteten mot `x < cx` är bitexakt.
      while (start > 0 && left + (start - 0.5) * cell >= xStart) start -= 1;
      while (start < columns && left + (start + 0.5) * cell < xStart) start += 1;
      while (end + 1 < columns && left + (end + 1.5) * cell < xEnd) end += 1;
      while (end >= 0 && left + (end + 0.5) * cell >= xEnd) end -= 1;
      for (let column = start; column <= end; column += 1) labels[column * rows + row] = fillValue;
    }
  }
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
  const cuts = afterScan.map(ring => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { ring, minX, minY, maxX, maxY };
  });
  return features.filter(feature => {
    if (!VEGETATION.test(feature.layer)) return true;
    const ring = feature.geometry.kind === "area" ? feature.geometry.rings[0] : feature.geometry.kind === "line" ? feature.geometry.points : undefined;
    if (!ring?.length) return true;
    const x = ring.reduce((sum, point) => sum + point[0], 0) / ring.length, y = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return !cuts.some(cut => x >= cut.minX && x <= cut.maxX && y >= cut.minY && y <= cut.maxY && inside(cut.ring, x, y));
  });
}
