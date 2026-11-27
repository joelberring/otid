/**
 * Etapp G5: skarvfri sammanslagning över etappsnitt i ren Node/TypeScript (inga npm-beroenden; körs direkt av geo-arbetaren).
 *
 * - Ytor (`mergeSeamRings` / `mergeSeamPolygons`): axeljusterad halv-kant-eliminering längs etappsnitten (`x === seamX`
 *   eller `y === seamY` inom `SEAM_TOLERANCE_M`). Motriktade överlappande skarvkanter (inkl. ö-hål som korsar skarven) tar ut
 *   varandra med O(K log K) differensarrayer, och kvarvarande riktade kanter spåras till enkla ringar med bevarade öar/hål.
 * - Linjer (`joinSeamLines`): närmaste-först-koppling över etappsnitt inom `LINE_SEAM_TOLERANCE_M`, med absolut riktningsskydd
 *   för brantlinjer (`directed: true`: foga enbart slut → start, vänd aldrig baklänges!).
 */

export interface SeamBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export type SeamPoint = readonly [number, number];
/** Öppen polygonring utan upprepad första punkt sist. */
export type SeamRing = [number, number][];
/** En yta som `[ytterkant, ...hål]` (öppna ringar: ytterkant moturs, hål medurs). */
export type SeamPolygon = SeamRing[];
/** Inre axeljusterade skarvar mellan etapperna. */
export interface Seams { readonly xs: readonly number[]; readonly ys: readonly number[] }

export const SEAM_TOLERANCE_M = 0.05;
export const LINE_SEAM_TOLERANCE_M = 1.0;

const AREA_EPS = 1e-4;
const COORD_EPS = 1e-4;

const cleanZero = (value: number) => value === 0 ? 0 : value;
const round2 = (value: number) => cleanZero(Math.round(value * 100) / 100);

/** Polylinjens geometriska längd i meter. */
export function lineLength(points: readonly SeamPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
}

/** Ringens yta med tecken: positiv = moturs (ytterkant), negativ = medurs (hål). */
export function signedArea(ring: readonly SeamPoint[]): number {
  let twice = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}

/** Inre vertikala och horisontella skarvar mellan etappernas klipprutor. */
export function stageSeams(boxes: readonly SeamBox[], union: SeamBox): Seams {
  if (boxes.length <= 1) return { xs: [], ys: [] };
  const dedup = (values: number[]): number[] => {
    values.sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of values) if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > COORD_EPS) out.push(cleanZero(v));
    return out;
  };
  const xs: number[] = [], ys: number[] = [];
  for (const box of boxes) {
    if (box.minX > union.minX + COORD_EPS && box.minX < union.maxX - COORD_EPS) xs.push(box.minX);
    if (box.maxX > union.minX + COORD_EPS && box.maxX < union.maxX - COORD_EPS) xs.push(box.maxX);
    if (box.minY > union.minY + COORD_EPS && box.minY < union.maxY - COORD_EPS) ys.push(box.minY);
    if (box.maxY > union.minY + COORD_EPS && box.maxY < union.maxY - COORD_EPS) ys.push(box.maxY);
  }
  return { xs: dedup(xs), ys: dedup(ys) };
}

/** Om ringen har minst en kant med nollskild längd längs en inre etappskarv. */
export function hasSeamEdge(ring: readonly SeamPoint[], seams: Seams, tol = SEAM_TOLERANCE_M): boolean {
  const n = ring.length;
  if (n < 3 || (seams.xs.length === 0 && seams.ys.length === 0)) return false;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    if (Math.abs(a[1] - b[1]) > 1e-6) {
      for (const sx of seams.xs) if (Math.abs(a[0] - sx) <= tol && Math.abs(b[0] - sx) <= tol) return true;
    }
    if (Math.abs(a[0] - b[0]) > 1e-6) {
      for (const sy of seams.ys) if (Math.abs(a[1] - sy) <= tol && Math.abs(b[1] - sy) <= tol) return true;
    }
  }
  return false;
}

/** Om punkten ligger inom `tol` från någon inre etappskarv. */
export function isNearSeam(point: SeamPoint, seams: Seams, tol = LINE_SEAM_TOLERANCE_M): boolean {
  for (const sx of seams.xs) if (Math.abs(point[0] - sx) <= tol) return true;
  for (const sy of seams.ys) if (Math.abs(point[1] - sy) <= tol) return true;
  return false;
}

