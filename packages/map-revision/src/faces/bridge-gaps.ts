import { SHORTCUT } from "./close-gaps";
import { adjacency, MAX_GRID, type Graph, type Segment } from "./node";

/**
 * Ytor ur linjer, steg 2 av glappen (K8b V2, ägaren 2026-11-21: fyllen ska inte kräva att alla hörn är helt slutna). När en
 * ruta inte blir sluten vid grundtoleransen (`close-gaps.ts`) prövas de lösa ändar som är kvar upp till ett större glapp, i
 * den här ordningen:
 *
 * 1. Hörn som inte möts: två ändar vars förlängningar skär varandra inom glappet från båda ändarna sluts med två raka bitar
 *    till skärningspunkten (två väggar eller kanter som slutar strax före hörnet). Bara när vinkeln mellan ändarnas
 *    riktningar är 30–150°.
 * 2. Rak förlängning av en ände till närmaste linje framför den.
 * 3. Kortaste bryggan mellan två ändar som pekar ungefär mot varandra (högst 60° från riktningen mot den andra).
 *
 * Varje bit ska vara en genväg som i steg 1 (vägen längs linjerna minst dubbelt så lång), och hörnens och bryggornas bitar
 * får inte korsa någon linje. Varje ände används högst en gång. Om att bryggorna är rimliga för en viss ruta (högst en
 * femtedel av omkretsen) avgör den som väljer ytan (`BRIDGE_SHARE`).
 */
export type BridgeKind = "corner" | "extend" | "bridge";

export interface Bridge { readonly kind: BridgeKind; readonly pieces: Segment[] }

/** Hörnets vinkel mellan ändarnas riktningar: mellan 30° och 150°. */
const CORNER_COS = Math.cos(Math.PI / 6);
/** Bryggans ändar: högst 60° mellan ändens riktning och riktningen mot den andra änden. */
const FACING_COS = Math.cos(Math.PI / 3);

interface End { readonly node: number; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }

/** Bryggorna, eller undefined när `deadline` (performance.now()) passerades. */
export function bridgeGaps(graph: Graph, tolerance: number, snap: number, deadline = Infinity): Bridge[] | undefined {
  const { xs, ys, edges } = graph;
  const around = adjacency(graph);
  const ends: End[] = [];
  around.forEach((list, node) => {
    if (list.length !== 1) return;
    const edge = edges[list[0]!]!, from = edge.u === node ? edge.v : edge.u;
    const length = Math.hypot(xs[node]! - xs[from]!, ys[node]! - ys[from]!);
    if (length > 0) ends.push({ node, x: xs[node]!, y: ys[node]!, dx: (xs[node]! - xs[from]!) / length, dy: (ys[node]! - ys[from]!) / length });
  });
  if (ends.length === 0 || tolerance <= 0) return [];

  // Kanterna och ändarna i rutnät, så att bara de nära prövas.
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
  const endGrid: (number[] | undefined)[] = new Array<number[] | undefined>(cols * rows);
  ends.forEach((end, index) => { (endGrid[row(end.y) * cols + col(end.x)] ??= []).push(index); });
  let stamp = 0;
  const seen = new Int32Array(edges.length);
  /** Kanterna vars rutor når rutan kring x0–x1, y0–y1, var och en en gång. */
  const edgesNear = (x0: number, y0: number, x1: number, y1: number, visit: (index: number) => boolean | void) => {
    stamp += 1;
    for (let c = col(x0); c <= col(x1); c += 1) for (let r = row(y0); r <= row(y1); r += 1) {
      for (const index of grid[r * cols + c] ?? []) {
        if (seen[index] === stamp) continue;
        seen[index] = stamp;
        if (visit(index)) return;
      }
    }
  };
  /** Korsar sträckan a–b någon kant (annat än vid ändarna)? */
  const crosses = (ax: number, ay: number, bx: number, by: number, own: readonly number[]) => {
    let hit = false;
    const rx = bx - ax, ry = by - ay, length = Math.hypot(rx, ry);
    if (length <= snap) return false;
    const margin = snap / length;
    edgesNear(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), index => {
      const edge = edges[index]!;
      if (own.includes(edge.u) || own.includes(edge.v)) return;
      const sx = xs[edge.v]! - xs[edge.u]!, sy = ys[edge.v]! - ys[edge.u]!;
      const cross = rx * sy - ry * sx;
      if (cross === 0) return;
      const qx = xs[edge.u]! - ax, qy = ys[edge.u]! - ay;
      const t = (qx * sy - qy * sx) / cross, u = (qx * ry - qy * rx) / cross;
      if (t > margin && t < 1 - margin && u >= 0 && u <= 1) { hit = true; return true; }
    });
    return hit;
  };

  // Vägen längs linjerna från en ände (så långt som genvägsprovet för ett hörn behöver).
  const horizon = tolerance * 2 * SHORTCUT;
  const paths = new Map<number, Map<number, number>>();
  const pathFrom = (end: number) => {
    let path = paths.get(end);
    if (path) return path;
    path = new Map<number, number>([[end, 0]]);
    const queue = [end];
    for (let at = 0; at < queue.length; at += 1) {
      const node = queue[at]!, distance = path.get(node)!;
      for (const index of around[node]!) {
        const edge = edges[index]!, next = edge.u === node ? edge.v : edge.u;
        const total = distance + Math.hypot(xs[next]! - xs[node]!, ys[next]! - ys[node]!);
        if (total < horizon && total < (path.get(next) ?? Infinity)) { path.set(next, total); queue.push(next); }
      }
    }
    paths.set(end, path);
    return path;
  };
  const piece = (ax: number, ay: number, bx: number, by: number, bridge: number): Segment => ({ ax, ay, bx, by, sources: [], closure: true, bridge });

  // Ändarnas par inom räckhåll (för hörn och bryggor).
  const pairs: { i: number; j: number; length: number; kind: "corner" | "bridge"; x: number; y: number }[] = [];
  for (const [i, a] of ends.entries()) {
    if (performance.now() > deadline) return undefined;
    const reach = tolerance * 2;
    for (let c = col(a.x - reach); c <= col(a.x + reach); c += 1) for (let r = row(a.y - reach); r <= row(a.y + reach); r += 1) {
      for (const j of endGrid[r * cols + c] ?? []) {
        if (j <= i) continue;
        const b = ends[j]!, qx = b.x - a.x, qy = b.y - a.y, distance = Math.hypot(qx, qy);
        if (distance > reach || distance <= snap) continue;
        const cross = a.dx * b.dy - a.dy * b.dx;
        // Hörnet: förlängningarnas skärning.
        if (Math.abs(a.dx * b.dx + a.dy * b.dy) <= CORNER_COS && cross !== 0) {
          const s = (qx * b.dy - qy * b.dx) / cross, t = (qx * a.dy - qy * a.dx) / cross;
          if (s > snap && t > snap && s <= tolerance && t <= tolerance) {
            pairs.push({ i, j, length: s + t, kind: "corner", x: a.x + s * a.dx, y: a.y + s * a.dy });
            continue;
          }
        }
        // Bryggan: ändarna pekar ungefär mot varandra.
        if (distance <= tolerance && (a.dx * qx + a.dy * qy) / distance >= FACING_COS && -(b.dx * qx + b.dy * qy) / distance >= FACING_COS) {
          pairs.push({ i, j, length: distance, kind: "bridge", x: b.x, y: b.y });
        }
      }
    }
  }
  pairs.sort((p, q) => p.length - q.length);

  const used = new Uint8Array(ends.length);
  const bridges: Bridge[] = [];

  // 1. Hörnen, kortaste först.
  for (const candidate of pairs) {
    if (candidate.kind !== "corner" || used[candidate.i] || used[candidate.j]) continue;
    if (performance.now() > deadline) return undefined;
    const a = ends[candidate.i]!, b = ends[candidate.j]!;
    if ((pathFrom(a.node).get(b.node) ?? Infinity) < candidate.length * SHORTCUT) continue;
    if (crosses(a.x, a.y, candidate.x, candidate.y, [a.node]) || crosses(b.x, b.y, candidate.x, candidate.y, [b.node])) continue;
    used[candidate.i] = 1; used[candidate.j] = 1;
    const index = bridges.length;
    bridges.push({ kind: "corner", pieces: [piece(a.x, a.y, candidate.x, candidate.y, index), piece(b.x, b.y, candidate.x, candidate.y, index)] });
  }

  // 2. Rak förlängning till närmaste linje framför änden.
  for (const [i, end] of ends.entries()) {
    if (used[i]) continue;
    if (performance.now() > deadline) return undefined;
    let best = Infinity, bestX = 0, bestY = 0;
    const tx = end.x + end.dx * tolerance, ty = end.y + end.dy * tolerance;
    edgesNear(Math.min(end.x, tx), Math.min(end.y, ty), Math.max(end.x, tx), Math.max(end.y, ty), index => {
      const edge = edges[index]!;
      if (edge.u === end.node || edge.v === end.node) return;
      const ax = xs[edge.u]!, ay = ys[edge.u]!, sx = xs[edge.v]! - ax, sy = ys[edge.v]! - ay;
      const cross = end.dx * sy - end.dy * sx;
      if (cross === 0) return;
      const qx = ax - end.x, qy = ay - end.y;
      const along = (qx * sy - qy * sx) / cross, on = (qx * end.dy - qy * end.dx) / cross;
      if (along <= snap || along > tolerance || along >= best || on < 0 || on > 1) return;
      const x = end.x + along * end.dx, y = end.y + along * end.dy, path = pathFrom(end.node);
      const via = Math.min((path.get(edge.u) ?? Infinity) + Math.hypot(x - ax, y - ay), (path.get(edge.v) ?? Infinity) + Math.hypot(x - xs[edge.v]!, y - ys[edge.v]!));
      if (via >= along * SHORTCUT) { best = along; bestX = x; bestY = y; }
    });
    if (best === Infinity) continue;
    used[i] = 1;
    bridges.push({ kind: "extend", pieces: [piece(end.x, end.y, bestX, bestY, bridges.length)] });
  }

  // 3. Bryggor mellan ändar som pekar mot varandra, kortaste först.
  for (const candidate of pairs) {
    if (candidate.kind !== "bridge" || used[candidate.i] || used[candidate.j]) continue;
    if (performance.now() > deadline) return undefined;
    const a = ends[candidate.i]!, b = ends[candidate.j]!;
    if ((pathFrom(a.node).get(b.node) ?? Infinity) < candidate.length * SHORTCUT) continue;
    if (crosses(a.x, a.y, b.x, b.y, [a.node, b.node])) continue;
    used[candidate.i] = 1; used[candidate.j] = 1;
    bridges.push({ kind: "bridge", pieces: [piece(a.x, a.y, b.x, b.y, bridges.length)] });
  }
  return bridges;
}
