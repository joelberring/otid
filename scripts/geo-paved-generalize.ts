/**
 * Generalisering av de belagda ytornas ringar (ägaren 2026-11-13: «linjer ska generaliseras så att vägkanter upplevs som
 * jämna/raka där det är så, och parkeringsplatser m.m. har ofta en hyfsat rektangulär form»). Ringen kommer ur ett raster
 * (trappsteg i 2 m-celler, geo-paved.ts) och görs om i fem steg:
 *
 * 1. Rasterkanten förenklas (Douglas–Peucker, ungefär en cell), så att långa kanter blir en sträcka.
 * 2. Raka sträckor: följder av hörn där rasterkantens punkter ligger inom 1,5 m från en rät linje över minst 10 m ersätts
 *    av linjen (minsta kvadrat-anpassad till rasterkantens punkter, inte bara första–sista hörnet). Två sträckor som möts
 *    får sitt hörn i linjernas skärning.
 * 3. Rätvinklighet: ligger minst 70 % av kantlängden inom 12° från två mot varandra vinkelräta huvudriktningar (den
 *    längdviktade vanligaste kantriktningen modulo 90°) vrids de kanterna till exakt huvudriktningen eller dess normal, och
 *    hörnen räknas om som skärningar. En kant som skulle flyttas mer än 2 m av vridningen lämnas. Svängda gator uppfyller
 *    inte villkoret och behåller steg 1–2.
 * 4. Kompakta små ytor (under 2 500 m², minst 0,8 av sin minsta omskrivna rektangel) blir den rektangeln, krympt kring sin
 *    mittpunkt till ytans area.
 * 5. Skydd: ändras arean mer än 15 %, korsar ringen sig själv, får den färre än fyra punkter eller hamnar ett hörn längre
 *    än 5 m från den förenklade kanten, förkastas ringen: rektangeln (steg 4) först, sedan steg 2–3, och då gäller
 *    ringen från steg 1.
 *
 * Hål generaliseras på samma sätt (ringens riktning behålls). Rasterutjämningen i geo-generalize.ts (6 m) används inte här:
 * den tar bort gator som är smalare än så. Ren funktion, bara Nodes egna moduler.
 */
type Point = [number, number];
type Ring = readonly (readonly [number, number])[];

export interface PavedGeneralizeSettings {
  /** Steg 1: förenklingens tolerans (m). */
  readonly tolerance: number;
  /** Steg 2: största avstånd från linjen (m) och kortaste raka sträcka (m). */
  readonly straightDistance: number; readonly straightLength: number;
  /** Steg 3: största vinkel från huvudriktningen (grader), minsta andel av kantlängden och största flytt av en kant (m). */
  readonly angleDegrees: number; readonly angleShare: number; readonly maxTurnShift: number;
  /** Steg 4: största yta (m²) och minsta fyllnadsgrad mot den omskrivna rektangeln. */
  readonly compactAreaM2: number; readonly compactFill: number;
  /** Steg 5: största ändring av arean (andel) och största avstånd från den förenklade kanten (m). */
  readonly maxAreaChange: number; readonly maxMove: number;
}
export const DEFAULT_PAVED_GENERALIZE: PavedGeneralizeSettings = { tolerance: 2, straightDistance: 1.5, straightLength: 10, angleDegrees: 12, angleShare: 0.7,
  maxTurnShift: 2, compactAreaM2: 2500, compactFill: 0.8, maxAreaChange: 0.15, maxMove: 5 };

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

/** Steg 1 för en sluten ring: indexen (stigande) för hörnen som behålls. Ringen delas i sin första punkt och den som ligger längst bort. */
export function simplifiedRingIndexes(ring: Ring, tolerance: number): number[] {
  const n = ring.length;
  if (n < 4) return [...ring.keys()];
  let far = 1;
  for (let i = 2; i < n; i += 1) if (Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]) > Math.hypot(ring[far]![0] - ring[0]![0], ring[far]![1] - ring[0]![1])) far = i;
  const first = keptIndexes(ring.slice(0, far + 1), tolerance), second = keptIndexes([...ring.slice(far), ring[0]!], tolerance).map(i => i + far);
  return [...first, ...second.slice(1, -1)];
}