function shareSeamLine(a: SeamPoint, b: SeamPoint, seams: Seams, tol: number): boolean {
  for (const sx of seams.xs) if (Math.abs(a[0] - sx) <= tol && Math.abs(b[0] - sx) <= tol) return true;
  for (const sy of seams.ys) if (Math.abs(a[1] - sy) <= tol && Math.abs(b[1] - sy) <= tol) return true;
  return false;
}

// --- Geometrisk punkt-i-ring och strikt inre provpunkt --------------------------------------------------------------------

function pointInRing(point: SeamPoint, ring: readonly SeamPoint[]): boolean {
  let inside = false;
  const px = point[0], py = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointInTriangle(p: SeamPoint, a: SeamPoint, b: SeamPoint, c: SeamPoint): boolean {
  const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  const hasNeg = s1 < -1e-12 || s2 < -1e-12 || s3 < -1e-12;
  const hasPos = s1 > 1e-12 || s2 > 1e-12 || s3 > 1e-12;
  return !(hasNeg && hasPos);
}

/** En garanterat strikt inre punkt i en enkel polygonring (öronhörn-satsen, fungerar även för konkava öar vid skarv). */
function interiorPoint(rawRing: readonly SeamPoint[]): SeamPoint {
  const ring = removeCollinear(rawRing);
  const n = ring.length;
  if (n < 3) return rawRing[0] ?? [0, 0];
  // Minsta x (vid lika: minsta y) är alltid ett strikt konvext hörn i en enkel polygon.
  let k = 0;
  for (let i = 1; i < n; i += 1) {
    const p = ring[i]!, best = ring[k]!;
    if (p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])) k = i;
  }
  const prev = ring[(k - 1 + n) % n]!, curr = ring[k]!, next = ring[(k + 1) % n]!;
  const dx = next[0] - prev[0], dy = next[1] - prev[1];
  let closest: SeamPoint | undefined;
  let bestPerp = Infinity;
  for (let i = 0; i < n; i += 1) {
    if (i === k || i === (k - 1 + n) % n || i === (k + 1) % n) continue;
    const p = ring[i]!;
    if ((p[0] === prev[0] && p[1] === prev[1]) || (p[0] === curr[0] && p[1] === curr[1]) || (p[0] === next[0] && p[1] === next[1])) continue;
    if (!pointInTriangle(p, prev, curr, next)) continue;
    const perp = Math.abs((p[0] - curr[0]) * dy - (p[1] - curr[1]) * dx);
    if (perp < bestPerp) { bestPerp = perp; closest = p; }
  }
  if (closest) return [(curr[0] + closest[0]) / 2, (curr[1] + closest[1]) / 2];
  return [(prev[0] + curr[0] + next[0]) / 3, (prev[1] + curr[1] + next[1]) / 3];
}

function ringBbox(ring: readonly SeamPoint[]): SeamBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Ringen utan överflödiga kollinjära punkter (t.ex. skarvpunkter på raka ytterkanter efter sammanslagning). */
function removeCollinear(ring: readonly SeamPoint[]): SeamRing {
  const out: SeamRing = ring.map(([x, y]) => [cleanZero(x), cleanZero(y)]);
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i += 1) {
      const a = out[(i + out.length - 1) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const ax = b[0] - a[0], ay = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
      const len = Math.hypot(cx, cy);
      if (len <= 1e-9 || (Math.abs(ax * cy - ay * cx) / len < 1e-4 && ax * (c[0] - b[0]) + ay * (c[1] - b[1]) >= -1e-9)) {
        out.splice(i, 1);
        i -= 1;
        changed = true;
      }
    }
  }
  return out;
}

