import type { FaceLine, FacePoint } from "./index";

/**
 * K8b V4 (reserven i magisk fyll, `raster-fill.ts`): bildens kant tillbaka till linjerna. Varje punkt inom `snap` från en
 * gränslinje flyttas till närmaste punkt på linjen, och mellan två punkter på samma linje tas linjens egna punkter med, så att
 * kanten blir densamma som grannens. Punkter långt från alla linjer sitter där ett glapp slöts: de tas bort (glappet sluts rakt).
 */
export interface IndexedSegment {
  readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number;
  /** Linjens nummer och sträckans nummer i linjen (mellan punkt `at` och `at + 1`). */
  readonly line: number; readonly at: number;
}

export interface LineIndex {
  readonly segments: readonly IndexedSegment[];
  readonly lines: readonly FaceLine[];
  near(x: number, y: number, visit: (segment: number) => void): void;
}

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

function clipped(ax: number, ay: number, bx: number, by: number, box: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - box.minX], [dx, box.maxX - ax], [-dy, ay - box.minY], [dy, box.maxY - ay]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** Linjernas sträckor som når rutan (vidgad med `snap`), i ett rutnät för närmaste-sökningen. */
export function lineIndex(lines: readonly FaceLine[], box: Box, snap: number): LineIndex {
  const wide = { minX: box.minX - snap, minY: box.minY - snap, maxX: box.maxX + snap, maxY: box.maxY + snap };
  const segments: IndexedSegment[] = [];
  lines.forEach((line, index) => {
    const points = line.points, count = line.closed && points.length > 2 ? points.length : points.length - 1;
    for (let at = 0; at < count; at += 1) {
      const a = points[at]!, b = points[(at + 1) % points.length]!;
      if (clipped(a.x, a.y, b.x, b.y, wide)) segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, line: index, at });
    }
  });
  const size = Math.max(snap * 6, Math.max(wide.maxX - wide.minX, wide.maxY - wide.minY) / 512);
  const cols = Math.max(1, Math.ceil((wide.maxX - wide.minX) / size)), rows = Math.max(1, Math.ceil((wide.maxY - wide.minY) / size));
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - wide.minX) / size)));
  const row = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - wide.minY) / size)));
  const grid: (number[] | undefined)[] = new Array<number[] | undefined>(cols * rows);
  segments.forEach((segment, index) => {
    const reach = 1.5 * snap;
    for (let c = col(Math.min(segment.ax, segment.bx) - reach); c <= col(Math.max(segment.ax, segment.bx) + reach); c += 1) {
      for (let r = row(Math.min(segment.ay, segment.by) - reach); r <= row(Math.max(segment.ay, segment.by) + reach); r += 1) (grid[r * cols + c] ??= []).push(index);
    }
  });
  return { segments, lines, near(x, y, visit) { for (const index of grid[row(y) * cols + col(x)] ?? []) visit(index); } };
}

interface Snapped { readonly point: FacePoint; readonly line: number; readonly at: number }

/** Linjernas egna punkter fångas först (inom 1,5 × `snap`), så att hörnen blir linjernas hörn. */
function snapPoint(point: FacePoint, index: LineIndex, snap: number): Snapped | undefined {
  let best: Snapped | undefined, bestDistance = (1.5 * snap) ** 2;
  index.near(point.x, point.y, number => {
    const s = index.segments[number]!;
    for (const [x, y, at] of [[s.ax, s.ay, s.at], [s.bx, s.by, s.at + 1]] as const) {
      const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
      if (distance <= bestDistance) { bestDistance = distance; best = { point: { x, y }, line: s.line, at: at % index.lines[s.line]!.points.length }; }
    }
  });
  if (best) return best;
  bestDistance = snap * snap;
  index.near(point.x, point.y, number => {
    const s = index.segments[number]!, dx = s.bx - s.ax, dy = s.by - s.ay, length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - s.ax) * dx + (point.y - s.ay) * dy) / length));
    const x = s.ax + t * dx, y = s.ay + t * dy, distance = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distance <= bestDistance) { bestDistance = distance; best = { point: { x, y }, line: s.line, at: s.at }; }
  });
  return best;
}

/** Linjens punkter mellan två fästa punkter på samma linje, när vägen längs linjen är rimlig (inte runt hela linjen). */
function between(from: Snapped, to: Snapped, index: LineIndex, snap: number): FacePoint[] {
  if (from.line !== to.line || from.at === to.at) return [];
  const line = index.lines[from.line]!, points = line.points, n = points.length;
  const forward: FacePoint[] = [], backward: FacePoint[] = [];
  if (to.at > from.at) for (let at = from.at + 1; at <= to.at; at += 1) forward.push(points[at]!);
  else for (let at = from.at; at > to.at; at -= 1) backward.push(points[at]!);
  let path = to.at > from.at ? forward : backward;
  if (line.closed) {
    // Runt ringen åt andra hållet kan vara kortare.
    const other: FacePoint[] = [];
    if (to.at > from.at) for (let at = from.at; at !== to.at; at = (at - 1 + n) % n) other.push(points[at]!);
    else for (let at = (from.at + 1) % n; at !== (to.at + 1) % n; at = (at + 1) % n) other.push(points[at]!);
    if (other.length < path.length) path = other;
  }
  const length = [from.point, ...path, to.point].reduce((sum, point, at, list) => at === 0 ? 0 : sum + Math.hypot(point.x - list[at - 1]!.x, point.y - list[at - 1]!.y), 0);
  return length <= 1.5 * Math.hypot(to.point.x - from.point.x, to.point.y - from.point.y) + 2 * snap ? path : [];
}

/** Ringen fäst på linjerna (se ovan). En ring utan någon punkt nära en linje lämnas som den är. */
export function snapRing(ring: readonly FacePoint[], index: LineIndex, snap: number): FacePoint[] {
  const snapped = ring.map(point => snapPoint(point, index, snap));
  const first = snapped.findIndex(entry => entry !== undefined);
  if (first < 0) return [...ring];
  const kept: Snapped[] = [];
  for (let step = 0; step < ring.length; step += 1) {
    const entry = snapped[(first + step) % ring.length];
    if (entry) kept.push(entry);
  }
  const out: FacePoint[] = [];
  kept.forEach((entry, at) => {
    out.push(entry.point);
    out.push(...between(entry, kept[(at + 1) % kept.length]!, index, snap));
  });
  // Dubbletter och punkter mitt på raka sträckor bort.
  const clean: FacePoint[] = [];
  for (const point of out) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-9 && Math.abs(last.y - point.y) < 1e-9) continue;
    clean.push(point);
  }
  while (clean.length > 1 && Math.abs(clean[0]!.x - clean[clean.length - 1]!.x) < 1e-9 && Math.abs(clean[0]!.y - clean[clean.length - 1]!.y) < 1e-9) clean.pop();
  // Punkter som (nästan) ligger på den raka sträckan mellan grannarna, t.ex. flera fästa på samma linjebit.
  const flat = snap * 1e-3;
  for (let changed = true; changed && clean.length > 3;) {
    changed = false;
    for (let at = 0; at < clean.length && clean.length > 3; at += 1) {
      const a = clean[(at + clean.length - 1) % clean.length]!, b = clean[at]!, c = clean[(at + 1) % clean.length]!;
      const length = Math.hypot(c.x - a.x, c.y - a.y);
      const off = length === 0 ? Math.hypot(b.x - a.x, b.y - a.y) : Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / length;
      if (off < flat && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) { clean.splice(at, 1); at -= 1; changed = true; }
    }
  }
  return clean;
}
