import { flattenPath, type MapObject, type MapSymbol, type Point } from "@o-tid/map-file";
import type { ObjectKey } from "./state";

/**
 * ADR-0219 beslut 5: vilket objekt man trycker på. Alla objekt inom träffytan (fingret större än musen) listas, punkter och
 * texter först, sedan linjer, sedan ytor man står i, och närmast först inom varje grupp, så att den som står i tät terräng
 * kan välja i en lista. Dolda symboler (som inte ritas) räknas inte.
 */
export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export function objectBox(object: MapObject): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
  };
  if (object.kind === "point" || object.kind === "text") add(object.at.x, object.at.y);
  else for (const path of object.kind === "line" ? [object.path] : object.rings) {
    for (const command of path) {
      if (command.type === "C") { add(command.x1, command.y1); add(command.x2, command.y2); }
      add(command.x, command.y);
    }
  }
  return box;
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function polylineDistance(point: Point, lines: readonly (readonly Point[])[], closed: boolean): number {
  let best = Infinity;
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) best = Math.min(best, segmentDistance(point, line[index - 1]!, line[index]!));
    if (closed && line.length > 2) best = Math.min(best, segmentDistance(point, line[line.length - 1]!, line[0]!));
    if (line.length === 1) best = Math.min(best, Math.hypot(point.x - line[0]!.x, point.y - line[0]!.y));
  }
  return best;
}

/** Jämn–udda-regeln över alla ringar (ett hål räknas inte). */
function inside(point: Point, rings: readonly (readonly Point[])[]): boolean {
  let crossings = 0;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[index]!, b = ring[previous]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}

export interface HitCandidate {
  readonly key: ObjectKey;
  readonly kind: MapObject["kind"];
  readonly symbol: string;
  /** Avståndet i mm (0 inne i en yta). */
  readonly distance: number;
  /** 0 punkt och text, 1 linje, 2 yta. */
  readonly tier: number;
}

/** Objektets avstånd till punkten om det är inom `tolerance` (mm), annars undefined. */
export function hitDistance(object: MapObject, point: Point, tolerance: number): { distance: number; tier: number } | undefined {
  if (object.kind === "point" || object.kind === "text") {
    const distance = Math.hypot(point.x - object.at.x, point.y - object.at.y);
    return distance <= tolerance * (object.kind === "text" ? 2 : 1.5) ? { distance, tier: 0 } : undefined;
  }
  if (object.kind === "line") {
    const distance = polylineDistance(point, flattenPath(object.path), false);
    return distance <= tolerance ? { distance, tier: 1 } : undefined;
  }
  const rings = object.rings.flatMap(ring => flattenPath(ring));
  if (inside(point, rings)) return { distance: 0, tier: 2 };
  const distance = polylineDistance(point, rings, true);
  return distance <= tolerance ? { distance, tier: 2 } : undefined;
}

/**
 * Objekten under punkten, högst `limit`. `boxes` är objektens rutor (räknade en gång, `objectBox`) och `symbols` avgör vad
 * som är dolt.
 */
export function hitTest(input: { objects: readonly MapObject[]; keys: readonly ObjectKey[]; boxes?: readonly Box[] | undefined;
  symbols: ReadonlyMap<string, MapSymbol> }, point: Point, tolerance: number, limit = 8): HitCandidate[] {
  const found: HitCandidate[] = [];
  input.objects.forEach((object, index) => {
    const box = input.boxes?.[index] ?? objectBox(object);
    const pad = object.kind === "text" ? tolerance * 2 : tolerance * 1.5;
    if (point.x < box.minX - pad || point.x > box.maxX + pad || point.y < box.minY - pad || point.y > box.maxY + pad) return;
    const symbol = input.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) return;
    const hit = hitDistance(object, point, tolerance);
    if (hit) found.push({ key: input.keys[index]!, kind: object.kind, symbol: object.symbol, ...hit });
  });
  // Överst ritat först bland lika: senare objekt i listan ligger ovanpå.
  return found.map((hit, order) => ({ hit, order })).sort((a, b) => a.hit.tier - b.hit.tier || a.hit.distance - b.hit.distance || b.order - a.order)
    .slice(0, limit).map(row => row.hit);
}
