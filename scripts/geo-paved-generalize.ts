/**
 * Generalisering av de belagda ytornas ringar (ägaren 2026-11-13: «linjer ska generaliseras så att vägkanter upplevs som
 * jämna/raka där det är så, och parkeringsplatser m.m. har ofta en hyfsat rektangulär form»). Ringen är maskens utjämnade
 * kant (geo-paved-contour.ts) och görs om så här:
 *
 * 1. Kanten förenklas (Douglas–Peucker, 1 m).
 * 2. Rätvinklighet: ligger minst 70 % av kantlängden inom 12° från två mot varandra vinkelräta huvudriktningar (den
 *    längdviktade vanligaste kantriktningen modulo 90°) vrids de kanterna till exakt huvudriktningen eller dess normal, och
 *    hörnen räknas om som skärningar (de rundade hörnens korta sneda kanter tas bort). En kant som skulle flyttas mer än
 *    2 m av vridningen lämnas. Svängda gator och ett helt gatunät uppfyller inte villkoret och behåller den jämna kanten.
 * 3. Kompakta små ytor (under 2 500 m², minst 0,8 av sin minsta omskrivna rektangel) blir den rektangeln, krympt lika
 *    mycket på alla sidor till ytans area.
 * 4. Skydd: ändras arean mer än 15 %, korsar ringen sig själv, får den färre än fyra punkter eller hamnar ett hörn längre
 *    än 5 m från den förenklade kanten, förkastas ringen: rektangeln först, sedan den rätvinkliga, och då gäller den
 *    förenklade ringen från steg 1.
 *
 * Hål generaliseras på samma sätt (ringens riktning behålls). En tidigare variant (Douglas–Peucker 2 m och raka sträckor på
 * rasterkantens trappsteg) gav taggiga kanter på Bandhagen–Hagsätra och är borttagen. Ren funktion, bara Nodes egna moduler.
 */
type Point = [number, number];
type Ring = readonly (readonly [number, number])[];

export interface PavedGeneralizeSettings {
  /** Steg 1: förenklingens tolerans (m). */
  readonly tolerance: number;
  /** Steg 2: största vinkel från huvudriktningen (grader), minsta andel av kantlängden och största flytt av en kant (m). */
  readonly angleDegrees: number; readonly angleShare: number; readonly maxTurnShift: number;
  /** Steg 2: två kanter i följd med samma riktning inom så här många meter är en kant, och sneda kanter kortare än `shortEdge` (m) mellan två vridna är ett rundat hörn. */
  readonly mergeDistance: number; readonly shortEdge: number;
  /** Steg 3: största yta (m²) och minsta fyllnadsgrad mot den omskrivna rektangeln. */
  readonly compactAreaM2: number; readonly compactFill: number;
  /** Steg 4: största ändring av arean (andel) och största avstånd från den förenklade kanten (m). */
  readonly maxAreaChange: number; readonly maxMove: number;
}
export const DEFAULT_PAVED_GENERALIZE: PavedGeneralizeSettings = { tolerance: 1, angleDegrees: 12, angleShare: 0.7, maxTurnShift: 2, mergeDistance: 1.5, shortEdge: 15,
  compactAreaM2: 2500, compactFill: 0.8, maxAreaChange: 0.15, maxMove: 5 };

