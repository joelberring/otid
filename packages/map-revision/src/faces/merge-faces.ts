import type { FacePoint } from "./index";

/**
 * K8b V4 (magisk fyll, dra över flera rutor): rutor ur samma plana graf slås ihop till en yta. Grannrutor delar exakt sina
 * kanter (åt motsatt håll, eftersom varje ruta har sin insida till vänster), så de gemensamma kanterna tas bort och det som
 * blir kvar spåras till ringar: moturs är ytterkanter, medurs hål. En kant som en granne delar på i två (en nod där en tredje
 * linje ansluter, som den ena rutan inte har kvar) delas först i grannens noder. Hålen behålls.
 *
 * Indata: varje ruta som ringar (ytterkanten moturs först, hålen medurs), som `Face` och Fyll ytas svar har dem. Utdata: en
 * eller flera ytor (rutor som inte rör varandra blir var sin), var och en som [ytterkant, ...hål].
 */
export function mergeFaceRings(faces: readonly (readonly (readonly FacePoint[])[])[], snap = 1e-6): FacePoint[][][] {
  const xs: number[] = [], ys: number[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, y: number) => `${Math.floor(x / snap / 4)},${Math.floor(y / snap / 4)}`;
  const nodeAt = (x: number, y: number): number => {
    const cx = Math.floor(x / snap / 4), cy = Math.floor(y / snap / 4);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const node of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.abs(xs[node]! - x) <= snap && Math.abs(ys[node]! - y) <= snap) return node;
    }
    const node = xs.length;
    xs.push(x); ys.push(y);
    const key = cellOf(x, y), list = cells.get(key);
    if (list) list.push(node); else cells.set(key, [node]);
    return node;
  };

  // Kanterna med riktning; varje ring en gång (samma ruta två gånger räknas en gång).
  const seenRings = new Set<string>();
  const raw: [number, number][] = [];
  for (const rings of faces) for (const ring of rings) {
    const nodes = ring.map(point => nodeAt(point.x, point.y)).filter((node, index, list) => node !== list[(index + list.length - 1) % list.length]);
    if (nodes.length < 3) continue;
    const start = nodes.indexOf(Math.min(...nodes));
    const key = [...nodes.slice(start), ...nodes.slice(0, start)].join(" ");
    if (seenRings.has(key)) continue;
    seenRings.add(key);
    nodes.forEach((node, index) => raw.push([node, nodes[(index + 1) % nodes.length]!]));
  }

  // Dela kanterna i noder som ligger på dem.
  const split: [number, number][] = [];
  for (const [u, v] of raw) {
    const ax = xs[u]!, ay = ys[u]!, dx = xs[v]! - ax, dy = ys[v]! - ay, length2 = dx * dx + dy * dy;
    const on: [number, number][] = [];
    if (length2 > 0) {
      const minX = Math.min(ax, xs[v]!) - snap, maxX = Math.max(ax, xs[v]!) + snap, minY = Math.min(ay, ys[v]!) - snap, maxY = Math.max(ay, ys[v]!) + snap;
      for (let node = 0; node < xs.length; node += 1) {
        if (node === u || node === v) continue;
        const x = xs[node]!, y = ys[node]!;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const t = ((x - ax) * dx + (y - ay) * dy) / length2;
        if (t <= 0 || t >= 1) continue;
        if (Math.abs((x - ax) * dy - (y - ay) * dx) / Math.sqrt(length2) <= snap) on.push([t, node]);
      }
    }
    on.sort((p, q) => p[0] - q[0]);
    let previous = u;
    for (const [, node] of on) { split.push([previous, node]); previous = node; }
    split.push([previous, v]);
  }

  // Gemensamma kanter (åt motsatt håll) tar ut varandra.
  const count = new Map<string, number>();
  for (const [u, v] of split) {
    const reverse = `${v} ${u}`;
    const back = count.get(reverse) ?? 0;
    if (back > 0) count.set(reverse, back - 1);
    else count.set(`${u} ${v}`, (count.get(`${u} ${v}`) ?? 0) + 1);
  }
  const outgoing = new Map<number, number[]>();
  const edges: [number, number][] = [];
  for (const [key, times] of count) {
    const [u, v] = key.split(" ").map(Number) as [number, number];
    for (let at = 0; at < times; at += 1) {
      const list = outgoing.get(u);
      if (list) list.push(edges.length); else outgoing.set(u, [edges.length]);
      edges.push([u, v]);
    }
  }

  // Spåra ringarna: vid en nod med flera kanter ut tas den som svänger skarpast till vänster (insidan till vänster), så att
  // ytor som bara rör varandra i en punkt blir var sin ring.
  const used = new Uint8Array(edges.length);
  const rings: { nodes: number[]; area: number }[] = [];
  for (let start = 0; start < edges.length; start += 1) {
    if (used[start]) continue;
    const nodes: number[] = [];
    let edge = start, area = 0;
    while (!used[edge]) {
      used[edge] = 1;
      const [u, v] = edges[edge]!;
      nodes.push(u);
      area += xs[u]! * ys[v]! - xs[v]! * ys[u]!;
      const choices = (outgoing.get(v) ?? []).filter(next => !used[next]);
      if (choices.length === 0) break;
      const inAngle = Math.atan2(ys[v]! - ys[u]!, xs[v]! - xs[u]!);
      let best = choices[0]!, bestTurn = -Infinity;
      for (const next of choices) {
        const w = edges[next]![1];
        let turn = Math.atan2(ys[w]! - ys[v]!, xs[w]! - xs[v]!) - inAngle;
        while (turn <= -Math.PI) turn += 2 * Math.PI;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn > bestTurn) { bestTurn = turn; best = next; }
      }
      edge = best;
    }
    if (nodes.length >= 3 && area !== 0) rings.push({ nodes, area: area / 2 });
  }

  const points = (nodes: readonly number[]) => withoutCollinear(nodes.map(node => ({ x: xs[node]!, y: ys[node]! })));
  const outers = rings.filter(ring => ring.area > 0).sort((a, b) => a.area - b.area).map(ring => ({ ring: points(ring.nodes), area: ring.area, holes: [] as FacePoint[][] }));
  for (const hole of rings) {
    if (hole.area >= 0) continue;
    const ring = points(hole.nodes);
    // En punkt strax till vänster om hålets första kant ligger i ytan runt hålet.
    const a = ring[0]!, b = ring[1]!, length = Math.hypot(b.x - a.x, b.y - a.y) || 1, nudge = Math.max(snap * 10, length * 1e-6);
    const probe = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * nudge, y: (a.y + b.y) / 2 + (b.x - a.x) / length * nudge };
    outers.find(outer => outer.area > -hole.area && insideRing(outer.ring, probe))?.holes.push(ring);
  }
  return outers.map(outer => [outer.ring, ...outer.holes]);
}

function insideRing(ring: readonly FacePoint[], point: FacePoint): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ringen utan punkter mitt på raka sträckor (där grannrutornas noder satt). */
function withoutCollinear(ring: readonly FacePoint[]): FacePoint[] {
  const out = [...ring];
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let index = 0; index < out.length && out.length > 3; index += 1) {
      const a = out[(index + out.length - 1) % out.length]!, b = out[index]!, c = out[(index + 1) % out.length]!;
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), length = Math.hypot(c.x - a.x, c.y - a.y);
      if (length > 0 && Math.abs(cross) / length < 1e-9 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) { out.splice(index, 1); index -= 1; changed = true; }
    }
  }
  return out;
}