/** Normaliserar ringars omloppsriktning inom en enskild etapp via nästlingsdjup (jämnt = moturs ytterkant, udda = medurs hål). */
export function orientStageRings(rings: readonly (readonly SeamPoint[])[]): SeamRing[] {
  const valid = rings.map(ring => ring.map(([x, y]) => [cleanZero(x), cleanZero(y)] as [number, number]))
    .filter(ring => ring.length >= 3 && Math.abs(signedArea(ring)) >= AREA_EPS);
  if (valid.length === 0) return [];
  if (valid.length === 1) {
    const r = valid[0]!;
    return [signedArea(r) < 0 ? r.slice().reverse() : r];
  }
  const info = valid.map(ring => ({ ring, area: Math.abs(signedArea(ring)), box: ringBbox(ring), probe: interiorPoint(ring) }));
  const order = info.map((_, i) => i).sort((a, b) => info[b]!.area - info[a]!.area);
  const depth = new Int32Array(valid.length);
  for (let at = 0; at < order.length; at += 1) {
    const idx = order[at]!, self = info[idx]!;
    let d = 0;
    for (let p = 0; p < at; p += 1) {
      const other = info[order[p]!]!;
      if (other.area <= self.area + AREA_EPS) continue;
      if (other.box.minX > self.box.minX + COORD_EPS || other.box.maxX < self.box.maxX - COORD_EPS
        || other.box.minY > self.box.minY + COORD_EPS || other.box.maxY < self.box.maxY - COORD_EPS) continue;
      if (pointInRing(self.probe, other.ring)) d += 1;
    }
    depth[idx] = d;
  }
  return valid.map((ring, i) => {
    const wantCcw = (depth[i]! & 1) === 0;
    const isCcw = signedArea(ring) > 0;
    return wantCcw === isCcw ? ring : ring.slice().reverse();
  });
}

// --- Halv-kant-eliminering längs axeljusterade etappskarvar ---------------------------------------------------------------

function snapToLines(value: number, lines: readonly number[], tol: number): number {
  let best = value, bestD = tol;
  for (const line of lines) {
    const d = Math.abs(value - line);
    if (d <= bestD) { bestD = d; best = line; }
  }
  return cleanZero(best);
}

/** 1D-klustring längs en skarvlinje inom `tol`; korskorsningar (`fixed`) behåller sitt exakta läge. */
function build1DClusters(values: readonly number[], fixed: ReadonlySet<number>, tol: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i]!;
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1]! - start <= tol) end += 1;
    let anchor: number | undefined;
    for (let k = i; k <= end; k += 1) if (fixed.has(sorted[k]!)) { anchor = sorted[k]!; break; }
    anchor ??= i === end ? start : round2((start + sorted[end]!) / 2);
    for (let k = i; k <= end; k += 1) map.set(sorted[k]!, cleanZero(anchor));
    i = end + 1;
  }
  return map;
}

/** Differensarray-eliminering av 1D riktade delsträckor längs en skarvlinje: O(K log K). */
function cancel1D(edges: readonly (readonly [number, number])[], emit: (from: number, to: number) => void): void {
  const coordSet = new Set<number>();
  for (const [a, b] of edges) { coordSet.add(a); coordSet.add(b); }
  const coords = [...coordSet].sort((a, b) => a - b);
  if (coords.length < 2) return;
  const idxOf = new Map<number, number>();
  for (let i = 0; i < coords.length; i += 1) idxOf.set(coords[i]!, i);
  const diff = new Int32Array(coords.length);
  for (const [a, b] of edges) {
    const ia = idxOf.get(a)!, ib = idxOf.get(b)!;
    if (ia < ib) { diff[ia] = diff[ia]! + 1; diff[ib] = diff[ib]! - 1; }
    else if (ia > ib) { diff[ib] = diff[ib]! - 1; diff[ia] = diff[ia]! + 1; }
  }
  let flow = 0;
  for (let i = 0; i + 1 < coords.length; i += 1) {
    flow += diff[i]!;
    if (flow > 0) for (let k = 0; k < flow; k += 1) emit(coords[i]!, coords[i + 1]!);
    else if (flow < 0) for (let k = 0; k < -flow; k += 1) emit(coords[i + 1]!, coords[i]!);
  }
}

/** Delar en cykel som återbesöker samma nod (åttaknut) i enkla delcykler på O(L). */
function splitSimpleCycles(nodes: readonly number[]): number[][] {
  const stack: number[] = [];
  const pos = new Map<number, number>();
  const cycles: number[][] = [];
  for (const node of nodes) {
    const seen = pos.get(node);
    if (seen !== undefined) {
      const sub = stack.slice(seen);
      for (let k = seen + 1; k < stack.length; k += 1) pos.delete(stack[k]!);
      stack.length = seen + 1;
      if (sub.length >= 3) cycles.push(sub);
    } else {
      pos.set(node, stack.length);
      stack.push(node);
    }
  }
  if (stack.length >= 3) cycles.push(stack);
  return cycles;
}