interface Line { readonly at: Point; readonly dir: Point }
/** Minsta kvadrat-anpassad linje (vinkelräta avstånd) genom punkterna, riktad från den första mot den sista, och största avståndet. */
function fitLine(points: Ring): { line: Line; worst: number; extent: number } {
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length; cy /= points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sxx += (x - cx) ** 2; sxy += (x - cx) * (y - cy); syy += (y - cy) ** 2; }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  let dir: Point = [Math.cos(angle), Math.sin(angle)];
  const first = points[0]!, last = points[points.length - 1]!;
  if ((last[0] - first[0]) * dir[0] + (last[1] - first[1]) * dir[1] < 0) dir = [-dir[0], -dir[1]];
  let worst = 0, low = Infinity, high = -Infinity;
  for (const [x, y] of points) {
    worst = Math.max(worst, Math.abs((x - cx) * dir[1] - (y - cy) * dir[0]));
    const along = (x - cx) * dir[0] + (y - cy) * dir[1];
    low = Math.min(low, along); high = Math.max(high, along);
  }
  return { line: { at: [cx, cy], dir }, worst, extent: high - low };
}
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

/** Steg 2: raka sträckor i den förenklade ringen (`indexes` i `ring`). Ger den nya ringen. */
function straighten(ring: Ring, indexes: readonly number[], settings: PavedGeneralizeSettings): Point[] {
  const n = ring.length, k = indexes.length;
  // Börja i det skarpaste hörnet, så att ingen rak sträcka behöver gå över ringens början.
  const turn = (i: number) => {
    const a = ring[indexes[(i + k - 1) % k]!]!, b = ring[indexes[i]!]!, c = ring[indexes[(i + 1) % k]!]!;
    return Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
  };
  let start = 0;
  for (let i = 1; i < k; i += 1) if (turn(i) > turn(start)) start = i;
  const corner = (i: number) => indexes[(start + i) % k]!;
  /** Rasterkantens punkter från hörn `from` till hörn `to` (räknade från `start`, `to` högst k = tillbaka till början). */
  const between = (from: number, to: number) => {
    const out: (readonly [number, number])[] = [];
    for (let i = corner(from); ; i = (i + 1) % n) { out.push(ring[i]!); if (i === corner(to) && (out.length > 1 || from === to)) break; }
    return out;
  };
  // Elementen runt ringen: en rak sträcka (med linje) eller en vanlig kant, från hörn `from` till hörn `to`.
  const parts: { from: number; to: number; line?: Line }[] = [];
  for (let from = 0; from < k;) {
    let to = from, line: Line | undefined;
    for (let next = from + 1; next <= k; next += 1) {
      const fit = fitLine(between(from, next));
      if (fit.worst > settings.straightDistance) break;
      to = next; line = fit.extent >= settings.straightLength ? fit.line : undefined;
    }
    if (line) { parts.push({ from, to, line }); from = to; } else { parts.push({ from, to: from + 1 }); from += 1; }
  }
  return parts.flatMap((part, i): Point[] => {
    const before = parts[(i + parts.length - 1) % parts.length]!, vertex = ring[corner(part.from)]!;
    if (part.line && before.line) {
      const a = project(vertex, before.line), b = project(vertex, part.line);
      const hit = Math.abs(cross(before.line, part.line)) >= CORNER_SIN ? intersection(before.line, part.line) : undefined;
      return [hit && Math.hypot(hit[0] - vertex[0], hit[1] - vertex[1]) <= 2 * settings.straightDistance ? hit : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]];
    }
    if (part.line) return [project(vertex, part.line)];
    // En kant som inte är rak (en sväng) följer rasterkanten tätare, med halva toleransen, så att svängen behåller sin form.
    const raw = between(part.from, part.to), inner = keptIndexes(raw, settings.tolerance / 2).slice(1, -1).map((index): Point => [raw[index]![0], raw[index]![1]]);
    return [before.line ? project(vertex, before.line) : [vertex[0], vertex[1]], ...inner];
  });
}

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

