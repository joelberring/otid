import type { SourceFeature } from "./vector-parse";

/**
 * Grundkartan G3: Karttapullautin räknar varje laserruta för sig, så höjdkurvorna och formlinjerna bryts vid rutornas skarvar.
 * Linjer i samma lager och på samma höjd vars ändar möts (inom `tolerance`, i källans enheter) fogas ihop till en, och en kedja
 * vars ändar möts blir sluten. Linjer utan höjd fogas bara med andra utan höjd i samma lager.
 */
type Position = readonly [number, number];
type Open = { points: Position[]; used: boolean };

export function joinSeams(features: readonly SourceFeature[], tolerance = 0.5, layers: RegExp = /contour|formline|kurv|formlin/i): SourceFeature[] {
  const keep: SourceFeature[] = [];
  const groups = new Map<string, { layer: string; elevation: number | undefined; lines: Open[] }>();
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.geometry.closed || !layers.test(feature.layer)) { keep.push(feature); continue; }
    const key = `${feature.layer}\u0000${feature.elevation ?? ""}`;
    const group = groups.get(key) ?? { layer: feature.layer, elevation: feature.elevation, lines: [] };
    group.lines.push({ points: [...feature.geometry.points], used: false });
    groups.set(key, group);
  }
  const close = (a: Position, b: Position) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  const cellOf = (point: Position) => `${Math.floor(point[0] / tolerance)},${Math.floor(point[1] / tolerance)}`;
  for (const group of groups.values()) {
    // Ändpunkterna i ett rutnät med rutans sida `tolerance`, så att en granne letas i de nio närmaste rutorna.
    const ends = new Map<string, { line: Open; start: boolean }[]>();
    for (const line of group.lines) for (const start of [true, false]) {
      const cell = cellOf(start ? line.points[0]! : line.points.at(-1)!);
      ends.set(cell, [...ends.get(cell) ?? [], { line, start }]);
    }
    const neighbour = (point: Position, self: Open) => {
      const [cx, cy] = [Math.floor(point[0] / tolerance), Math.floor(point[1] / tolerance)];
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const end of ends.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (end.line !== self && !end.line.used && close(end.start ? end.line.points[0]! : end.line.points.at(-1)!, point)) return end;
        }
      }
      return undefined;
    };
    for (const line of group.lines) {
      if (line.used) continue;
      line.used = true;
      let chain = [...line.points];
      // Framåt från slutet, sedan bakåt från början.
      for (const forward of [true, false]) {
        for (;;) {
          const tip = forward ? chain.at(-1)! : chain[0]!;
          const next = neighbour(tip, line);
          if (!next) break;
          next.line.used = true;
          const points = next.start === forward ? next.line.points : [...next.line.points].reverse();
          chain = forward ? [...chain, ...points.slice(1)] : [...points.slice(0, -1), ...chain];
        }
      }
      const closed = chain.length >= 4 && close(chain[0]!, chain.at(-1)!);
      keep.push({ layer: group.layer, ...(group.elevation !== undefined ? { elevation: group.elevation } : {}),
        geometry: { kind: "line", points: closed ? chain.slice(0, -1) : chain, closed } });
    }
  }
  return keep;
}
