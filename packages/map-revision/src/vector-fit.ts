import type { MapObject, MapSymbol, Path, Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-10: "Passa in mot kartan" för ett vektorunderlag som hamnar nästan rätt (okänd förskjutning, lite vridet
 * eller annan skala). Underlagets och kartans hus, vägar och strandlinjer görs till punkter längs linjerna, en klass per sort;
 * först letas den förskjutning där flest punkter träffar, sedan förfinas förskjutning, vridning och skala (ICP med en
 * sluten likformig lösning, Umeyama) på de par som ligger nära. Allt i kartans mm.
 */

/** Sorterna som jämförs (ISOM/ISSprOM-nummer): hus, vägar och stigar, vatten, murar och staket, järnväg och kraftledning. */
export type FitClass = "building" | "road" | "water" | "barrier" | "rail";

export function fitClassOf(main: number): FitClass | undefined {
  if (main === 521 || main === 526) return "building";
  if (main >= 501 && main <= 508 || main === 529 || main === 531) return "road";
  if (main >= 301 && main <= 306) return "water";
  if (main === 513 || main === 515 || main === 516 || main === 518 || main === 519) return "barrier";
  if (main === 509 || main === 510 || main === 511) return "rail";
  return undefined;
}

export interface FitPoint { readonly at: Point; readonly kind: FitClass }

export interface VectorFit {
  /** p' = scale · R(rotation) · p + (dx, dy); rotation i grader moturs. */
  readonly scale: number; readonly rotation: number; readonly dx: number; readonly dy: number;
  /** Medianen av avståndet för paren efter inpassningen (mm) och hur stor del av underlagets punkter som har ett par inom 1 mm. */
  readonly medianMm: number; readonly share: number; readonly pairs: number;
}


export function applyFit(fit: VectorFit, point: Point): Point {
  const r = fit.rotation * Math.PI / 180, c = Math.cos(r) * fit.scale, s = Math.sin(r) * fit.scale;
  return { x: c * point.x - s * point.y + fit.dx, y: s * point.x + c * point.y + fit.dy };
}

/** Punkter längs en väg var `step` mm (raka linjer mellan ändpunkterna; kurvornas styrpunkter tas inte med). */
export function samplePath(path: Path, step: number): Point[] {
  const out: Point[] = [];
  let last: Point | undefined;
  for (const command of path) {
    const at = { x: command.x, y: command.y };
    if (command.type === "M" || !last) { out.push(at); last = at; continue; }
    const length = Math.hypot(at.x - last.x, at.y - last.y);
    const n = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= n; k++) out.push({ x: last.x + (at.x - last.x) * k / n, y: last.y + (at.y - last.y) * k / n });
    last = at;
  }
  return out;
}

/** Kartans objekt som punkter per sort (linjer och ytornas kanter), högst `max` punkter. */
export function mapFitPoints(objects: readonly MapObject[], symbols: ReadonlyMap<string, MapSymbol>, step = 1, max = 40_000): FitPoint[] {
  const out: FitPoint[] = [];
  for (const object of objects) {
    const kind = fitClassOf(symbols.get(object.symbol)?.code.main ?? 0);
    if (!kind) continue;
    const paths = object.kind === "line" ? [object.path] : object.kind === "area" ? object.rings : [];
    for (const path of paths) for (const at of samplePath(path, step)) out.push({ at, kind });
  }
  return thin(out, max);
}

function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const every = points.length / max;
  return Array.from({ length: max }, (_, index) => points[Math.floor(index * every)]!);
}

/** Rutnät för närmaste punkt av samma sort. */
class Grid {
  private readonly cells = new Map<string, Point[]>();
  constructor(points: readonly FitPoint[], private readonly size: number) {
    for (const { at, kind } of points) {
      const key = this.key(kind, Math.floor(at.x / size), Math.floor(at.y / size));
      const cell = this.cells.get(key);
      if (cell) cell.push(at); else this.cells.set(key, [at]);
    }
  }
  private key(kind: string, i: number, j: number) { return `${kind}:${i}:${j}`; }
  /** Närmaste punkt inom `radius` (högst rutnätets storlek), eller undefined. */
  nearest(kind: FitClass, at: Point, radius: number): { at: Point; distance: number } | undefined {
    const i = Math.floor(at.x / this.size), j = Math.floor(at.y / this.size);
    let best: { at: Point; distance: number } | undefined;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const point of this.cells.get(this.key(kind, i + di, j + dj)) ?? []) {
        const distance = Math.hypot(point.x - at.x, point.y - at.y);
        if (distance <= radius && (!best || distance < best.distance)) best = { at: point, distance };
      }
    }
    return best;
  }
}