/** Steg 3: kanterna nära huvudriktningen eller dess normal vrids dit, och hörnen räknas om. Inget när villkoret inte är uppfyllt. */
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
    return { at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as Point, dir: [Math.cos(used), Math.sin(used)] as Point, length, snapped, end: [to[0], to[1]] as Point };
  }).filter(edge => edge.length > 0);
  // En kort sned kant mellan två vridna kanter är ett avskuret hörn i rastret: den tas bort och hörnet blir grannarnas skärning.
  // Det gäller också flera korta sneda kanter i följd, så länge de tillsammans är kortare än en rak sträcka.
  const first = edges.findIndex(edge => edge.snapped);
  if (first < 0) return undefined;
  const kept: typeof edges = [];
  let loose: typeof edges = [];
  for (let k = 0; k <= edges.length; k += 1) {
    const edge = edges[(first + k) % edges.length]!;
    if (!edge.snapped) { loose.push(edge); continue; }
    if (loose.reduce((sum, row) => sum + row.length, 0) >= settings.straightLength) kept.push(...loose);
    loose = [];
    if (k < edges.length) kept.push(edge);
  }
  edges = kept;
  if (edges.length < 3) return undefined;
  // Två vridna kanter i följd med samma riktning och nästan samma läge är en kant.
  for (let merged = true; merged && edges.length > 3;) {
    merged = false;
    for (let i = 0; i < edges.length && edges.length > 3; i += 1) {
      const a = edges[i]!, j = (i + 1) % edges.length, b = edges[j]!;
      if (!a.snapped || !b.snapped || a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] < 0.99) continue;
      const offset = (b.at[0] - a.at[0]) * a.dir[1] - (b.at[1] - a.at[1]) * a.dir[0];
      if (Math.abs(offset) > settings.straightDistance) continue;
      const length = a.length + b.length;
      edges[i] = { ...a, at: [(a.at[0] * a.length + b.at[0] * b.length) / length, (a.at[1] * a.length + b.at[1] * b.length) / length], length, end: b.end };
      edges = edges.filter((_, index) => index !== j);
      merged = true; break;
    }
  }
  return edges.flatMap((edge, i): Point[] => {
    const next = edges[(i + 1) % edges.length]!;
    if (Math.abs(cross(edge, next)) >= CORNER_SIN) return [intersection(edge, next)!];
    // Nästan parallella: ett trappsteg mellan två vridna kanter får två hörn; annars behålls det gamla hörnet.
    return edge.snapped && next.snapped ? [project(edge.end, edge), project(edge.end, next)] : [edge.end];
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

/** Steg 5: varför den generaliserade ringen inte duger (mot den förenklade ringen och rasterringens area), eller inget. */
export function pavedRingProblem(candidate: Ring, simplified: Ring, area: number, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE): string | undefined {
  if (candidate.length < 4) return "färre än fyra punkter";
  if (candidate.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return "ogiltig punkt";
  if (Math.abs(Math.abs(signedArea(candidate)) - Math.abs(area)) > settings.maxAreaChange * Math.abs(area)) return "arean ändras för mycket";
  if (selfIntersects(candidate)) return "ringen korsar sig själv";
  if (candidate.some(point => distanceToRing(point, simplified) > settings.maxMove)) return "ett hörn hamnar för långt bort";
  return undefined;
}

/**
 * En ring ur rastret (öppen, utan upprepad slutpunkt; moturs eller medurs) generaliserad. `problem` säger varför skydden
 * valde den förenklade ringen i stället.
 */
export function generalizePavedRingDetailed(ring: Ring, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE): { ring: Point[]; problem?: string | undefined } {
  if (ring.length < 4) return { ring: ring.map(([x, y]) => [x, y]) };
  const clockwise = signedArea(ring) < 0, turned = clockwise ? [...ring].reverse() : ring, area = signedArea(turned);
  const back = (points: readonly (readonly [number, number])[]) => (clockwise ? [...points].reverse() : points).map(([x, y]): Point => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  const indexes = simplifiedRingIndexes(turned, settings.tolerance), simplified = indexes.map(i => turned[i]!);
  if (simplified.length < 4) return { ring: back(simplified) };
  const straight = straighten(turned, indexes, settings);
  const shaped = (straight.length >= 3 ? squareUp(straight, settings) : undefined) ?? straight;
  // Kandidaterna, den mest generaliserade först: rektangeln (steg 4), sedan steg 2–3. Den första som klarar skydden gäller.
  const candidates: Point[][] = [shaped];
  if (area < settings.compactAreaM2 && shaped.length >= 3) {
    const box = boundingRectangle(shaped);
    if (box && box.area > 0 && area / box.area >= settings.compactFill) {
      const cx = (box.corners[0]![0] + box.corners[2]![0]) / 2, cy = (box.corners[0]![1] + box.corners[2]![1]) / 2, factor = Math.sqrt(area / box.area);
      candidates.unshift(box.corners.map(([x, y]): Point => [cx + (x - cx) * factor, cy + (y - cy) * factor]));
    }
  }
  let problem: string | undefined;
  for (const candidate of candidates) {
    problem = pavedRingProblem(candidate, simplified, area, settings);
    if (!problem) return { ring: back(candidate) };
  }
  return { ring: back(simplified), problem };
}

export const generalizePavedRing = (ring: Ring, settings: PavedGeneralizeSettings = DEFAULT_PAVED_GENERALIZE): [number, number][] => generalizePavedRingDetailed(ring, settings).ring;
