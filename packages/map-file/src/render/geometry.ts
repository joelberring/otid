import type { Path, Point } from "../model";

/**
 * Steg 59: geometri för skärmritningen. Vägar i kartans mm (y uppåt) plattas till polylinjer när de behöver förskjutas
 * (dubbellinjer) eller när punktsymboler ska upprepas längs dem. Raka vägar och kurvor ritas annars direkt.
 */
export type Polyline = Point[];

/** Avstånd mellan punkterna när en kurva plattas till (mm). Fint nog för skärmen i 8–12 px/mm. */
const FLATTEN_STEP_MM = 0.25;
const MAX_CURVE_STEPS = 48;

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Vägen som polylinjer, en per delväg (varje M börjar en ny). */
export function flattenPath(path: Path): Polyline[] {
  const lines: Polyline[] = [];
  let current: Polyline | undefined;
  for (const command of path) {
    if (command.type === "M") {
      current = [{ x: command.x, y: command.y }];
      lines.push(current);
      continue;
    }
    if (!current) { current = [{ x: command.x, y: command.y }]; lines.push(current); continue; }
    if (command.type === "L") { current.push({ x: command.x, y: command.y }); continue; }
    const from = current[current.length - 1]!;
    const chord = Math.hypot(command.x1 - from.x, command.y1 - from.y) + Math.hypot(command.x2 - command.x1, command.y2 - command.y1) +
      Math.hypot(command.x - command.x2, command.y - command.y2);
    const steps = Math.max(2, Math.min(MAX_CURVE_STEPS, Math.ceil(chord / FLATTEN_STEP_MM)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      current.push({ x: cubic(from.x, command.x1, command.x2, command.x, t), y: cubic(from.y, command.y1, command.y2, command.y, t) });
    }
  }
  return lines.filter(line => line.length > 0);
}

/** Polylinjen utan punkter som ligger på varandra (de ger ingen riktning). */
function distinct(line: Polyline): Polyline {
  const out: Polyline = [];
  for (const point of line) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1e-6) out.push(point);
  }
  return out;
}

/**
 * Polylinjen förskjuten `offset` mm åt vänster (+) eller höger (−) i färdriktningen. Hörnen får en enkel geringsfog
 * (högst dubbla förskjutningen), vilket räcker för dubbellinjer på skärmen.
 */
export function offsetPolyline(input: Polyline, offset: number): Polyline {
  const line = distinct(input);
  if (line.length < 2 || offset === 0) return line;
  const closed = line.length > 2 && Math.hypot(line[0]!.x - line[line.length - 1]!.x, line[0]!.y - line[line.length - 1]!.y) < 1e-6;
  const normals = line.slice(1).map((point, index) => {
    const from = line[index]!;
    const length = Math.hypot(point.x - from.x, point.y - from.y);
    return { x: -(point.y - from.y) / length, y: (point.x - from.x) / length };
  });
  return line.map((point, index) => {
    const before = index > 0 ? normals[index - 1] : closed ? normals[normals.length - 1] : undefined;
    const after = index < normals.length ? normals[index] : closed ? normals[0] : undefined;
    const a = before ?? after!, b = after ?? before!;
    const sum = { x: a.x + b.x, y: a.y + b.y };
    const length = Math.hypot(sum.x, sum.y);
    if (length < 1e-9) return { x: point.x + a.x * offset, y: point.y + a.y * offset };
    const cos = Math.max(0.5, (sum.x * a.x + sum.y * a.y) / length);
    const scale = offset / cos / length;
    return { x: point.x + sum.x * scale, y: point.y + sum.y * scale };
  });
}

/** Platser och riktning (radianer, moturs) längs polylinjen med jämnt avstånd, med början ett halvt avstånd in. */
export function placementsAlong(line: Polyline, spacing: number): { at: Point; angle: number }[] {
  const points = distinct(line);
  if (points.length < 2) return [];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const step = spacing > 0 ? spacing : total;
  const out: { at: Point; angle: number }[] = [];
  let segment = 0, start = 0;
  for (let distance = Math.min(step / 2, total / 2); distance <= total + 1e-9 && out.length < 100_000; distance += step) {
    while (segment < lengths.length - 1 && start + lengths[segment]! < distance) { start += lengths[segment]!; segment += 1; }
    const from = points[segment]!, to = points[segment + 1]!;
    const t = lengths[segment]! > 0 ? Math.min(1, (distance - start) / lengths[segment]!) : 0;
    out.push({ at: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, angle: Math.atan2(to.y - from.y, to.x - from.x) });
  }
  return out;
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** Ytan som vägarna täcker (kontrollpunkterna för kurvor ingår, det räcker för mönster och klippning). */
export function pathsBox(paths: readonly Path[]): Box | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const path of paths) for (const command of path) {
    add(command.x, command.y);
    if (command.type === "C") { add(command.x1, command.y1); add(command.x2, command.y2); }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}
