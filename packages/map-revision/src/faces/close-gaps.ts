import { adjacency, MAX_GRID, type Graph, type Segment } from "./node";

/**
 * Ytor ur linjer, steg 2: glappen. En lös ände (en nod med en enda kant) förlängs rakt fram i sin riktning till första
 * kanten inom toleransen; träffar den inget dras kortaste biten till närmaste kant eller ände inom toleransen. Bitarna är
 * märkta som slutningar (`closure`) och blir aldrig kantlinjer. Mätningen på Älvsjö–Solberga: över hälften av de lösa
 * ändarna sluts redan vid 0,25 m och 2 m är en rimlig övre gräns.
 *
 * En bit räknas bara när den är en genväg: vägen längs linjerna från änden till målet ska vara minst dubbelt så lång som
 * biten. Annars skulle en kort stump «slutas» mot linjen den själv sitter på.
 */
const SHORTCUT = 2;

export function closeGaps(graph: Graph, tolerance: number, snap: number): { closures: Segment[]; looseEnds: number } {
  const { xs, ys, edges } = graph;
  const around = adjacency(graph);
  const ends: number[] = [];
  around.forEach((list, node) => { if (list.length === 1) ends.push(node); });
  if (ends.length === 0 || tolerance <= 0) return { closures: [], looseEnds: ends.length };

  // Kanterna i ett rutnät, så att bara de nära änden prövas.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let node = 0; node < xs.length; node += 1) {
    minX = Math.min(minX, xs[node]!); maxX = Math.max(maxX, xs[node]!);
    minY = Math.min(minY, ys[node]!); maxY = Math.max(maxY, ys[node]!);
  }
  const cell = Math.max(tolerance * 2, Math.max(maxX - minX, maxY - minY) / MAX_GRID);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell)), rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cell)));
  const row = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cell)));
  const grid: (number[] | undefined)[] = new Array<number[] | undefined>(cols * rows);
  edges.forEach((edge, index) => {
    const c0 = col(Math.min(xs[edge.u]!, xs[edge.v]!)), c1 = col(Math.max(xs[edge.u]!, xs[edge.v]!));
    const r0 = row(Math.min(ys[edge.u]!, ys[edge.v]!)), r1 = row(Math.max(ys[edge.u]!, ys[edge.v]!));
    for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) (grid[r * cols + c] ??= []).push(index);
  });

  const closures: Segment[] = [];
  const seen = new Int32Array(edges.length).fill(-1);
  for (const [order, end] of ends.entries()) {
    const px = xs[end]!, py = ys[end]!;
    const own = edges[around[end]![0]!]!, from = own.u === end ? own.v : own.u;
    const length = Math.hypot(px - xs[from]!, py - ys[from]!);
    const dx = (px - xs[from]!) / length, dy = (py - ys[from]!) / length;

    // Vägen längs linjerna från änden till noderna i närheten (bara så långt som genvägsprovet behöver).
    const horizon = tolerance * SHORTCUT;
    const path = new Map<number, number>([[end, 0]]);
    const queue = [end];
    for (let at = 0; at < queue.length; at += 1) {
      const node = queue[at]!, distance = path.get(node)!;
      for (const index of around[node]!) {
        const edge = edges[index]!, next = edge.u === node ? edge.v : edge.u;
        const total = distance + Math.hypot(xs[next]! - xs[node]!, ys[next]! - ys[node]!);
        if (total < horizon && total < (path.get(next) ?? Infinity)) { path.set(next, total); queue.push(next); }
      }
    }
    const isShortcut = (edge: { u: number; v: number }, x: number, y: number, distance: number) => {
      const viaU = (path.get(edge.u) ?? Infinity) + Math.hypot(x - xs[edge.u]!, y - ys[edge.u]!);
      const viaV = (path.get(edge.v) ?? Infinity) + Math.hypot(x - xs[edge.v]!, y - ys[edge.v]!);
      return Math.min(viaU, viaV) >= distance * SHORTCUT;
    };

    // (a) rakt fram, (b) närmaste punkt.
    let ray = Infinity, rayX = 0, rayY = 0, near = Infinity, nearX = 0, nearY = 0;
    const c0 = col(px - tolerance), c1 = col(px + tolerance), r0 = row(py - tolerance), r1 = row(py + tolerance);
    for (let c = c0; c <= c1; c += 1) for (let r = r0; r <= r1; r += 1) {
      for (const index of grid[r * cols + c] ?? []) {
        if (seen[index] === order) continue;
        seen[index] = order;
        const edge = edges[index]!;
        if (edge.u === end || edge.v === end) continue;
        const ax = xs[edge.u]!, ay = ys[edge.u]!, sx = xs[edge.v]! - ax, sy = ys[edge.v]! - ay;
        const cross = dx * sy - dy * sx;
        if (cross !== 0) {
          const qx = ax - px, qy = ay - py;
          const along = (qx * sy - qy * sx) / cross, on = (qx * dy - qy * dx) / cross;
          if (along > snap && along <= tolerance && along < ray && on >= 0 && on <= 1) {
            const x = px + along * dx, y = py + along * dy;
            if (isShortcut(edge, x, y, along)) { ray = along; rayX = x; rayY = y; }
          }
        }
        const size = sx * sx + sy * sy;
        const t = size === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / size));
        const x = ax + t * sx, y = ay + t * sy, distance = Math.hypot(x - px, y - py);
        if (distance > snap && distance <= tolerance && distance < near && isShortcut(edge, x, y, distance)) { near = distance; nearX = x; nearY = y; }
      }
    }
    if (ray < Infinity) closures.push({ ax: px, ay: py, bx: rayX, by: rayY, sources: [], closure: true });
    else if (near < Infinity) closures.push({ ax: px, ay: py, bx: nearX, by: nearY, sources: [], closure: true });
  }
  return { closures, looseEnds: ends.length };
}
