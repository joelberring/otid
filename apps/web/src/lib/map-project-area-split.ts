import type { Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-13: dela kartområdet (eller en del) som man skär tårtbitar – med ETT streck. Polygonen (första ringen
 * ytterkant, resten hål) delas längs en polylinje. Delarna täcker tillsammans exakt polygonen och har gemensam gräns med
 * samma koordinater på båda sidor: skärningspunkterna räknas en gång och sätts in i båda delarna, så inget hamnar dubbelt
 * eller utanför när laserjobb och inläsning klipps mot delarna.
 *
 * Så här: polygonens kanter och streckets sträckor läggs i en plan graf (med skärningspunkterna som noder), strecket behålls
 * bara där det går inne i polygonen, lösa ändar och streck som inte delar något tas bort, och ytorna läses ut ur grafen.
 */
export type SplitPolygon = readonly (readonly Point[])[];
export type PolygonSplit = { status: "split"; parts: Point[][][] }
  /** Strecket går inte in i polygonen alls. */
  | { status: "outside" }
  /** Strecket går in i polygonen men inte tvärs över (det slutar inne i den). */
  | { status: "not-across" };

/** Punkter närmare varandra än så (kartans mm) är samma punkt. */
const EPS = 1e-7;
const CELL = 1e-6;

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

function signedArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; sum += cross(a.x, a.y, b.x, b.y); }
  return sum / 2;
}

function inRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const inPolygon = (point: Point, polygon: SplitPolygon) => !!polygon[0] && inRing(point, polygon[0]) && !polygon.slice(1).some(ring => inRing(point, ring));

/** Polygonens yta (ytterkanten minus hålen). */
export function polygonArea(polygon: SplitPolygon): number {
  return polygon.reduce((sum, ring, index) => sum + (index === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0);
}

/** Utan upprepade punkter i följd (och utan slutpunkt lika med startpunkten när `closed`). */
function clean(points: readonly Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > EPS) out.push({ x: point.x, y: point.y });
  }
  if (closed && out.length > 1 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) <= EPS) out.pop();
  return out;
}

/** Avståndet från `end` i riktningen bort från `before` till polygonens närmaste kant; undefined om strålen inte träffar. */
function rayToEdge(end: Point, before: Point, rings: readonly (readonly Point[])[]): { distance: number; dx: number; dy: number } | undefined {
  const length = Math.hypot(end.x - before.x, end.y - before.y);
  const dx = (end.x - before.x) / length, dy = (end.y - before.y) / length;
  let best: number | undefined;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = cross(dx, dy, ex, ey);
    if (Math.abs(denom) < 1e-12 * Math.hypot(ex, ey)) continue;
    const t = cross(a.x - end.x, a.y - end.y, ex, ey) / denom;
    const u = cross(a.x - end.x, a.y - end.y, dx, dy) / denom;
    if (t > 0 && u >= 0 && u <= 1 && (best === undefined || t < best)) best = t;
  }
  return best === undefined ? undefined : { distance: best, dx, dy };
}

interface Segment { readonly a: number; readonly b: number; readonly cut: boolean; readonly splits: number[] }
interface Edge { readonly a: number; readonly b: number; readonly cut: boolean;
  /** Polygonens insida ligger till vänster om a→b respektive b→a. */
  insideAb: boolean; insideBa: boolean }

/**
 * Delar `polygon` längs `line` (två eller flera punkter). En ände som slutar inne i polygonen högst `reach` från kanten
 * förlängs rakt fram till kanten; en ände som slutar längre in delar ingenting. Delarna kommer med den största först.
 */
