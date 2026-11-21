import type { FaceLine, FacePoint } from "./index";
import { snapRing, type LineIndex, lineIndex } from "./raster-snap";

/**
 * K8b V4 (magisk fyll, reserven för röriga ställen): när varken grundtoleransen eller steg 2 ger en sluten ruta ritas
 * gränslinjerna som en bild med små rutor (`cell`), linjerna görs tjockare med `radius` (halva Glapp, så att glapp upp till
 * Glapp sluts), ytan fylls från klicket, och växer sedan tillbaka mot linjerna (upp till 1,5 × radien, så att också hörnen
 * nås) utan att gå förbi dem. Kanten spåras till en polygon, förenklas (Douglas–Peucker, `simplify`) och varje punkt inom
 * `snap` från en gränslinje fästs på linjen (kanten delas med grannarna, linjens egna punkter emellan tas med). Punkter som
 * inte ligger vid någon linje sitter där ett glapp slöts: de tas bort, så att glappet sluts med en rak bit. Hål kommer med.
 * Når fyllningen bildens kant är ytan öppen. Ren TypeScript, utan canvas.
 */
export interface RasterFillOptions {
  readonly box: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  /** Bildens rutor (förval i Fyll yta: 0,2 m). */
  readonly cell: number;
  /** Hur mycket linjerna görs tjockare (halva Glapp). */
  readonly radius: number;
  /** Punkter så här nära en linje fästs på den (förval 0,3 m). */
  readonly snap: number;
  /** Douglas–Peuckers tolerans (förval 0,1 m). */
  readonly simplify: number;
  /** performance.now() då räkningen ger upp. */
  readonly deadline?: number | undefined;
}

export type RasterFillResult =
  | { readonly status: "found"; readonly outer: FacePoint[]; readonly holes: FacePoint[][]; readonly area: number }
  /** Ytan når bildens kant, eller klicket ligger på en linje. */
  | { readonly status: "open" }
  | { readonly status: "timeout" };

/** Går genom alla rutor som sträckan (i rutornas koordinater) passerar; `visit` sant = sluta (och svaret blir sant). */
function walk(x0: number, y0: number, x1: number, y1: number, width: number, height: number, visit: (index: number) => boolean | void): boolean {
  let i = Math.floor(x0), j = Math.floor(y0);
  const iEnd = Math.floor(x1), jEnd = Math.floor(y1), dx = x1 - x0, dy = y1 - y0;
  const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1;
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let maxX = dx !== 0 ? ((stepI > 0 ? i + 1 : i) - x0) / dx : Infinity, maxY = dy !== 0 ? ((stepJ > 0 ? j + 1 : j) - y0) / dy : Infinity;
  for (let guard = Math.abs(iEnd - i) + Math.abs(jEnd - j) + 2; guard >= 0; guard -= 1) {
    if (i >= 0 && j >= 0 && i < width && j < height && visit(j * width + i)) return true;
    if (i === iEnd && j === jEnd) break;
    if (maxX < maxY) { i += stepI; maxX += deltaX; } else { j += stepJ; maxY += deltaY; }
  }
  return false;
}

/** Kvadrerat euklidiskt avstånd i en led (Felzenszwalb–Huttenlocher). */
function distance1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) { k -= 1; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
    k += 1; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1]! < q) k += 1;
    out[q] = (q - v[k]!) ** 2 + f[v[k]!]!;
  }
}

/** Kvadrerat avstånd (i rutor) från varje ruta till närmaste linjeruta. */
function distanceToLines(line: Uint8Array, width: number, height: number, deadline: number): Float64Array | undefined {
  const far = 1e20, dist = new Float64Array(width * height);
  const size = Math.max(width, height);
  const f = new Float64Array(size), out = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) f[i] = line[j * width + i] ? 0 : far;
    distance1d(f, width, out, v, z);
    for (let i = 0; i < width; i += 1) dist[j * width + i] = out[i]!;
  }
  if (performance.now() > deadline) return undefined;
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < height; j += 1) f[j] = dist[j * width + i]!;
    distance1d(f, height, out, v, z);
    for (let j = 0; j < height; j += 1) dist[j * width + i] = out[j]!;
  }
  return dist;
}

/**
 * Ytan under `point` ur gränslinjerna med reserven (se ovan). En ruta som är smalare än de tjocka linjerna (inget inre att
 * fylla från) prövas en gång till med halva radien.
 */
export function rasterFill(lines: readonly FaceLine[], point: FacePoint, options: RasterFillOptions): RasterFillResult {
  const first = fillOnce(lines, point, options);
  if (first !== "narrow") return first;
  const second = fillOnce(lines, point, { ...options, radius: options.radius / 2 });
  return second === "narrow" ? { status: "open" } : second;
}

