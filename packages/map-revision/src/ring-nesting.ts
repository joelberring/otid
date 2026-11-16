import type { Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-16 (Väddö: «mycket som borde varit skog blev 403»): en DXF har inga hål, bara slutna linjer. Geo-arbetarens
 * ytor (vegetation, fukt) skriver ett hål som en egen sluten linje i samma lager, och importen gjorde varje linje till en egen
 * yta, så att skogen inne i en öppen yta blev öppen mark. Här läggs ringarna i varandra: en ring inuti ett udda antal andra
 * ringar i samma lager är ett hål i den minsta av dem, en ring inuti ett jämnt antal är en egen yta (en ö i hålet).
 */
export function nestRings(rings: readonly Point[][]): Point[][][] {
  const info = rings.map(ring => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, twice = 0;
    ring.forEach((point, index) => {
      const next = ring[(index + 1) % ring.length]!;
      twice += point.x * next.y - next.x * point.y;
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    });
    return { ring, minX, minY, maxX, maxY, area: Math.abs(twice) / 2 };
  });
  const order = info.map((_, index) => index).sort((a, b) => info[b]!.area - info[a]!.area);
  const parent = new Int32Array(rings.length).fill(-1), depth = new Int32Array(rings.length);
  order.forEach((index, at) => {
    const self = info[index]!, probe = self.ring[0];
    if (!probe) return;
    // De större ringarna, från den minsta och uppåt: den första som innehåller ringen är föräldern.
    for (let k = at - 1; k >= 0; k -= 1) {
      const other = info[order[k]!]!;
      if (other.area <= self.area || other.minX > self.minX || other.minY > self.minY || other.maxX < self.maxX || other.maxY < self.maxY) continue;
      if (!inside(probe, other.ring)) continue;
      parent[index] = order[k]!; depth[index] = depth[order[k]!]! + 1;
      break;
    }
  });
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