/**
 * Slår ihop orienterade ringar (ytterkanter moturs, hål medurs) längs delade skarvkanter.
 * Returnerar `undefined` om toppologikontrollen skulle misslyckas (så anroparen kan falla tillbaka säkert).
 */
export function mergeSeamRings(orientedRings: readonly (readonly SeamPoint[])[], seams: Seams, tol = SEAM_TOLERANCE_M): SeamRing[] | undefined {
  const input = orientedRings.filter(ring => ring.length >= 3 && Math.abs(signedArea(ring)) >= AREA_EPS);
  if (input.length === 0) return [];
  if (input.length < 2 || (seams.xs.length === 0 && seams.ys.length === 0)) {
    return input.map(ring => ring.map(([x, y]) => [cleanZero(x), cleanZero(y)]));
  }

  // 1. Snäpp punkter nära skarvlinjer exakt in på skarvlinjen.
  const snapped: SeamRing[] = input.map(ring => ring.map(([x, y]) => [snapToLines(x, seams.xs, tol), snapToLines(y, seams.ys, tol)]));
  const seamXSet = new Set(seams.xs), seamYSet = new Set(seams.ys);

  // 2. Klustra närliggande skarvpunkter inom `tol` längs varje skarvlinje (bevara korspunkter exakt).
  const onX = new Map<number, number[]>(), onY = new Map<number, number[]>();
  for (const ring of snapped) for (const [x, y] of ring) {
    if (seamXSet.has(x)) { const list = onX.get(x); if (list) list.push(y); else onX.set(x, [y]); }
    if (seamYSet.has(y)) { const list = onY.get(y); if (list) list.push(x); else onY.set(y, [x]); }
  }
  const snapYOnX = new Map<number, Map<number, number>>();
  for (const [sx, ys] of onX) snapYOnX.set(sx, build1DClusters(ys, seamYSet, tol));
  const snapXOnY = new Map<number, Map<number, number>>();
  for (const [sy, xs] of onY) snapXOnY.set(sy, build1DClusters(xs, seamXSet, tol));

  // 3. Tillämpa klustrade skarvpunkter på ringarna och rensa nollängdskanter.
  const compacted: SeamRing[] = [];
  for (const ring of snapped) {
    const pts: SeamRing = [];
    for (const [rx, ry] of ring) {
      let x = rx, y = ry;
      const inX = seamXSet.has(x), inY = seamYSet.has(y);
      if (inX && !inY) y = snapYOnX.get(x)?.get(y) ?? y;
      else if (inY && !inX) x = snapXOnY.get(y)?.get(x) ?? x;
      const prev = pts[pts.length - 1];
      if (!prev || prev[0] !== x || prev[1] !== y) pts.push([x, y]);
    }
    while (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
    if (pts.length >= 3) compacted.push(pts);
  }

  // 4. Dela upp riktade kanter i vertikala skarvkanter, horisontella skarvkanter och övriga kanter.
  const vert = new Map<number, [number, number][]>();
  const horiz = new Map<number, [number, number][]>();
  const remaining: [number, number, number, number][] = [];
  for (const ring of compacted) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % n]!;
      if (a[0] === b[0] && seamXSet.has(a[0])) {
        const list = vert.get(a[0]);
        if (list) list.push([a[1], b[1]]); else vert.set(a[0], [[a[1], b[1]]]);
      } else if (a[1] === b[1] && seamYSet.has(a[1])) {
        const list = horiz.get(a[1]);
        if (list) list.push([a[0], b[0]]); else horiz.set(a[1], [[a[0], b[0]]]);
      } else {
        remaining.push([a[0], a[1], b[0], b[1]]);
      }
    }
  }

  // 5. Eliminera motriktade överlappande skarvkanter längs varje snitt.
  for (const [sx, edges] of vert) cancel1D(edges, (y0, y1) => remaining.push([sx, y0, sx, y1]));
  for (const [sy, edges] of horiz) cancel1D(edges, (x0, x1) => remaining.push([x0, sy, x1, sy]));

  // 6. Bygg nodgraf, verifiera gradbalans (in === ut) och spåra ringar med skarpaste vänstersväng.
  const nodeIds = new Map<string, number>();
  const vx: number[] = [], vy: number[] = [];
  const nodeOf = (x: number, y: number): number => {
    const key = `${x},${y}`;
    const found = nodeIds.get(key);
    if (found !== undefined) return found;
    const id = vx.length;
    vx.push(x); vy.push(y);
    nodeIds.set(key, id);
    return id;
  };
  const edgeFrom = new Int32Array(remaining.length);
  const edgeTo = new Int32Array(remaining.length);
  const outgoing = new Map<number, number[]>();
  const inDeg = new Map<number, number>();
  for (let i = 0; i < remaining.length; i += 1) {
    const [x0, y0, x1, y1] = remaining[i]!;
    const u = nodeOf(x0, y0), v = nodeOf(x1, y1);
    edgeFrom[i] = u; edgeTo[i] = v;
    const list = outgoing.get(u);
    if (list) list.push(i); else outgoing.set(u, [i]);
    inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
  }
  for (let id = 0; id < vx.length; id += 1) {
    if ((outgoing.get(id)?.length ?? 0) !== (inDeg.get(id) ?? 0)) return undefined;
  }

  const used = new Uint8Array(remaining.length);
  const rings: SeamRing[] = [];
  for (let start = 0; start < remaining.length; start += 1) {
    if (used[start]) continue;
    const rawNodes: number[] = [];
    let edge = start;
    let lastV = -1;
    while (!used[edge]) {
      used[edge] = 1;
      const u = edgeFrom[edge]!, v = edgeTo[edge]!;
      rawNodes.push(u);
      lastV = v;
      const choices = (outgoing.get(v) ?? []).filter(next => !used[next]);
      if (choices.length === 0) break;
      if (choices.length === 1) { edge = choices[0]!; continue; }
      const inAngle = Math.atan2(vy[v]! - vy[u]!, vx[v]! - vx[u]!);
      let best = choices[0]!, bestTurn = -Infinity;
      for (const next of choices) {
        const w = edgeTo[next]!;
        let turn = Math.atan2(vy[w]! - vy[v]!, vx[w]! - vx[v]!) - inAngle;
        while (turn <= -Math.PI) turn += 2 * Math.PI;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn > bestTurn) { bestTurn = turn; best = next; }
      }
      edge = best;
    }
    if (lastV !== edgeFrom[start]!) return undefined;
    for (const simple of splitSimpleCycles(rawNodes)) {
      const cleaned = removeCollinear(simple.map(id => [vx[id]!, vy[id]!] as [number, number]));
      if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) >= AREA_EPS) rings.push(cleaned);
    }
  }
  return rings;
}

