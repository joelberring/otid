import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-15 (skisslagren, «kopiera över egenskaperna … till O-Tid»): när ett underlag förs över till en symbol i
 * normen ska det som redan finns ritat inte dubbleras. Ett objekt räknas som täckt när minst `share` av punkterna längs det
 * ligger inom `toleranceMm` från något av målobjekten (linjer och ytkanter, punkter som punkter).
 */
export const COVERED_SHARE = 0.8;

/** Punkter längs objektet med högst `step` mm emellan (ytor: kanterna). */
export function samplePoints(object: MapObject, step: number): Point[] {
  if (object.kind === "point" || object.kind === "text") return [object.at];
  const out: Point[] = [];
  for (const path of object.kind === "line" ? [object.path] : object.rings) for (const flat of flattenPath(path)) {
    const line: Point[] = [...flat];
    if (object.kind === "area" && line.length > 2) line.push(line[0]!);
    for (let index = 0; index < line.length; index += 1) {
      const a = line[index]!;
      out.push(a);
      const b = line[index + 1];
      if (!b) continue;
      const parts = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let part = 1; part < parts; part += 1) out.push({ x: a.x + (b.x - a.x) * part / parts, y: a.y + (b.y - a.y) * part / parts });
    }
  }
  return out;
}

/** Index (i `sources`) för objekten som redan täcks av `targets`. */
export function coveredObjects(sources: readonly MapObject[], targets: readonly MapObject[], toleranceMm: number, share = COVERED_SHARE): Set<number> {
  const cell = Math.max(toleranceMm, 1e-3), step = cell / 2;
  const grid = new Map<string, Point[]>();
  const keyOf = (x: number, y: number) => `${x},${y}`;
  for (const target of targets) {
    for (const point of samplePoints(target, step)) {
      const key = keyOf(Math.floor(point.x / cell), Math.floor(point.y / cell));
      const list = grid.get(key);
      if (list) list.push(point); else grid.set(key, [point]);
    }
  }
  const near = (point: Point) => {
    const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const other of grid.get(keyOf(cx + dx, cy + dy)) ?? []) if (Math.hypot(point.x - other.x, point.y - other.y) <= toleranceMm) return true;
    }
    return false;
  };
  const out = new Set<number>();
  if (grid.size === 0) return out;
  sources.forEach((source, index) => {
    const points = samplePoints(source, step);
    if (points.length === 0) return;
    let hits = 0;
    for (const point of points) if (near(point)) hits += 1;
    if (hits >= share * points.length) out.add(index);
  });
  return out;
}