/** Ringens yta med tecken (moturs positiv). */
export const signedArea = (ring: Ring) => ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;
const distanceToSegment = ([px, py]: readonly [number, number], [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]) => {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
/** Avståndet från punkten till ringens kant. */
export const distanceToRing = (point: readonly [number, number], ring: Ring) =>
  ring.reduce((best, from, i) => Math.min(best, distanceToSegment(point, from, ring[(i + 1) % ring.length]!)), Infinity);

/** Douglas–Peucker på en öppen följd: indexen som behålls (alltid första och sista). */
function keptIndexes(points: Ring, tolerance: number): number[] {
  const keep = new Uint8Array(points.length), stack: [number, number][] = [[0, points.length - 1]];
  keep[0] = 1; keep[points.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = tolerance, index = -1;
    for (let i = a + 1; i < b; i += 1) { const d = distanceToSegment(points[i]!, points[a]!, points[b]!); if (d > worst) { worst = d; index = i; } }
    if (index >= 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return [...keep.keys()].filter(i => keep[i]);
}

/** Steg 1 för en sluten ring (utan upprepad slutpunkt): ringen delas i sin första punkt och den som ligger längst bort, och varje halva förenklas. */
export function simplifyRing(ring: Ring, tolerance: number): Point[] {
  const n = ring.length, copy = (index: number): Point => [ring[index]![0], ring[index]![1]];
  if (n < 4) return [...ring.keys()].map(copy);
  let far = 1;
  for (let i = 2; i < n; i += 1) if (Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]) > Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])) far = i;
  const first = keptIndexes(ring.slice(0, far + 1), tolerance), second = keptIndexes([...ring.slice(far), ring[0]!], tolerance).map(i => i + far);
  return [...first, ...second.slice(1, -1)].map(copy);
}

interface Line { readonly at: Point; readonly dir: Point }
const project = ([x, y]: readonly [number, number], { at, dir }: Line): Point => {
  const along = (x - at[0]) * dir[0] + (y - at[1]) * dir[1];
  return [at[0] + along * dir[0], at[1] + along * dir[1]];
};
const cross = (a: Line, b: Line) => a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
function intersection(a: Line, b: Line): Point | undefined {
  const denominator = cross(a, b);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = ((b.at[0] - a.at[0]) * b.dir[1] - (b.at[1] - a.at[1]) * b.dir[0]) / denominator;
  return [a.at[0] + t * a.dir[0], a.at[1] + t * a.dir[1]];
}
/** Minsta vinkel (sinus) mellan två linjer för att deras skärning ska gälla som hörn: 20°. */
const CORNER_SIN = Math.sin(20 * Math.PI / 180);

/** Huvudriktningen (radianer, 0–90°): den längdviktade vanligaste kantriktningen modulo 90°, och andelen kantlängd inom `degrees` från den. */
export function mainDirection(ring: Ring, degrees: number): { angle: number; share: number } {
  const bins = new Float64Array(90), edges = ring.map((from, i) => {
    const to = ring[(i + 1) % ring.length]!, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const angle = ((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI) % 90 + 90) % 90;
    bins[Math.floor(angle) % 90] = bins[Math.floor(angle) % 90]! + length;
    return { angle, length };
  });
  let peak = 0, best = -1;
  for (let i = 0; i < 90; i += 1) {
    let sum = 0;
    for (let d = -3; d <= 3; d += 1) sum += bins[(i + d + 90) % 90]!;
    if (sum > best) { best = sum; peak = i + 0.5; }
  }
  const off = (angle: number, from: number) => ((angle - from + 135) % 90 + 90) % 90 - 45;
  let total = 0, near = 0, weighted = 0;
  for (const edge of edges) {
    total += edge.length;
    if (Math.abs(off(edge.angle, peak)) <= degrees) { near += edge.length; weighted += edge.length * off(edge.angle, peak); }
  }
  const main = near > 0 ? peak + weighted / near : peak;
  let share = 0;
  for (const edge of edges) if (Math.abs(off(edge.angle, main)) <= degrees) share += edge.length;
  return { angle: ((main % 90 + 90) % 90) * Math.PI / 180, share: total > 0 ? share / total : 0 };
}

