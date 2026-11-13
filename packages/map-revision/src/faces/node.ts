/**
 * Ytor ur linjer, steg 1: nodningen. Alla sträckor delas där de korsar eller rör vid varandra, punkter som nästan
 * sammanfaller (inom `snap`) blir samma nod, och sträckor som ligger på varandra blir en enda kant som minns alla sina
 * källor. Ett rutnät över sträckornas rutor gör att bara grannar jämförs, så att tiotusentals sträckor går fort.
 */
export interface Segment {
  readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number;
  /** Källinjernas nummer (tom för en slutningsbit). */
  readonly sources: readonly number[];
  /** Slutningsbit: sluter ett glapp och blir aldrig en kantlinje. */
  readonly closure: boolean;
}

export interface Edge { readonly u: number; readonly v: number; sources: readonly number[]; closure: boolean }

/** Den plana grafen: nodernas lägen och kanterna mellan dem (högst en kant per nodpar). */
export interface Graph { readonly xs: number[]; readonly ys: number[]; readonly edges: Edge[] }

/** Flest rutor per led i rutnäten. */
const MAX_GRID = 1024;

/** Noderna: en punkt inom `snap` från en nod som redan finns blir den noden. */
function nodeIndex(minX: number, minY: number, maxX: number, maxY: number, snap: number) {
  // Rutan är minst `snap`, och större när utsträckningen annars ger nycklar som inte ryms i ett heltal.
  const cell = Math.max(snap, (Math.max(maxX - minX, maxY - minY) + 4 * snap) / 3e7);
  const width = Math.ceil((maxY - minY) / cell) + 5;
  const cells = new Map<number, number[]>();
  const xs: number[] = [], ys: number[] = [];
  const limit = snap * snap;
  return {
    xs, ys,
    get(x: number, y: number): number {
      const ix = Math.floor((x - minX) / cell) + 1, iy = Math.floor((y - minY) / cell) + 1;
      let best = -1, bestDistance = limit;
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const list = cells.get((ix + dx) * width + iy + dy);
        if (!list) continue;
        for (const node of list) {
          const distance = (xs[node]! - x) ** 2 + (ys[node]! - y) ** 2;
          if (distance <= bestDistance) { best = node; bestDistance = distance; }
        }
      }
      if (best >= 0) return best;
      const node = xs.length;
      xs.push(x); ys.push(y);
      const key = ix * width + iy, list = cells.get(key);
      if (list) list.push(node); else cells.set(key, [node]);
      return node;
    }
  };
}

/** Läget (0–1) längs a–b för punkten närmast p, eller −1 när p ligger längre än `snap` från sträckan. */
function touchAt(px: number, py: number, ax: number, ay: number, bx: number, by: number, snap: number): number {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  const ox = ax + t * dx - px, oy = ay + t * dy - py;
  return ox * ox + oy * oy <= snap * snap ? t : -1;
}