export function splitPolygon(polygon: SplitPolygon, line: readonly Point[], reach = 0): PolygonSplit {
  const rings = polygon.map(ring => clean(ring, true)).filter(ring => ring.length >= 3)
    // Insidan till vänster: ytterkanten moturs, hålen medurs.
    .map((ring, index) => (signedArea(ring) > 0) === (index === 0) ? ring : [...ring].reverse());
  const path = clean(line, false);
  if (!rings[0] || path.length < 2) return { status: "outside" };
  for (const first of [true, false]) {
    const end = first ? path[0]! : path[path.length - 1]!, before = first ? path[1]! : path[path.length - 2]!;
    if (!inPolygon(end, rings)) continue;
    const hit = rayToEdge(end, before, rings);
    if (!hit || hit.distance > reach) continue;
    const far = hit.distance + Math.max(reach, EPS * 10);
    path[first ? 0 : path.length - 1] = { x: end.x + hit.dx * far, y: end.y + hit.dy * far };
  }

  // Noderna: polygonens hörn behåller sina koordinater; en ny punkt intill en nod blir den noden.
  const nodes: Point[] = [];
  const grid = new Map<string, number[]>();
  const nodeAt = (point: Point): number => {
    const cx = Math.round(point.x / CELL), cy = Math.round(point.y / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
      for (const id of grid.get(`${ix},${iy}`) ?? []) if (Math.hypot(nodes[id]!.x - point.x, nodes[id]!.y - point.y) <= EPS) return id;
    }
    const id = nodes.push({ x: point.x, y: point.y }) - 1;
    const key = `${cx},${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
    return id;
  };
  const segments: Segment[] = [];
  const add = (from: Point, to: Point, cut: boolean) => {
    const a = nodeAt(from), b = nodeAt(to);
    if (a !== b) segments.push({ a, b, cut, splits: [] });
  };
  for (const ring of rings) ring.forEach((point, index) => add(point, ring[(index + 1) % ring.length]!, false));
  const firstCut = segments.length, ringNodes = nodes.length;
  for (let i = 0; i + 1 < path.length; i += 1) add(path[i]!, path[i + 1]!, true);

  /** Noden `node` ligger på sträckan (inte i dess ändar): den delar sträckan där. */
  const touch = (segment: Segment, node: number): boolean => {
    if (node === segment.a || node === segment.b) return true;
    const a = nodes[segment.a]!, b = nodes[segment.b]!, p = nodes[node]!;
    const ex = b.x - a.x, ey = b.y - a.y, length = Math.hypot(ex, ey);
    const along = ((p.x - a.x) * ex + (p.y - a.y) * ey) / length;
    if (along <= 0 || along >= length || Math.abs(cross(ex, ey, p.x - a.x, p.y - a.y)) / length > EPS) return false;
    segment.splits.push(node);
    return true;
  };
  for (let i = firstCut; i < segments.length; i += 1) for (let j = 0; j < i; j += 1) {
    const s = segments[i]!, o = segments[j]!;
    // Var för sig: alla fyra ändar prövas (en sträcka längs en annan delas i båda sina ändar).
    const touches = [touch(o, s.a), touch(o, s.b), touch(s, o.a), touch(s, o.b)];
    if (touches.some(Boolean)) continue;
    const a = nodes[s.a]!, b = nodes[s.b]!, c = nodes[o.a]!, d = nodes[o.b]!;
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const denom = cross(rx, ry, sx, sy);
    if (Math.abs(denom) < 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) continue;
    const t = cross(c.x - a.x, c.y - a.y, sx, sy) / denom, u = cross(c.x - a.x, c.y - a.y, rx, ry) / denom;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
    // Skärningspunkten räknas en gång och blir samma nod i båda sträckorna.
    const node = nodeAt({ x: a.x + t * rx, y: a.y + t * ry });
    if (node !== s.a && node !== s.b) s.splits.push(node);
    if (node !== o.a && node !== o.b) o.splits.push(node);
  }

  const edges = new Map<string, Edge>();
  let cuts = 0;
  for (const segment of segments) {
    const from = nodes[segment.a]!;
    const order = [segment.a, ...[...new Set(segment.splits)].sort((p, q) =>
      Math.hypot(nodes[p]!.x - from.x, nodes[p]!.y - from.y) - Math.hypot(nodes[q]!.x - from.x, nodes[q]!.y - from.y)), segment.b];
    for (let i = 0; i + 1 < order.length; i += 1) {
      const a = order[i]!, b = order[i + 1]!;
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`, known = edges.get(key);
      if (!segment.cut) {
        const edge = known ?? { a, b, cut: false, insideAb: false, insideBa: false };
        if (edge.a === a) edge.insideAb = true; else edge.insideBa = true;
        edges.set(key, edge);
      } else if (!known && inPolygon({ x: (nodes[a]!.x + nodes[b]!.x) / 2, y: (nodes[a]!.y + nodes[b]!.y) / 2 }, rings)) {
        edges.set(key, { a, b, cut: true, insideAb: true, insideBa: true });
        cuts += 1;
      }
    }
  }
  if (cuts === 0) return { status: "outside" };

  // Ytorna: varje halvkant följs med ytan till vänster. Ett streck med samma yta på båda sidor delar inget och tas bort.
  for (;;) {
    const list = [...edges.values()];
    const out = new Map<number, { to: number; half: number; angle: number; cut: boolean }[]>();
    list.forEach((edge, index) => {
      for (const [from, to, half] of [[edge.a, edge.b, index * 2], [edge.b, edge.a, index * 2 + 1]] as const) {
        const row = out.get(from) ?? [];
        row.push({ to, half, cut: edge.cut, angle: Math.atan2(nodes[to]!.y - nodes[from]!.y, nodes[to]!.x - nodes[from]!.x) });
        out.set(from, row);
      }
    });
    for (const row of out.values()) row.sort((p, q) => p.angle - q.angle);
    const cycleOf = new Int32Array(list.length * 2).fill(-1);
    const cycles: { nodes: number[]; inside: boolean }[] = [];
    for (let start = 0; start < list.length * 2; start += 1) {
      if (cycleOf[start] !== -1) continue;
      const cycle = { nodes: [] as number[], inside: false };
      let half = start;
      while (cycleOf[half] === -1) {
        cycleOf[half] = cycles.length;
        const edge = list[half >> 1]!, forward = (half & 1) === 0;
        const from = forward ? edge.a : edge.b, to = forward ? edge.b : edge.a;
        cycle.nodes.push(from);
        if (forward ? edge.insideAb : edge.insideBa) cycle.inside = true;
        // Nästa kant: den närmast medurs om kanten tillbaka.
        const row = out.get(to)!;
        const back = row.findIndex(entry => entry.to === from);
        half = row[(back - 1 + row.length) % row.length]!.half;
      }
      cycles.push(cycle);
    }
    const loose = list.filter((edge, index) => edge.cut && cycleOf[index * 2] === cycleOf[index * 2 + 1]);
    if (loose.length > 0) {
      for (const edge of loose) edges.delete(edge.a < edge.b ? `${edge.a}-${edge.b}` : `${edge.b}-${edge.a}`);
      if (!list.some(edge => edge.cut && !loose.includes(edge))) return { status: "not-across" };
      continue;
    }
    // En skärningspunkt på kanten där strecket sedan togs bort (det slutade inne i polygonen) är ingen brytpunkt.
    const kept = (id: number) => id < ringNodes || out.get(id)!.length !== 2 || out.get(id)!.some(entry => entry.cut);
    const shapes = cycles.filter(cycle => cycle.inside).map(cycle => cycle.nodes.filter(kept).map(id => ({ x: nodes[id]!.x, y: nodes[id]!.y })))
      .filter(ring => ring.length >= 3).map(ring => ({ ring, area: signedArea(ring) }));
    const parts = shapes.filter(shape => shape.area > 0).map(shape => [shape.ring]);
    // Hål som strecket inte rörde hör till den del de ligger i.
    for (const hole of shapes.filter(shape => shape.area < 0)) parts.find(part => inRing(hole.ring[0]!, part[0]!))?.push(hole.ring);
    if (parts.length < 2) return { status: "not-across" };
    return { status: "split", parts: parts.sort((p, q) => polygonArea(q) - polygonArea(p)) };
  }
}

