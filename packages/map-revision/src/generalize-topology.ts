import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import type { NormObject } from "./norm-check";
import type { ObjectKey } from "./state";

/**
 * ADR-0219 K6 (del 2): generaliseringens topologi, som förslag.
 *
 * - **Foga ihop linjer:** linjer med samma symbol vars ändar möts (inom `JOIN_MM` på kartan) blir en linje, och en linje vars
 *   ändar möts blir sluten. Karttapullautin och andra källor delar kurvor vid rutornas kanter; i kartan ska de vara hela.
 * - **Ytor inuti en likadan yta:** en yta med samma symbol som helt ligger inne i en annan (dubbletter och rester efter en
 *   import) tas bort; den syns inte och gör bara kartan tyngre.
 *
 * Rena funktioner; varje objekt får högst en ändring.
 */
export const JOIN_MM = 0.05;
/** Högst så många linjer går upp i en (ett förslag har högst 200 ändringar). */
export const JOIN_MAX_PARTS = 100;

type Line = Extract<MapObject, { kind: "line" }>;
const start = (path: Path): Point => ({ x: path[0]!.x, y: path[0]!.y });
const end = (path: Path): Point => ({ x: path[path.length - 1]!.x, y: path[path.length - 1]!.y });
const near = (a: Point, b: Point, tolerance: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const singlePart = (line: Line) => line.path.length >= 2 && line.path.slice(1).every(command => command.type !== "M");

/** Vägen baklänges (kurvornas styrpunkter byter plats); flaggorna följer sina punkter. */
export function reversePath(path: Path): PathCommand[] {
  const out: PathCommand[] = [];
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const here = path[i]!, after = path[i + 1];
    const flags = { ...(here.corner ? { corner: true as const } : {}), ...(here.dash ? { dash: true as const } : {}) };
    if (i === path.length - 1) { out.push({ type: "M", x: here.x, y: here.y, ...flags }); continue; }
    out.push(after?.type === "C" ? { type: "C", x1: after.x2, y1: after.y2, x2: after.x1, y2: after.y1, x: here.x, y: here.y, ...flags }
      : { type: "L", x: here.x, y: here.y, ...flags });
  }
  return out;
}

/** `b` efter `a` (b:s första punkt ersätts av a:s sista). */
function append(a: Path, b: Path): PathCommand[] {
  return [...a, ...b.slice(1)];
}

export interface JoinChange { readonly keep: ObjectKey; readonly object: MapObject; readonly absorbed: readonly ObjectKey[]; readonly code: string; readonly at: Point }

/**
 * Linjerna med samma symbol vars ändar möts, ihopfogade (girigt: från en linje åt båda hållen så länge en ände möter en
 * annan linjes ände). Den första linjen behålls med den nya vägen, de andra tas bort.
 */