/** Likformig transform (skala, vridning, förskjutning) som för `from` närmast `to` i minstakvadratmening (Umeyama i 2D). */
function similarity(from: readonly Point[], to: readonly Point[], allowScale: boolean) {
  const n = from.length;
  let fx = 0, fy = 0, tx = 0, ty = 0;
  for (let k = 0; k < n; k++) { fx += from[k]!.x; fy += from[k]!.y; tx += to[k]!.x; ty += to[k]!.y; }
  fx /= n; fy /= n; tx /= n; ty /= n;
  let a = 0, b = 0, variance = 0;
  for (let k = 0; k < n; k++) {
    const px = from[k]!.x - fx, py = from[k]!.y - fy, qx = to[k]!.x - tx, qy = to[k]!.y - ty;
    a += px * qx + py * qy; b += px * qy - py * qx; variance += px * px + py * py;
  }
  const angle = Math.atan2(b, a);
  const scale = allowScale && variance > 0 ? Math.hypot(a, b) / variance : 1;
  const c = Math.cos(angle) * scale, s = Math.sin(angle) * scale;
  return { scale, rotation: angle * 180 / Math.PI, dx: tx - (c * fx - s * fy), dy: ty - (s * fx + c * fy) };
}

export interface FitOptions {
  /** Längst så här långt (mm) letas förskjutningen i första steget. */
  readonly searchMm?: number;
  /** Längst så här mycket (grader) vridet letas i första steget (16° täcker en missvisning åt fel håll). */
  readonly rotationDeg?: number;
  readonly allowScale?: boolean;
}

/**
 * Inpassningen av `source` (underlaget i kartans mm) mot `target` (kartan). Undefined när för få punkter träffar (då passar
 * underlaget inte kartan, eller ligger längre bort än `searchMm`).
 */
export function fitToMap(source: readonly FitPoint[], target: readonly FitPoint[], options: FitOptions = {}): VectorFit | undefined {
  const searchMm = options.searchMm ?? 40;
  const rotationDeg = options.rotationDeg ?? 16;
  const allowScale = options.allowScale ?? true;
  const from = thin([...source], 3000);
  if (from.length < 10 || target.length < 10) return undefined;
  const grid = new Grid(target, 2);
  // Först utan vridning (det vanliga: en förskjutning och kanske en liten vridning som ICP tar). Räcker inte det prövas
  // vridningar var 2:a grad inom ±rotationDeg, och den som passar bäst gäller.
  const plain = refine(from, grid, coarse(from, grid, 0, searchMm, 300, 2).transform, allowScale);
  if (plain && plain.share >= 0.5) return plain;
  // Passar det inte bra utan vridning: vridningen ur linjernas riktningar (histogram över riktningarna, båda filerna; toppen
  // i korrelationen inom ±rotationDeg), sedan samma sök som ovan. Ett stadsrutnät kan passa på fel ställe också, men sämre.
  let best = plain;
  for (const degrees of rotationCandidates(source, target, rotationDeg)) {
    const fit = refine(from, grid, coarse(from, grid, degrees, searchMm, 300, 2).transform, allowScale);
    if (fit && (!best || fit.share > best.share + 0.02)) best = fit;
  }
  return best;
}

/** Riktningarnas histogram (halva grader, 0–180°) för punkter i följd längs linjerna, viktat med längden. */
function directions(points: readonly FitPoint[]): Float64Array {
  const bins = new Float64Array(360);
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!.at, b = points[k]!.at;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0 || length > 3 || points[k - 1]!.kind !== points[k]!.kind) continue;
    let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (angle < 0) angle += 180;
    bins[Math.floor(angle * 2) % 360]! += length;
  }
  return bins;
}