/** Ett delområde som kan delas. */
export interface SplitTarget { readonly areaId: string; readonly polygon: SplitPolygon }
export type AreaSplitPlan =
  /** `changed` = delområden som krymper till sin största del; `added` = de nya delarna (`from` = området de skars ur). */
  | { status: "split"; changed: { areaId: string; polygon: Point[][] }[]; added: { from: string | undefined; polygon: Point[][] }[] }
  | { status: "outside" | "not-across" | "too-complex" };

/** Så långt in (andel av områdets diagonal) får strecket sluta och ändå förlängas till kanten. */
const REACH_SHARE = 0.03;
/** Serverns gränser för ett delområde (`mapProjectAreaPolygonSchema`). */
const MAX_RINGS = 20, MAX_POINTS = 2000;

function reachOf(polygon: SplitPolygon): number {
  const outer = polygon[0] ?? [];
  if (outer.length === 0) return 0;
  const xs = outer.map(point => point.x), ys = outer.map(point => point.y);
  return REACH_SHARE * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * Vad ett streck delar: de delområden det går tvärs över (bara `only` när ett område är valt i listan). Går strecket inte in
 * i något delområde delas hela kartområdet `whole`.
 */
export function planAreaSplit(areas: readonly SplitTarget[], whole: SplitPolygon | undefined, line: readonly Point[], only?: string): AreaSplitPlan {
  const changed: { areaId: string; polygon: Point[][] }[] = [], added: { from: string | undefined; polygon: Point[][] }[] = [];
  let entered = false;
  for (const area of areas) {
    if (only && area.areaId !== only) continue;
    const result = splitPolygon(area.polygon, line, reachOf(area.polygon));
    if (result.status === "not-across") entered = true;
    if (result.status !== "split") continue;
    changed.push({ areaId: area.areaId, polygon: result.parts[0]! });
    added.push(...result.parts.slice(1).map(polygon => ({ from: area.areaId, polygon })));
  }
  if (changed.length === 0) {
    if (entered) return { status: "not-across" };
    if (only || !whole) return { status: "outside" };
    const result = splitPolygon(whole, line, reachOf(whole));
    if (result.status !== "split") return result;
    added.push(...result.parts.map(polygon => ({ from: undefined, polygon })));
  }
  const tooComplex = (polygon: Point[][]) => polygon.length > MAX_RINGS || polygon.some(ring => ring.length > MAX_POINTS);
  if (changed.some(item => tooComplex(item.polygon)) || added.some(item => tooComplex(item.polygon))) return { status: "too-complex" };
  return { status: "split", changed, added };
}

/** Nästa lediga löpnummer för namn som "Del 3": ett mer än det högsta som finns. */
export function nextPartNumber(names: readonly string[], prefix: string): number {
  let highest = 0;
  for (const name of names) {
    const rest = name.trim().startsWith(`${prefix} `) ? name.trim().slice(prefix.length + 1) : "";
    if (/^\d{1,6}$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return highest + 1;
}