export function joinTouchingLines(objects: readonly NormObject[], tolerance = JOIN_MM, taken: ReadonlySet<ObjectKey> = new Set()): JoinChange[] {
  const lines = objects.filter((row): row is NormObject & { object: Line } => row.object.kind === "line" && singlePart(row.object as Line) && !taken.has(row.key));
  const bySymbol = new Map<string, (NormObject & { object: Line })[]>();
  for (const row of lines) bySymbol.set(row.object.symbol, [...(bySymbol.get(row.object.symbol) ?? []), row]);
  const changes: JoinChange[] = [];
  for (const group of bySymbol.values()) {
    if (group.length < 2) continue;
    const used = new Set<ObjectKey>();
    // Ändarna i ett rutnät (cellen = toleransen), så att grannarna hittas utan att jämföra alla par.
    const cell = Math.max(tolerance, 1e-6), grid = new Map<string, { row: typeof group[number]; which: "start" | "end" }[]>();
    const cellOf = (point: Point) => `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    for (const row of group) {
      for (const which of ["start", "end"] as const) {
        const point = which === "start" ? start(row.object.path) : end(row.object.path);
        grid.set(cellOf(point), [...(grid.get(cellOf(point)) ?? []), { row, which }]);
      }
    }
    const partner = (point: Point, self: ObjectKey) => {
      const cx = Math.floor(point.x / cell), cy = Math.floor(point.y / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const entry of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (entry.row.key === self || used.has(entry.row.key)) continue;
            const other = entry.which === "start" ? start(entry.row.object.path) : end(entry.row.object.path);
            if (near(point, other, tolerance)) return entry;
          }
        }
      }
      return undefined;
    };
    for (const row of group) {
      if (used.has(row.key)) continue;
      used.add(row.key);
      let path: PathCommand[] = [...row.object.path];
      const absorbed: ObjectKey[] = [];
      while (absorbed.length < JOIN_MAX_PARTS) {
        const atEnd = partner(end(path), row.key);
        if (atEnd) { used.add(atEnd.row.key); absorbed.push(atEnd.row.key); path = append(path, atEnd.which === "start" ? atEnd.row.object.path : reversePath(atEnd.row.object.path)); continue; }
        const atStart = partner(start(path), row.key);
        if (atStart) { used.add(atStart.row.key); absorbed.push(atStart.row.key); path = append(atStart.which === "end" ? [...atStart.row.object.path] : reversePath(atStart.row.object.path), path); continue; }
        break;
      }
      if (absorbed.length === 0) continue;
      // Ändarna möts: linjen sluts exakt.
      if (near(start(path), end(path), tolerance)) {
        const last = path[path.length - 1]!;
        path[path.length - 1] = { ...last, x: path[0]!.x, y: path[0]!.y };
      }
      changes.push({ keep: row.key, object: { ...row.object, path }, absorbed, code: row.code, at: start(path) });
    }
  }
  return changes;
}

/** Ringens punkter (kurvorna utplattade grovt: ändpunkterna räcker för att avgöra inne/ute för hela ytor). */
const ringPoints = (ring: Path): Point[] => ring.map(command => ({ x: command.x, y: command.y }));
function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const ringArea = (ring: readonly Point[]) => Math.abs(ring.reduce((sum, point, i) => {
  const next = ring[(i + 1) % ring.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);

export interface InsideChange { readonly key: ObjectKey; readonly code: string; readonly at: Point; readonly container: ObjectKey }

/**
 * Ytor med samma symbol som helt ligger inne i en större yta med samma symbol (alla punkter inne i ytterkanten och i inget
 * av dess hål). Bara ytor utan egna hål prövas; den större ytan måste vara minst dubbelt så stor.
 */
export function areasInsideSameSymbol(objects: readonly NormObject[], taken: ReadonlySet<ObjectKey> = new Set()): InsideChange[] {
  const areas = objects.filter(row => row.object.kind === "area" && !taken.has(row.key)).map(row => {
    const area = row.object as Extract<MapObject, { kind: "area" }>;
    const outer = ringPoints(area.rings[0] ?? []);
    const xs = outer.map(point => point.x), ys = outer.map(point => point.y);
    return { row, outer, holes: area.rings.slice(1).map(ringPoints), size: ringArea(outer),
      box: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
  }).filter(entry => entry.outer.length >= 3);
  const out: InsideChange[] = [];
  const removed = new Set<ObjectKey>();
  const bySize = [...areas].sort((a, b) => b.size - a.size);
  for (const small of [...areas].sort((a, b) => a.size - b.size)) {
    if (small.holes.length > 0) continue;
    const container = bySize.find(big => big.row.key !== small.row.key && !removed.has(big.row.key) && big.row.object.symbol === small.row.object.symbol
      && big.size >= small.size * 2 && big.box.minX <= small.box.minX && big.box.minY <= small.box.minY && big.box.maxX >= small.box.maxX
      && big.box.maxY >= small.box.maxY && small.outer.every(point => pointInRing(point, big.outer) && !big.holes.some(hole => pointInRing(point, hole))));
    if (!container) continue;
    removed.add(small.row.key);
    out.push({ key: small.row.key, code: small.row.code, at: small.outer[0]!, container: container.row.key });
  }
  return out;
}
