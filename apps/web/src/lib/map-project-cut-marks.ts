import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";

/**
 * Ägaren 2026-11-13: «när man klipper linjer så syns det inte på linjen att de blivit klippta». Rena funktionerna bakom
 * markörerna: en linjes ändpunkter (visas när linjen är markerad) och de nya ändarna vid ett klipp (visas tills man gör något
 * annat). En ändpunkt har riktningen in i linjen (`toward` är nästa punkt eller styrpunkt längs linjen), så att ritningen kan
 * lägga en ring på varje del för sig, med en lucka mitt emellan.
 */
export interface EndMark { readonly at: Point; readonly toward: Point }

const at = (command: PathCommand): Point => ({ x: command.x, y: command.y });
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/** Delvägarna: varje `M` börjar en ny. */
function subpaths(path: Path): PathCommand[][] {
  const parts: PathCommand[][] = [];
  for (const command of path) {
    if (command.type === "M" || parts.length === 0) parts.push([command]); else parts[parts.length - 1]!.push(command);
  }
  return parts;
}

/** Punkten strax efter början: kurvans första styrpunkt, annars nästa punkt (en kurva som börjar i samma punkt hoppas över). */
function afterStart(part: readonly PathCommand[]): Point {
  const start = at(part[0]!), next = part[1]!;
  const candidates = next.type === "C" ? [{ x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }, at(next)] : [at(next)];
  return candidates.find(point => !same(point, start)) ?? at(next);
}

/** Punkten strax före slutet, på samma sätt. */
function beforeEnd(part: readonly PathCommand[]): Point {
  const end = at(part[part.length - 1]!), last = part[part.length - 1]!;
  const candidates = last.type === "C" ? [{ x: last.x2, y: last.y2 }, { x: last.x1, y: last.y1 }, at(part[part.length - 2]!)] : [at(part[part.length - 2]!)];
  return candidates.find(point => !same(point, end)) ?? at(part[part.length - 2]!);
}

/** Början och slutet av en linjes första (och enda) del, också när den är sluten. Inget för något annat än en linje. */
function firstAndLast(object: MapObject): { start: EndMark; end: EndMark } | undefined {
  if (object.kind !== "line") return undefined;
  const part = subpaths(object.path).find(candidate => candidate.length >= 2);
  return part ? { start: { at: at(part[0]!), toward: afterStart(part) }, end: { at: at(part[part.length - 1]!), toward: beforeEnd(part) } } : undefined;
}

/**
 * Linjens ändpunkter: början och slutet av varje del. En sluten del (slutar där den börjar) har inga ändar, och inte heller något
 * som inte är en linje.
 */
export function lineEnds(object: MapObject): EndMark[] {
  if (object.kind !== "line") return [];
  const marks: EndMark[] = [];
  for (const part of subpaths(object.path)) {
    if (part.length < 2 || same(at(part[0]!), at(part[part.length - 1]!))) continue;
    marks.push({ at: at(part[0]!), toward: afterStart(part) }, { at: at(part[part.length - 1]!), toward: beforeEnd(part) });
  }
  return marks;
}

/**
 * De nya ändarna efter ett klipp: den första delens sista punkt och den andras första, båda i klippet men var och en med
 * riktningen in i sin del.
 */
export function cutMarks(parts: readonly [MapObject, MapObject]): EndMark[] {
  const first = firstAndLast(parts[0]), second = firstAndLast(parts[1]);
  return first && second ? [first.end, second.start] : [];
}