/** Steg 2: kanterna nära huvudriktningen eller dess normal vrids dit, och hörnen räknas om. Inget när villkoret inte är uppfyllt. */
function squareUp(ring: Ring, settings: PavedGeneralizeSettings): Point[] | undefined {
  const main = mainDirection(ring, settings.angleDegrees);
  if (main.share < settings.angleShare) return undefined;
  const limit = settings.angleDegrees * Math.PI / 180;
  let edges = ring.map((from, i) => {
    const to = ring[(i + 1) % ring.length]!, length = Math.hypot(to[0] - from[0], to[1] - from[1]), angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    // Närmaste av huvudriktningen och dess tre vridningar om 90°.
    const snappedAngle = main.angle + Math.round((angle - main.angle) / (Math.PI / 2)) * Math.PI / 2, turn = Math.abs(angle - snappedAngle);
    const snapped = length > 0 && turn <= limit && length / 2 * Math.sin(turn) <= settings.maxTurnShift;
    const used = snapped ? snappedAngle : angle;
    return { at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as Point, dir: [Math.cos(used), Math.sin(used)] as Point, length, snapped, end: [to[0], to[1]] as Point,
      tip: [to[0], to[1]] as Point };
  }).filter(edge => edge.length > 0);
  // En kort sned kant mellan två vridna kanter är ett rundat hörn: den tas bort och hörnet blir grannarnas skärning.
  // Det gäller också flera korta sneda kanter i följd, så länge de tillsammans är kortare än en rak sträcka.
  const first = edges.findIndex(edge => edge.snapped);
  if (first < 0) return undefined;
  const kept: typeof edges = [];
  let loose: typeof edges = [];
  for (let k = 0; k <= edges.length; k += 1) {
    const edge = edges[(first + k) % edges.length]!;
    if (!edge.snapped) { loose.push(edge); continue; }
    if (loose.reduce((sum, row) => sum + row.length, 0) >= settings.shortEdge) kept.push(...loose);
    else if (loose.length) {
      // Det rundade hörnets yttersta punkt i kantens riktning: där slutar en gata vars ände är rundad (se hörnen nedan).
      const last = kept[kept.length - 1]!, along = (point: Point) => point[0] * last.dir[0] + point[1] * last.dir[1];
      for (const row of loose) if (along(row.end) > along(last.tip)) last.tip = row.end;
    }
    loose = [];
    if (k < edges.length) kept.push(edge);
  }
  edges = kept;
  // Två kanter räcker när de är en gatas två sidor (ändarna får sina hörn nedan).
  if (edges.length < 2) return undefined;
  // Två vridna kanter i följd med samma riktning och nästan samma läge är en kant.
  for (let merged = true; merged && edges.length > 2;) {
    merged = false;
    for (let i = 0; i < edges.length && edges.length > 2; i += 1) {
      const a = edges[i]!, j = (i + 1) % edges.length, b = edges[j]!;
      if (!a.snapped || !b.snapped || a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] < 0.99) continue;
      const offset = (b.at[0] - a.at[0]) * a.dir[1] - (b.at[1] - a.at[1]) * a.dir[0];
      if (Math.abs(offset) > settings.mergeDistance) continue;
      const length = a.length + b.length;
      edges[i] = { ...a, at: [(a.at[0] * a.length + b.at[0] * b.length) / length, (a.at[1] * a.length + b.at[1] * b.length) / length], length, end: b.end, tip: b.tip };
      edges = edges.filter((_, index) => index !== j);
      merged = true; break;
    }
  }
  return edges.flatMap((edge, i): Point[] => {
    const next = edges[(i + 1) % edges.length]!;
    if (Math.abs(cross(edge, next)) >= CORNER_SIN) return [intersection(edge, next)!];
    // Nästan parallella: ett trappsteg mellan två vridna kanter får två hörn; annars behålls det gamla hörnet.
    // Mellan två motriktade kanter (en gatas ände) ligger hörnen vid det rundade hörnets yttersta punkt.
    return edge.snapped && next.snapped ? [project(edge.tip, edge), project(edge.tip, next)] : [edge.end];
  });
}

