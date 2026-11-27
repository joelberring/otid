import type { Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-16 (Väddö: «mycket som borde varit skog blev 403»): en DXF har inga hål, bara slutna linjer. Geo-arbetarens
 * ytor (vegetation, fukt) skriver ett hål som en egen sluten linje i samma lager, och importen gjorde varje linje till en egen
 * yta, så att skogen inne i en öppen yta blev öppen mark. Här läggs ringarna i varandra: en ring inuti ett udda antal andra
 * ringar i samma lager är ett hål i den minsta av dem, en ring inuti ett jämnt antal är en egen yta (en ö i hålet).
 */
export function nestRings(rings: readonly Point[][]): Point[][][] {
  if (rings.length === 0) return [];
  if (rings.length === 1) return [[rings[0]!]];
  const info = rings.map(ring => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, twice = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const point = ring[index]!, next = ring[(index + 1) % ring.length]!;
      twice += point.x * next.y - next.x * point.y;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    return { ring, minX, minY, maxX, maxY, area: Math.abs(twice) / 2 };
  });
  const order = info.map((_, index) => index).sort((a, b) => info[b]!.area - info[a]!.area);
  // Spatialt rutnätsindex över redan insatta (större) ringar: varje ring letar bara i cellen för sin provpunkt + overflow.
  const sizes: number[] = [];
  let ox = Infinity, oy = Infinity;
  for (const row of info) {
    const span = Math.max(row.maxX - row.minX, row.maxY - row.minY);
    if (span > 0 && Number.isFinite(span)) sizes.push(span);
    if (row.minX < ox) ox = row.minX;
    if (row.minY < oy) oy = row.minY;
  }
  sizes.sort((a, b) => a - b);
  const cell = sizes.length ? Math.max(1e-3, sizes[Math.floor(sizes.length / 2)]!) : 1;
  const originX = Number.isFinite(ox) ? ox : 0, originY = Number.isFinite(oy) ? oy : 0;
  const cells = new Map<number, number[]>(), overflow: number[] = [];
  const addToGrid = (at: number, row: (typeof info)[number]) => {
    const x0 = Math.floor((row.minX - originX) / cell), x1 = Math.floor((row.maxX - originX) / cell);
    const y0 = Math.floor((row.minY - originY) / cell), y1 = Math.floor((row.maxY - originY) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      overflow.push(at);
      return;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
      const list = cells.get(key);
      if (list) list.push(at); else cells.set(key, [at]);
    }
  };
  const parent = new Int32Array(rings.length).fill(-1), depth = new Int32Array(rings.length);
  const candidates: number[] = [];
  for (let at = 0; at < order.length; at += 1) {
    const index = order[at]!, self = info[index]!, probe = self.ring[0];
    if (probe) {
      candidates.length = 0;
      const cx = Math.floor((probe.x - originX) / cell), cy = Math.floor((probe.y - originY) / cell);
      const consider = (list: readonly number[] | undefined) => {
        if (!list) return;
        for (let i = 0; i < list.length; i += 1) {
          const k = list[i]!, other = info[order[k]!]!;
          if (other.area <= self.area || other.minX > self.minX || other.minY > self.minY || other.maxX < self.maxX || other.maxY < self.maxY) continue;
          candidates.push(k);
        }
      };
      if (Math.abs(cx) <= 1e7 && Math.abs(cy) <= 1e7) consider(cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000)));
      consider(overflow);
      // Största ordningspositionen först (= minsta omslutande area): första som innehåller provpunkten är föräldern.
      if (candidates.length > 1) candidates.sort((a, b) => b - a);
      for (let i = 0; i < candidates.length; i += 1) {
        const parentIndex = order[candidates[i]!]!;
        if (!inside(probe, info[parentIndex]!.ring)) continue;
        parent[index] = parentIndex;
        depth[index] = depth[parentIndex]! + 1;
        break;
      }
      addToGrid(at, self);
    }
  }
  const out = new Map<number, Point[][]>();
  for (const index of order) {
    if (depth[index]! % 2 === 0) out.set(index, [rings[index]!]);
    else out.get(parent[index]!)?.push(rings[index]!);
  }
  return [...out.values()];
}

function inside(point: Point, ring: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