function fillOnce(lines: readonly FaceLine[], point: FacePoint, options: RasterFillOptions): RasterFillResult | "narrow" {
  const { box, cell } = options, deadline = options.deadline ?? Infinity;
  const width = Math.max(3, Math.ceil((box.maxX - box.minX) / cell)), height = Math.max(3, Math.ceil((box.maxY - box.minY) / cell));
  const gx = (x: number) => (x - box.minX) / cell, gy = (y: number) => (y - box.minY) / cell;
  const line = new Uint8Array(width * height);
  const index: LineIndex = lineIndex(lines, box, options.snap);
  for (const segment of index.segments) {
    walk(gx(segment.ax), gy(segment.ay), gx(segment.bx), gy(segment.by), width, height, at => { line[at] = 1; });
  }
  const dist = distanceToLines(line, width, height, deadline);
  if (!dist || performance.now() > deadline) return { status: "timeout" };
  const r = options.radius / cell, r2 = r * r;
  const region = new Uint8Array(width * height);

  // Klicket: närmaste ruta längre än radien från linjerna, utan att gå över en linje.
  const ci = Math.floor(gx(point.x)), cj = Math.floor(gy(point.y));
  if (ci <= 0 || cj <= 0 || ci >= width - 1 || cj >= height - 1) return { status: "open" };
  let seed = -1;
  {
    const start = cj * width + ci, seen = new Map<number, true>([[start, true]]), queue = [start], reach2 = (r + 2) ** 2;
    for (let at = 0; at < queue.length && seed < 0; at += 1) {
      const here = queue[at]!;
      if (dist[here]! > r2) { seed = here; break; }
      const hi = here % width, hj = (here - hi) / width;
      for (const [ni, nj] of [[hi + 1, hj], [hi - 1, hj], [hi, hj + 1], [hi, hj - 1]] as const) {
        if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
        const next = nj * width + ni;
        if (seen.has(next) || line[next] || (ni - ci) ** 2 + (nj - cj) ** 2 > reach2) continue;
        seen.set(next, true); queue.push(next);
      }
    }
  }
  if (seed < 0) return "narrow";

  // Fyll de tjocka linjernas inre (fyra grannar). Når den kanten är ytan öppen.
  const stack = [seed];
  region[seed] = 1;
  const boundary: number[] = [];
  for (let steps = 0; stack.length; steps += 1) {
    if ((steps & 0xffff) === 0 && performance.now() > deadline) return { status: "timeout" };
    const here = stack.pop()!, hi = here % width, hj = (here - hi) / width;
    if (hi === 0 || hj === 0 || hi === width - 1 || hj === height - 1) return { status: "open" };
    let edge = false;
    for (const next of [here + 1, here - 1, here + width, here - width]) {
      if (region[next]) continue;
      if (dist[next]! > r2) { region[next] = 1; stack.push(next); } else edge = true;
    }
    if (edge) boundary.push(here);
  }

  // Tillbaka mot linjerna: från ytans kant, högst 1,5 × radien, bara i de tjocka linjernas band, aldrig över en linjeruta och
  // bara dit en rak sträcka från närmaste källruta inte korsar någon linje (så att ytan inte kryper runt en linjes ände).
  const grow = 1.5 * r, grow2 = grow * grow;
  const best = new Float64Array(width * height).fill(Infinity), source = new Int32Array(width * height).fill(-1);
  const queue = boundary;
  for (const here of queue) { best[here] = 0; source[here] = here; }
  for (let at = 0; at < queue.length; at += 1) {
    if ((at & 0x3fff) === 0 && performance.now() > deadline) return { status: "timeout" };
    const here = queue[at]!, from = source[here]!, fi = from % width, fj = (from - fi) / width, hi = here % width, hj = (here - hi) / width;
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
      const ni = hi + di, nj = hj + dj;
      if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
      const next = nj * width + ni;
      if (region[next] === 1 || line[next] || dist[next]! > r2) continue;
      const d2 = (ni - fi) ** 2 + (nj - fj) ** 2;
      if (d2 > grow2 || d2 >= best[next]!) continue;
      if (walk(ni + 0.5, nj + 0.5, fi + 0.5, fj + 0.5, width, height, cellAt => line[cellAt] === 1)) continue;
      best[next] = d2; source[next] = from;
      queue.push(next);
    }
  }
  for (let at = 0; at < region.length; at += 1) if (best[at]! < Infinity) region[at] = 1;
  if (performance.now() > deadline) return { status: "timeout" };

  // Kanten: rutornas sidor mellan ytan och resten, med ytan till vänster.
  const rings = traceRings(region, width, height);
  const toMap = (ring: readonly number[]) => ring.map(vertex => ({ x: box.minX + (vertex % (width + 1)) * cell, y: box.minY + Math.floor(vertex / (width + 1)) * cell }));
  const seedPoint = { x: box.minX + (seed % width + 0.5) * cell, y: box.minY + (Math.floor(seed / width) + 0.5) * cell };
  const mapped = rings.map(ring => { const points = toMap(ring); return { points, area: ringArea(points) }; });
  const outer = mapped.filter(ring => ring.area > 0 && insideRing(ring.points, seedPoint)).sort((a, b) => a.area - b.area)[0];
  if (!outer) return { status: "open" };
  const holes = mapped.filter(ring => ring.area < 0 && -ring.area < outer.area && insideRing(outer.points, ring.points[0]!));
  if (performance.now() > deadline) return { status: "timeout" };

  const finish = (ring: readonly FacePoint[]) => snapRing(simplifyRing(ring, options.simplify), index, options.snap);
  const outerRing = finish(outer.points);
  const minHole = 25 * cell * cell;
  const holeRings = holes.map(hole => finish(hole.points)).filter(ring => ring.length >= 3 && -ringArea(ring) >= minHole);
  const outerArea = ringArea(outerRing);
  if (outerRing.length < 3 || outerArea <= 0) return { status: "open" };
  return { status: "found", outer: outerRing, holes: holeRings, area: outerArea + holeRings.reduce((sum, ring) => sum + ringArea(ring), 0) };
}