/**
 * Unionerar polygoner av samma lager (t.ex. `vatten.geojson`) över etappskarvar och återkapslar öar som hål.
 * Polygoner som inte nuddar någon skarv rörs inte alls.
 */
export function mergeSeamPolygons(polygons: readonly SeamPolygon[], seams: Seams, tol = SEAM_TOLERANCE_M): SeamPolygon[] {
  if (polygons.length < 2 || (seams.xs.length === 0 && seams.ys.length === 0)) {
    return polygons.map(poly => poly.map(ring => ring.map(([x, y]) => [cleanZero(x), cleanZero(y)])));
  }
  const untouched: SeamPolygon[] = [];
  const touching: SeamPolygon[] = [];
  for (const poly of polygons) {
    if (poly.some(ring => hasSeamEdge(ring, seams, tol))) touching.push(poly);
    else untouched.push(poly);
  }
  if (touching.length < 2) return [...polygons];

  // Normalisera ytterkant moturs och hål medurs innan halv-kant-eliminering.
  const oriented: SeamRing[] = [];
  for (const poly of touching) {
    const outer = poly[0];
    if (!outer || outer.length < 3 || Math.abs(signedArea(outer)) < AREA_EPS) continue;
    oriented.push(signedArea(outer) > 0 ? outer.map(([x, y]) => [x, y]) : outer.slice().reverse().map(([x, y]) => [x, y]));
    for (let i = 1; i < poly.length; i += 1) {
      const hole = poly[i]!;
      if (hole.length < 3 || Math.abs(signedArea(hole)) < AREA_EPS) continue;
      oriented.push(signedArea(hole) < 0 ? hole.map(([x, y]) => [x, y]) : hole.slice().reverse().map(([x, y]) => [x, y]));
    }
  }
  const merged = mergeSeamRings(oriented, seams, tol);
  if (!merged) return [...polygons];

  const outers = merged.filter(ring => signedArea(ring) > AREA_EPS)
    .map(ring => ({ ring, area: signedArea(ring), box: ringBbox(ring), holes: [] as SeamRing[] }))
    .sort((a, b) => a.area - b.area);
  for (const hole of merged) {
    const area = signedArea(hole);
    if (area >= -AREA_EPS) continue;
    const holeArea = -area, box = ringBbox(hole), probe = interiorPoint(hole);
    const owner = outers.find(outer => outer.area > holeArea + AREA_EPS
      && outer.box.minX <= box.minX + COORD_EPS && outer.box.maxX >= box.maxX - COORD_EPS
      && outer.box.minY <= box.minY + COORD_EPS && outer.box.maxY >= box.maxY - COORD_EPS
      && pointInRing(probe, outer.ring));
    owner?.holes.push(hole);
  }
  return [...untouched, ...outers.map(outer => [outer.ring, ...outer.holes])];
}

