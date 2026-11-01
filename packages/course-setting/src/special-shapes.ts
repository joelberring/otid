/** Steg 64: geometri för specialobjekten i kartans mm (y uppåt): raster i ytor, parallella linjer, rundade rektanglar, ellipser. */
import type { Point } from "@o-tid/map-file";
import { bezier } from "./geometry";
import type { MapRect } from "./types";

/** Rektangeln som två hörn spänner upp. */
export function rectOf(a: Point, b: Point): MapRect {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/**
 * Rasterlinjer i ytan: parallella linjer med vinkeln `degrees` (moturs från x-axeln) och avståndet `spacing` mellan
 * linjernas mitt, klippta mot ytan (jämn–udda). Linjerna går genom kartans origo, så att intilliggande ytor får samma raster.
 */
export function hatchLines(ring: readonly Point[], degrees: number, spacing: number): Point[][] {
  if (ring.length < 3 || !(spacing > 0)) return [];
  const a = degrees * Math.PI / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const normal = { x: -dir.y, y: dir.x };
  const along = (p: Point) => p.x * dir.x + p.y * dir.y;
  const across = (p: Point) => p.x * normal.x + p.y * normal.y;
  const offsets = ring.map(across);
  const min = Math.min(...offsets), max = Math.max(...offsets);
  const out: Point[][] = [];
  for (let k = Math.ceil(min / spacing); k * spacing <= max; k++) {
    const c = k * spacing;
    const hits: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
      const op = offsets[i]!, oq = offsets[(i + 1) % ring.length]!;
      if ((op <= c && oq > c) || (oq <= c && op > c)) {
        const t = (c - op) / (oq - op);
        hits.push(along(p) + t * (along(q) - along(p)));
      }
    }
    hits.sort((x, y) => x - y);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const point = (s: number) => ({ x: dir.x * s + normal.x * c, y: dir.y * s + normal.y * c });
      if (hits[i + 1]! - hits[i]! > 1e-6) out.push([point(hits[i]!), point(hits[i + 1]!)]);
    }
  }
  return out;
}

/** Linjen förskjuten `distance` mm åt vänster (negativt = höger), med geringade hörn (högst 4 × avståndet). */
export function offsetLine(points: readonly Point[], distance: number, closed = false): Point[] {
  const n = points.length;
  if (n < 2) return [...points];
  const normalOf = (p: Point, q: Point) => {
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
  };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? points[(i - 1 + n) % n]! : points[Math.max(0, i - 1)]!;
    const next = closed ? points[(i + 1) % n]! : points[Math.min(n - 1, i + 1)]!;
    const p = points[i]!;
    const n1 = i === 0 && !closed ? normalOf(p, next) : normalOf(prev, p);
    const n2 = i === n - 1 && !closed ? normalOf(prev, p) : normalOf(p, next);
    const sum = { x: n1.x + n2.x, y: n1.y + n2.y };
    const length = Math.hypot(sum.x, sum.y);
    if (length < 1e-9) { out.push({ x: p.x + n1.x * distance, y: p.y + n1.y * distance }); continue; }
    const miter = { x: sum.x / length, y: sum.y / length };
    const scale = Math.min(4, 1 / Math.max(1e-9, miter.x * n1.x + miter.y * n1.y));
    out.push({ x: p.x + miter.x * distance * scale, y: p.y + miter.y * distance * scale });
  }
  return out;
}

const KAPPA = 0.5522847498;

/** Ellipsen i rektangeln som sluten linje (fyra Bézierkurvor, som Purple Pens SymPath.CreateEllipsePath). */
export function ellipsePoints(rect: MapRect, steps = 12): Point[] {
  const cx = (rect.minX + rect.maxX) / 2, cy = (rect.minY + rect.maxY) / 2;
  const rx = (rect.maxX - rect.minX) / 2, ry = (rect.maxY - rect.minY) / 2;
  const quarter = (from: Point, c1: Point, c2: Point, to: Point) => bezier(from, c1, c2, to, steps).slice(1);
  const right = { x: cx + rx, y: cy }, top = { x: cx, y: cy + ry }, left = { x: cx - rx, y: cy }, bottom = { x: cx, y: cy - ry };
  return [
    right,
    ...quarter(right, { x: cx + rx, y: cy + KAPPA * ry }, { x: cx + KAPPA * rx, y: cy + ry }, top),
    ...quarter(top, { x: cx - KAPPA * rx, y: cy + ry }, { x: cx - rx, y: cy + KAPPA * ry }, left),
    ...quarter(left, { x: cx - rx, y: cy - KAPPA * ry }, { x: cx - KAPPA * rx, y: cy - ry }, bottom),
    ...quarter(bottom, { x: cx + KAPPA * rx, y: cy - ry }, { x: cx + rx, y: cy - KAPPA * ry }, right).slice(0, -1)
  ];
}

/** Rektangeln med rundade hörn (radien högst halva sidan) som sluten linje. */
export function roundedRectPoints(rect: MapRect, radius: number, steps = 6): Point[] {
  const r = Math.max(0, Math.min(radius, (rect.maxX - rect.minX) / 2, (rect.maxY - rect.minY) / 2));
  if (r === 0) return [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }];
  const corner = (cx: number, cy: number, start: number) => Array.from({ length: steps + 1 }, (_, i) => {
    const a = (start + 90 * i / steps) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return [
    ...corner(rect.maxX - r, rect.minY + r, -90), ...corner(rect.maxX - r, rect.maxY - r, 0),
    ...corner(rect.minX + r, rect.maxY - r, 90), ...corner(rect.minX + r, rect.minY + r, 180)
  ];
}

/** En Bézierbana som i Purple Pens SymPath: punkt, styrpunkt, styrpunkt, punkt …; `kinds` "N" vanlig punkt, "B" styrpunkt. */
export function symPath(points: readonly Point[], kinds: string): Point[] {
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length;) {
    if (kinds[i] === "B") {
      out.push(...bezier(points[i - 1]!, points[i]!, points[i + 1]!, points[i + 2]!, 10).slice(1));
      i += 3;
    } else {
      out.push(points[i]!);
      i += 1;
    }
  }
  return out;
}
