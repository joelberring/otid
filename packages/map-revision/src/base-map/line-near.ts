import type { SourceFeature } from "../index";

type Position = readonly [number, number];

/**
 * Om en punkt ligger inom `reach` meter från någon av linjerna. Linjerna delas i punkter med högst `reach / 2` mellan
 * (så att avståndet blir rätt inom en fjärdedel av `reach`) i ett rutnät med sidan `reach`.
 */
export function nearLines(lines: readonly (readonly Position[])[], reach: number): (x: number, y: number) => boolean {
  const cells = new Map<string, number[]>(), key = (cx: number, cy: number) => `${cx},${cy}`;
  const add = (x: number, y: number) => {
    const k = key(Math.floor(x / reach), Math.floor(y / reach)), row = cells.get(k);
    if (row) row.push(x, y); else cells.set(k, [x, y]);
  };
  for (const points of lines) for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    add(x1, y1);
    const next = points[i + 1];
    if (!next) continue;
    const steps = Math.ceil(Math.hypot(next[0] - x1, next[1] - y1) / (reach / 2));
    for (let s = 1; s < steps; s += 1) add(x1 + (next[0] - x1) * s / steps, y1 + (next[1] - y1) * s / steps);
  }
  return (x, y) => {
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach);
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      const row = cells.get(key(cx + ax, cy + ay));
      if (!row) continue;
      for (let i = 0; i < row.length; i += 2) if (Math.hypot(row[i]! - x, row[i + 1]! - y) <= reach) return true;
    }
    return false;
  };
}

/** Andelen av ringens punkter (tätt utlagda, högst `step` meter mellan) som `near` säger ligger nära. */
export function shareNear(ring: readonly Position[], near: (x: number, y: number) => boolean, step: number): number {
  let total = 0, close = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[(i + 1) % ring.length]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let s = 0; s < steps; s += 1) { total += 1; if (near(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps)) close += 1; }
  }
  return total === 0 ? 0 : close / total;
}

/** Linjerna (öppna och slutna) i lager som `layer` godtar. */
export const linesOf = (features: readonly SourceFeature[], layer: RegExp): Position[][] => features.flatMap(feature =>
  feature.geometry.kind === "line" && layer.test(feature.layer) ? [feature.geometry.points as Position[]] : []);