/** De två vridningarna (grader, inte 0) där riktningarna stämmer bäst överens. */
function rotationCandidates(source: readonly FitPoint[], target: readonly FitPoint[], limit: number): number[] {
  const a = directions(source), b = directions(target);
  const scores: { degrees: number; score: number }[] = [];
  for (let shift = -limit * 2; shift <= limit * 2; shift++) {
    let score = 0;
    for (let k = 0; k < 360; k++) score += a[k]! * b[(k + shift + 360) % 360]!;
    scores.push({ degrees: shift / 2, score });
  }
  const peaks = scores.filter((entry, index) => (scores[index - 1]?.score ?? -1) <= entry.score && (scores[index + 1]?.score ?? -1) <= entry.score)
    .sort((x, y) => y.score - x.score).map(entry => entry.degrees).filter(degrees => Math.abs(degrees) >= 1.5);
  return peaks.slice(0, 2);
}

type Transform = { scale: number; rotation: number; dx: number; dy: number };
const asFit = (transform: Transform): VectorFit => ({ ...transform, medianMm: 0, share: 0, pairs: 0 });

/** Den förskjutning (vid en given vridning kring underlagets mitt) där flest punkter i ett urval träffar kartan. */
function coarse(from: readonly FitPoint[], grid: Grid, degrees: number, searchMm: number, size: number, step: number)
  : { transform: Transform; hits: number } {
  const cx = from.reduce((sum, point) => sum + point.at.x, 0) / from.length;
  const cy = from.reduce((sum, point) => sum + point.at.y, 0) / from.length;
  const r = degrees * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
  // Vridningen kring mitten som transform kring origo; förskjutningen läggs till.
  const base = { scale: 1, rotation: degrees, dx: cx - (c * cx - sn * cy), dy: cy - (sn * cx + c * cy) };
  const sample = thin([...from], size).map(point => ({ kind: point.kind, at: applyFit(asFit(base), point.at) }));
  const hits = (dx: number, dy: number, radius: number) => sample.reduce((count, point) =>
    grid.nearest(point.kind, { x: point.at.x + dx, y: point.at.y + dy }, radius) ? count + 1 : count, 0);
  let best = { dx: 0, dy: 0, hits: hits(0, 0, 1.5) };
  for (let dx = -searchMm; dx <= searchMm; dx += step) for (let dy = -searchMm; dy <= searchMm; dy += step) {
    const count = hits(dx, dy, 1.5);
    if (count > best.hits) best = { dx, dy, hits: count };
  }
  const centre = best;
  for (let dx = centre.dx - 2; dx <= centre.dx + 2; dx += 0.5) for (let dy = centre.dy - 2; dy <= centre.dy + 2; dy += 0.5) {
    const count = hits(dx, dy, 1);
    if (count > best.hits) best = { dx, dy, hits: count };
  }
  return { transform: { ...base, dx: base.dx + best.dx, dy: base.dy + best.dy }, hits: best.hits };
}

/** ICP från en start: paren inom ett avstånd som krymper från 3 till 0,8 mm, ny likformig transform varje varv; sedan kvaliteten. */
function refine(from: readonly FitPoint[], grid: Grid, start: Transform, allowScale: boolean): VectorFit | undefined {
  let fit = start;
  for (let round = 0; round < 40; round++) {
    const radius = Math.max(0.8, 3 - round * 0.1);
    const pairsFrom: Point[] = [], pairsTo: Point[] = [];
    for (const point of from) {
      const hit = grid.nearest(point.kind, applyFit(asFit(fit), point.at), radius);
      if (hit) { pairsFrom.push(point.at); pairsTo.push(hit.at); }
    }
    if (pairsFrom.length < 10) return undefined;
    const next = similarity(pairsFrom, pairsTo, allowScale);
    const settled = Math.abs(next.dx - fit.dx) < 0.001 && Math.abs(next.dy - fit.dy) < 0.001 && Math.abs(next.rotation - fit.rotation) < 0.0001;
    fit = next;
    if (settled && radius === 0.8) break;
  }
  const distances: number[] = [];
  for (const point of from) {
    const hit = grid.nearest(point.kind, applyFit(asFit(fit), point.at), 2);
    if (hit) distances.push(hit.distance);
  }
  distances.sort((a, b) => a - b);
  const share = distances.filter(distance => distance <= 1).length / from.length;
  if (distances.length < 10 || share < 0.15) return undefined;
  const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
  return { scale: round(fit.scale, 6), rotation: round(fit.rotation, 4), dx: round(fit.dx, 3), dy: round(fit.dy, 3),
    medianMm: round(distances[Math.floor(distances.length / 2)]!, 3), share: round(share, 3), pairs: distances.length };
}