/** Den minsta omskrivna rektangeln (prövad i varje kants riktning): hörnen moturs och arean. */
export function boundingRectangle(ring: Ring): { corners: Point[]; area: number } | undefined {
  let best: { corners: Point[]; area: number } | undefined;
  ring.forEach((from, i) => {
    const to = ring[(i + 1) % ring.length]!, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) return;
    const ux = (to[0] - from[0]) / length, uy = (to[1] - from[1]) / length;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of ring) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area) return;
    const at = (u: number, v: number): Point => [u * ux - v * uy, u * uy + v * ux];
    best = { corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)], area };
  });
  return best;
}

const segmentsCross = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]) => {
  const side = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) for (let j = i + 2; j < n; j += 1) {
    if (i === 0 && j === n - 1) continue;
    if (segmentsCross(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return true;
  }
  return false;
}

/** Steg 4: varför den generaliserade ringen inte duger (mot den förenklade ringen och rasterringens area), eller inget. */
export function pavedRingProblem(candidate: Ring, simplified: Ring, area: number, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE): string | undefined {
  if (candidate.length < 4) return "färre än fyra punkter";
  if (candidate.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return "ogiltig punkt";
  if (Math.abs(Math.abs(signedArea(candidate)) - Math.abs(area)) > settings.maxAreaChange * Math.abs(area)) return "arean ändras för mycket";
  if (selfIntersects(candidate)) return "ringen korsar sig själv";
  if (candidate.some(point => distanceToRing(point, simplified) > settings.maxMove)) return "ett hörn hamnar för långt bort";
  return undefined;
}

/**
 * En ring ur maskens utjämnade kant (öppen, utan upprepad slutpunkt; moturs eller medurs) generaliserad. `problem` säger
 * varför skydden valde den förenklade ringen i stället. Utan `shapes` görs bara förenklingen (steg 1).
 */
export function generalizePavedRingDetailed(ring: Ring, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE, shapes = true): { ring: Point[]; problem?: string | undefined } {
  const clockwise = signedArea(ring) < 0, turned = clockwise ? [...ring].reverse() : ring, area = signedArea(turned);
  const back = (points: readonly (readonly [number, number])[]) => (clockwise ? [...points].reverse() : points).map(([x, y]): Point => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  const simplified = simplifyRing(turned, settings.tolerance);
  if (!shapes || simplified.length < 4) return { ring: back(simplified) };
  const squared = squareUp(simplified, settings);
  // Kandidaterna, den mest generaliserade först: rektangeln (steg 3), sedan den rätvinkliga (steg 2). Den första som klarar skydden gäller.
  const candidates: Point[][] = squared ? [squared] : [];
  if (area < settings.compactAreaM2) {
    const box = boundingRectangle(squared ?? simplified);
    if (box && box.area > 0 && area / box.area >= settings.compactFill) {
      // Rektangeln krymps lika många meter på alla sidor (inte i proportion: en lång gata ska inte bli kortare än bred).
      const [p0, p1, p2, p3] = box.corners as [Point, Point, Point, Point], length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), breadth = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      const inset = (length + breadth - Math.sqrt((length - breadth) ** 2 + 4 * area)) / 4;
      const ux = (p1[0] - p0[0]) / length * inset, uy = (p1[1] - p0[1]) / length * inset, vx = (p3[0] - p0[0]) / breadth * inset, vy = (p3[1] - p0[1]) / breadth * inset;
      candidates.unshift([[p0[0] + ux + vx, p0[1] + uy + vy], [p1[0] - ux + vx, p1[1] - uy + vy], [p2[0] - ux - vx, p2[1] - uy - vy], [p3[0] + ux - vx, p3[1] + uy - vy]]);
    }
  }
  let problem: string | undefined;
  for (const candidate of candidates) {
    problem = pavedRingProblem(candidate, simplified, area, settings);
    if (!problem) return { ring: back(candidate) };
  }
  return { ring: back(simplified), problem };
}

export const generalizePavedRing = (ring: Ring, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE, shapes = true): [number, number][] =>
  generalizePavedRingDetailed(ring, settings, shapes).ring;
