import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import { vertices, type Vertex } from "@o-tid/map-revision";

/**
 * ADR-0219 (K1): ritverktygens geometri utan React och utan webbläsare. Koordinater i kartans mm med y uppåt.
 *
 * Rita som i Mapper: ett klick ger en hörnpunkt (rak sträcka), att trycka och dra ger en mjuk punkt där dragningen är kurvans
 * riktning. Sträckan mellan två punkter blir en kubisk bézierkurva när någon av dem är mjuk (styrpunkterna en tredjedel av
 * dragningen ut från punkterna), annars rak.
 */
export interface DraftPoint {
  readonly at: Point;
  /** Mjuk punkt: kurvans riktning ut från punkten (mm). Saknas = hörnpunkt. */
  readonly handle?: Point | undefined;
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, factor: number): Point => ({ x: a.x * factor, y: a.y * factor });

/** Vägen genom punkterna; `closed` lägger till sträckan tillbaka till första punkten (ytor). */
export function draftPath(points: readonly DraftPoint[], closed: boolean): Path {
  const first = points[0];
  if (!first) return [];
  const path: PathCommand[] = [{ type: "M", x: first.at.x, y: first.at.y }];
  const segment = (from: DraftPoint, to: DraftPoint): PathCommand => {
    if (!from.handle && !to.handle) return { type: "L", x: to.at.x, y: to.at.y };
    const c1 = add(from.at, scale(from.handle ?? { x: 0, y: 0 }, 1 / 3));
    const c2 = sub(to.at, scale(to.handle ?? { x: 0, y: 0 }, 1 / 3));
    return { type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: to.at.x, y: to.at.y };
  };
  for (let index = 1; index < points.length; index += 1) path.push(segment(points[index - 1]!, points[index]!));
  if (closed && points.length >= 3) {
    const last = points[points.length - 1]!;
    if (first.handle || last.handle) path.push(segment(last, first));
  }
  return path;
}

/** Ett nytt objekt ur utkastet, eller undefined när det har för få punkter (två för en linje, tre för en yta). */
export function draftObject(kind: "point" | "line" | "area", symbol: string, points: readonly DraftPoint[], angle = 0): MapObject | undefined {
  const first = points[0];
  if (!first) return undefined;
  if (kind === "point") return { kind: "point", symbol, at: first.at, angle };
  if (points.length < (kind === "area" ? 3 : 2)) return undefined;
  const path = draftPath(points, kind === "area");
  return kind === "line" ? { kind: "line", symbol, path } : { kind: "area", symbol, rings: [path], angle: 0 };
}

const shiftCommand = (command: PathCommand, d: Point): PathCommand => command.type === "C"
  ? { ...command, x1: command.x1 + d.x, y1: command.y1 + d.y, x2: command.x2 + d.x, y2: command.y2 + d.y, x: command.x + d.x, y: command.y + d.y }
  : { ...command, x: command.x + d.x, y: command.y + d.y };

/** Hela objektet flyttat `d` mm (alla punkter och styrpunkter). */
export function translateObject(object: MapObject, d: Point): MapObject {
  if (object.kind === "point" || object.kind === "text") return { ...object, at: add(object.at, d) };
  if (object.kind === "line") return { ...object, path: object.path.map(command => shiftCommand(command, d)) };
  return { ...object, rings: object.rings.map(ring => ring.map(command => shiftCommand(command, d))) };
}

/** Punktobjektet vridet till `angle` grader moturs. */
export const rotatePoint = (object: MapObject, angle: number): MapObject =>
  object.kind === "point" || object.kind === "text" ? { ...object, angle: ((angle % 360) + 360) % 360 } : object;

/** Närmaste brytpunkt inom `tolerance` mm, eller undefined. */
export function nearestVertex(object: MapObject, point: Point, tolerance: number): Vertex | undefined {
  let best: Vertex | undefined, distance = tolerance;
  for (const vertex of vertices(object)) {
    const next = Math.hypot(vertex.at.x - point.x, vertex.at.y - point.y);
    if (next <= distance) { best = vertex; distance = next; }
  }
  return best;
}