/** Ytans kanter som ringar av hörn (nummer j·(bredd+1)+i); vid ett hörn där två rutor bara möts snett svänger ringen vänster. */
function traceRings(region: Uint8Array, width: number, height: number): number[][] {
  const stride = width + 1, size = stride * (height + 1);
  const outA = new Int32Array(size).fill(-1), outB = new Int32Array(size).fill(-1);
  const add = (from: number, to: number) => { if (outA[from]! < 0) outA[from] = to; else outB[from] = to; };
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < height && region[j * width + i] === 1;
  for (let j = 0; j < height; j += 1) for (let i = 0; i < width; i += 1) {
    if (!region[j * width + i]) continue;
    const v = j * stride + i;
    if (!inside(i, j - 1)) add(v, v + 1);
    if (!inside(i + 1, j)) add(v + 1, v + 1 + stride);
    if (!inside(i, j + 1)) add(v + 1 + stride, v + stride);
    if (!inside(i - 1, j)) add(v + stride, v);
  }
  const rings: number[][] = [];
  // Varje ring börjar i ett hörn som inte är ett snett möte (sådana passeras bara en gång), och slutar där den började.
  const saddle = Uint8Array.from(outB, to => to >= 0 ? 1 : 0);
  for (let start = 0; start < size; start += 1) {
    if (saddle[start] || outA[start]! < 0) continue;
    {
      const ring: number[] = [];
      let from = start, to = outA[from]!;
      outA[from] = -1;
      for (;;) {
        ring.push(from);
        if (to === start) break;
        const a = outA[to]!, b = outB[to]!;
        if (a < 0 && b < 0) break;
        let next = a >= 0 ? a : b;
        if (a >= 0 && b >= 0) {
          // Vänstersväng: kryssprodukten av riktningen in och riktningen ut är positiv.
          const dx = (to % stride) - (from % stride), dy = Math.floor(to / stride) - Math.floor(from / stride);
          const ax = (a % stride) - (to % stride), ay = Math.floor(a / stride) - Math.floor(to / stride);
          next = dx * ay - dy * ax > 0 ? a : b;
        }
        if (outA[to] === next) outA[to] = -1; else outB[to] = -1;
        from = to; to = next;
      }
      // Bara hörnen (där riktningen byts).
      rings.push(ring.filter((vertex, at) => {
        const previous = ring[(at + ring.length - 1) % ring.length]!, following = ring[(at + 1) % ring.length]!;
        return following - vertex !== vertex - previous;
      }));
    }
  }
  return rings.filter(ring => ring.length >= 4);
}

export function ringArea(ring: readonly FacePoint[]): number {
  let sum = 0;
  for (let at = 0, previous = ring.length - 1; at < ring.length; previous = at, at += 1) sum += ring[previous]!.x * ring[at]!.y - ring[at]!.x * ring[previous]!.y;
  return sum / 2;
}

function insideRing(ring: readonly FacePoint[], point: FacePoint): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker på en sluten ring: delas i punkten längst från den första. */
function simplifyRing(ring: readonly FacePoint[], tolerance: number): FacePoint[] {
  if (ring.length <= 4) return [...ring];
  let far = 0, farDistance = -1;
  ring.forEach((point, at) => { const d = (point.x - ring[0]!.x) ** 2 + (point.y - ring[0]!.y) ** 2; if (d > farDistance) { farDistance = d; far = at; } });
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = ring[first]!, b = ring[last % ring.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let worst = -1, worstDistance = tolerance;
    for (let at = first + 1; at < last; at += 1) {
      const p = ring[at]!;
      const d = length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
      if (d > worstDistance) { worstDistance = d; worst = at; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([first, worst], [worst, last]); }
  }
  return ring.filter((_, at) => keep[at]);
}