// --- Skarvfogning av öppna linjer (med riktningsskydd för brantlinjer) ----------------------------------------------------

export interface SeamLineInput<T> {
  readonly points: readonly SeamPoint[];
  /** Vilken etapp linjebiten kommer från (förhindrar falsk sammanslagning inom samma etapp). */
  readonly stage?: number | undefined;
  readonly data: T;
}
export interface SeamLineChain<T> {
  readonly points: [number, number][];
  readonly closed: boolean;
  readonly items: readonly { readonly data: T; readonly reversed: boolean; readonly length: number }[];
}

/**
 * Fogar öppna linjer av samma lager/höjd över etappskarvar inom `tolerance` (förval 1,0 m) i stigande avståndsordning.
 * Med `directed: true` (brantlinjer!) kopplas ENBART slut → start; ingen linjebit vänds någonsin baklänges.
 */
export function joinSeamLines<T>(
  rawLines: readonly SeamLineInput<T>[],
  seams: Seams,
  options: { readonly directed?: boolean | undefined; readonly allowClose?: boolean | undefined; readonly tolerance?: number | undefined } = {}
): SeamLineChain<T>[] {
  const tol = options.tolerance ?? LINE_SEAM_TOLERANCE_M;
  const directed = options.directed === true;
  const allowClose = options.allowClose === true;
  const lines = rawLines.filter(line => line.points.length >= 2 && lineLength(line.points) > 1e-6);
  if (lines.length === 0) return [];
  if (lines.length === 1 || (seams.xs.length === 0 && seams.ys.length === 0)) {
    return lines.map(line => ({
      points: line.points.map(([x, y]) => [cleanZero(x), cleanZero(y)]),
      closed: false,
      items: [{ data: line.data, reversed: false, length: lineLength(line.points) }]
    }));
  }

  // Lägg bara skarv-nära ändpunkter i rumsligt rutnät (cell = tol).
  const cellOf = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  const grid = new Map<string, number[]>();
  const endPoint = (endId: number): SeamPoint => {
    const pts = lines[endId >> 1]!.points;
    return (endId & 1) === 0 ? pts[0]! : pts[pts.length - 1]!;
  };
  const nearEnds: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const bit of [0, 1] as const) {
      const endId = (i << 1) | bit;
      const pt = endPoint(endId);
      if (!isNearSeam(pt, seams, tol)) continue;
      nearEnds.push(endId);
      const key = cellOf(pt[0], pt[1]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(endId); else grid.set(key, [endId]);
    }
  }

  // Hitta alla giltiga kandidatpar över samma skarvlinje, sortera på avstånd.
  const candidates: { eA: number; eB: number; dist: number }[] = [];
  for (const eA of nearEnds) {
    const pA = endPoint(eA), lineA = eA >> 1, stageA = lines[lineA]!.stage;
    const cx = Math.floor(pA[0] / tol), cy = Math.floor(pA[1] / tol);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const eB of bucket) {
        if (eB <= eA) continue;
        const lineB = eB >> 1;
        if (lineA === lineB) continue;
        const stageB = lines[lineB]!.stage;
        if (stageA !== undefined && stageB !== undefined && stageA === stageB) continue;
        // Riktade linjer (branter): enbart slut (bit 1) mot start (bit 0).
        if (directed && (eA & 1) === (eB & 1)) continue;
        const pB = endPoint(eB);
        const dist = Math.hypot(pA[0] - pB[0], pA[1] - pB[1]);
        if (dist > tol) continue;
        const seamCheckTol = stageA !== undefined && stageB !== undefined ? tol : Math.min(tol, 0.15);
        if (!shareSeamLine(pA, pB, seams, seamCheckTol)) continue;
        candidates.push({ eA, eB, dist });
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist || a.eA - b.eA || a.eB - b.eB);

  // Girig 1-mot-1-koppling med Union-Find (hindrar falska cykler när `!allowClose`).
  const partner = new Int32Array(lines.length * 2).fill(-1);
  const uf = Int32Array.from({ length: lines.length }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (uf[r]! !== r) r = uf[r]!;
    let c = x;
    while (uf[c]! !== r) { const next = uf[c]!; uf[c] = r; c = next; }
    return r;
  };
  for (const { eA, eB } of candidates) {
    if (partner[eA] !== -1 || partner[eB] !== -1) continue;
    const rA = find(eA >> 1), rB = find(eB >> 1);
    if (rA === rB && !allowClose) continue;
    if (rA !== rB) uf[rA] = rB;
    partner[eA] = eB;
    partner[eB] = eA;
  }

  // Spåra färdiga kedjor på O(V).
  const visited = new Uint8Array(lines.length);
  const out: SeamLineChain<T>[] = [];
  const appendSegment = (chain: [number, number][], seg: readonly SeamPoint[], reversed: boolean) => {
    const enter = reversed ? seg[seg.length - 1]! : seg[0]!;
    if (chain.length === 0) {
      if (reversed) for (let k = seg.length - 1; k >= 0; k -= 1) chain.push([cleanZero(seg[k]![0]), cleanZero(seg[k]![1])]);
      else for (let k = 0; k < seg.length; k += 1) chain.push([cleanZero(seg[k]![0]), cleanZero(seg[k]![1])]);
      return;
    }
    const prev = chain[chain.length - 1]!;
    chain[chain.length - 1] = prev[0] === enter[0] && prev[1] === enter[1]
      ? [cleanZero(prev[0]), cleanZero(prev[1])]
      : [round2((prev[0] + enter[0]) / 2), round2((prev[1] + enter[1]) / 2)];
    if (reversed) for (let k = seg.length - 2; k >= 0; k -= 1) chain.push([cleanZero(seg[k]![0]), cleanZero(seg[k]![1])]);
    else for (let k = 1; k < seg.length; k += 1) chain.push([cleanZero(seg[k]![0]), cleanZero(seg[k]![1])]);
  };

  const walk = (startLine: number, startAtEnd: boolean, closeLoop: boolean) => {
    const chain: [number, number][] = [];
    const items: { data: T; reversed: boolean; length: number }[] = [];
    let cur = startLine, enterAtEnd = startAtEnd;
    while (!visited[cur]) {
      visited[cur] = 1;
      const line = lines[cur]!;
      appendSegment(chain, line.points, enterAtEnd);
      items.push({ data: line.data, reversed: enterAtEnd, length: lineLength(line.points) });
      const exitEnd = enterAtEnd ? (cur << 1) : ((cur << 1) | 1);
      const nextEnd = partner[exitEnd]!;
      if (nextEnd === -1) break;
      cur = nextEnd >> 1;
      enterAtEnd = (nextEnd & 1) === 1;
    }
    if (closeLoop && chain.length >= 4) {
      const first = chain[0]!, last = chain[chain.length - 1]!;
      chain[0] = first[0] === last[0] && first[1] === last[1]
        ? [cleanZero(first[0]), cleanZero(first[1])]
        : [round2((first[0] + last[0]) / 2), round2((first[1] + last[1]) / 2)];
      chain.pop();
      out.push({ points: chain, closed: true, items });
    } else {
      out.push({ points: chain, closed: false, items });
    }
  };

  // Pass 1: öppna kedjor (börja i en fri ände; för riktade linjer alltid i fri startände).
  for (let i = 0; i < lines.length; i += 1) {
    if (visited[i]) continue;
    const freeStart = partner[i << 1] === -1, freeEnd = partner[(i << 1) | 1] === -1;
    if (directed ? !freeStart : (!freeStart && !freeEnd)) continue;
    walk(i, !freeStart, false);
  }
  // Pass 2: slutna slingor (t.ex. höjdkurva runt en kulle/sänka som klippts över skarv).
  for (let i = 0; i < lines.length; i += 1) {
    if (!visited[i]) walk(i, false, allowClose);
  }
  return out;
}