/** Delar sträckorna i varandras skärningspunkter och ger den plana grafen. */
export function nodeSegments(segments: readonly Segment[], snap: number): Graph {
  const count = segments.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Sträckornas rutor, vidgade med `snap` så att beröring räknas.
  const boxes = new Float64Array(count * 4);
  segments.forEach((segment, index) => {
    const x0 = Math.min(segment.ax, segment.bx) - snap, y0 = Math.min(segment.ay, segment.by) - snap;
    const x1 = Math.max(segment.ax, segment.bx) + snap, y1 = Math.max(segment.ay, segment.by) + snap;
    boxes.set([x0, y0, x1, y1], index * 4);
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  });
  const nodes = nodeIndex(count ? minX : 0, count ? minY : 0, count ? maxX : 0, count ? maxY : 0, snap);
  if (count === 0) return { xs: nodes.xs, ys: nodes.ys, edges: [] };

  // Rutnätet: ungefär fyra sträckor per ruta när de ligger jämnt.
  const spanX = maxX - minX, spanY = maxY - minY;
  const cell = Math.max(Math.sqrt(Math.max(spanX * spanY, 1e-12) / count) * 2, Math.max(spanX, spanY) / MAX_GRID, snap * 4);
  const cols = Math.max(1, Math.ceil(spanX / cell)), rows = Math.max(1, Math.ceil(spanY / cell));
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cell)));
  const row = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cell)));
  const grid: (number[] | undefined)[] = new Array<number[] | undefined>(cols * rows);
  for (let index = 0; index < count; index += 1) {
    const c0 = col(boxes[index * 4]!), c1 = col(boxes[index * 4 + 2]!), r0 = row(boxes[index * 4 + 1]!), r1 = row(boxes[index * 4 + 3]!);
    for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) (grid[r * cols + c] ??= []).push(index);
  }

  // Delningspunkterna per sträcka: läget längs sträckan och punkten.
  const splits: (number[] | undefined)[] = new Array<number[] | undefined>(count);
  const split = (index: number, t: number, x: number, y: number) => { (splits[index] ??= []).push(t, x, y); };
  for (let key = 0; key < grid.length; key += 1) {
    const list = grid[key];
    if (!list || list.length < 2) continue;
    const c = key % cols, r = (key - c) / cols;
    for (let first = 0; first < list.length; first += 1) {
      const i = list[first]!, a = segments[i]!;
      for (let second = first + 1; second < list.length; second += 1) {
        const j = list[second]!;
        const x0 = Math.max(boxes[i * 4]!, boxes[j * 4]!), y0 = Math.max(boxes[i * 4 + 1]!, boxes[j * 4 + 1]!);
        if (x0 > Math.min(boxes[i * 4 + 2]!, boxes[j * 4 + 2]!) || y0 > Math.min(boxes[i * 4 + 3]!, boxes[j * 4 + 3]!)) continue;
        // Ett par som delar flera rutor prövas bara i rutan där deras gemensamma ruta börjar.
        if (col(x0) !== c || row(y0) !== r) continue;
        const b = segments[j]!;
        // Ändar som ligger på den andra sträckan: T-korsningar, gemensamma ändar och sträckor som ligger på varandra.
        let touched = false;
        let t = touchAt(b.ax, b.ay, a.ax, a.ay, a.bx, a.by, snap);
        if (t >= 0) { split(i, t, b.ax, b.ay); touched = true; }
        t = touchAt(b.bx, b.by, a.ax, a.ay, a.bx, a.by, snap);
        if (t >= 0) { split(i, t, b.bx, b.by); touched = true; }
        t = touchAt(a.ax, a.ay, b.ax, b.ay, b.bx, b.by, snap);
        if (t >= 0) { split(j, t, a.ax, a.ay); touched = true; }
        t = touchAt(a.bx, a.by, b.ax, b.ay, b.bx, b.by, snap);
        if (t >= 0) { split(j, t, a.bx, a.by); touched = true; }
        if (touched) continue;
        // Annars en vanlig korsning.
        const rx = a.bx - a.ax, ry = a.by - a.ay, sx = b.bx - b.ax, sy = b.by - b.ay;
        const cross = rx * sy - ry * sx;
        if (cross === 0) continue;
        const qx = b.ax - a.ax, qy = b.ay - a.ay;
        const ta = (qx * sy - qy * sx) / cross, tb = (qx * ry - qy * rx) / cross;
        if (ta <= 0 || ta >= 1 || tb <= 0 || tb >= 1) continue;
        const x = a.ax + ta * rx, y = a.ay + ta * ry;
        split(i, ta, x, y); split(j, tb, x, y);
      }
    }
  }

  // Kanterna: varje sträcka som en kedja av noder. Samma nodpar från flera sträckor blir en kant med alla källor.
  const edges: Edge[] = [];
  const byPair = new Map<number, Map<number, Edge>>();
  const addEdge = (u: number, v: number, segment: Segment) => {
    if (u === v) return;
    const low = Math.min(u, v), high = Math.max(u, v);
    let row = byPair.get(low);
    if (!row) { row = new Map(); byPair.set(low, row); }
    const known = row.get(high);
    if (!known) { const edge: Edge = { u: low, v: high, sources: segment.sources, closure: segment.closure }; row.set(high, edge); edges.push(edge); return; }
    known.closure = known.closure && segment.closure;
    if (segment.sources.some(source => !known.sources.includes(source))) known.sources = [...new Set([...known.sources, ...segment.sources])];
  };
  segments.forEach((segment, index) => {
    const start = nodes.get(segment.ax, segment.ay), end = nodes.get(segment.bx, segment.by);
    const list = splits[index];
    if (!list) { addEdge(start, end, segment); return; }
    const order = Array.from({ length: list.length / 3 }, (_, at) => at * 3).sort((p, q) => list[p]! - list[q]!);
    let previous = start;
    for (const at of order) {
      const node = nodes.get(list[at + 1]!, list[at + 2]!);
      addEdge(previous, node, segment);
      previous = node;
    }
    addEdge(previous, end, segment);
  });
  return { xs: nodes.xs, ys: nodes.ys, edges };
}

/** Kanterna vid varje nod. */
export function adjacency(graph: Graph): number[][] {
  const out: number[][] = graph.xs.map(() => []);
  graph.edges.forEach((edge, index) => { out[edge.u]!.push(index); out[edge.v]!.push(index); });
  return out;
}

export { MAX_GRID };
