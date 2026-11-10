import { GAP, type MapObject, type Path, type PathCommand, type Point } from "@o-tid/map-file";
import { insertOnSegment, nearestSegment } from "@o-tid/map-revision";
import { nearestVertex } from "./map-project-draw";

type Line = Extract<MapObject, { kind: "line" }>;
const isLine = (object: MapObject): object is Line => object.kind === "line";
const simple = (path: Path) => path.length >= 2 && path[0]!.type === "M" && path.slice(1).every(command => command.type !== "M");
const at = (command: PathCommand): Point => ({ x: command.x, y: command.y });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Punktens egna märken (hörn, streckpunkt) utan koordinaterna, så att de följer punkten när linjen vänds. */
function marksOf(command: PathCommand): { corner?: true; dash?: true } {
  return { ...(command.corner ? { corner: true as const } : {}), ...(command.dash ? { dash: true as const } : {}) };
}
/** Sträckans lucka följer sträckan; vänster och höger kantlinje byter sida när linjen vänds. */
function gapOf(command: PathCommand): { gap?: number } {
  const gap = command.gap;
  if (!gap) return {};
  return { gap: (gap & GAP.main) | (gap & GAP.left ? GAP.right : 0) | (gap & GAP.right ? GAP.left : 0) };
}

/** Linjen åt andra hållet: samma form, kurvornas handtag byter plats, punkternas märken följer punkterna och luckorna sträckorna. */
export function reversePath(path: Path): PathCommand[] {
  const out: PathCommand[] = [{ ...marksOf(path[path.length - 1]!), type: "M", ...at(path[path.length - 1]!) }];
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const command = path[i]!, target = path[i - 1]!;
    out.push(command.type === "C"
      ? { ...marksOf(target), ...gapOf(command), type: "C", x1: command.x2, y1: command.y2, x2: command.x1, y2: command.y1, ...at(target) }
      : { ...marksOf(target), ...gapOf(command), type: "L", ...at(target) });
  }
  return out;
}

/** `next` läggs efter `path`: möts ändarna (inom `snap`) blir de en punkt, annars binds de ihop med en rak sträcka. */
function append(path: readonly PathCommand[], next: Path, snap: number): PathCommand[] {
  const gap = distance(at(path[path.length - 1]!), at(next[0]!));
  const bridge: PathCommand[] = gap <= snap ? [] : [{ ...marksOf(next[0]!), type: "L", ...at(next[0]!) }];
  return [...path, ...bridge, ...next.slice(1)];
}

export interface JoinResult {
  /** Den hopslagna linjen (den första linjens symbol och övriga egenskaper). */
  readonly object: MapObject;
  /** Vilka av de givna objekten som gick in i den (index); det första är det som behålls. */
  readonly used: readonly number[];
}

/**
 * Ägaren 2026-11-10 («hur man slår ihop linjer»; «koppla ihop» på hjulet i Mapper): de markerade linjerna med samma symbol
 * blir en linje. Linjer vars ändar möts inom `tolerance` kedjas ihop, vända åt rätt håll. Är precis två linjer markerade
 * slås de alltid ihop, vid de ändar som ligger närmast varandra, med en rak sträcka emellan om de inte möts. Inget resultat
 * när ingenting går att slå ihop.
 */
export function joinLines(objects: readonly MapObject[], tolerance: number): JoinResult | undefined {
  const lines = objects.map((object, index) => ({ object, index })).filter((row): row is { object: Line; index: number } => isLine(row.object) && simple(row.object.path));
  for (const first of lines) {
    const same = lines.filter(row => row.object.symbol === first.object.symbol);
    if (same.length < 2) continue;
    const reach = same.length === 2 && same.length === lines.length ? Infinity : tolerance;
    let path: PathCommand[] = [...first.object.path];
    const used = [first.index], left = same.filter(row => row !== first);
    for (;;) {
      const start = at(path[0]!), end = at(path[path.length - 1]!);
      let best: { row: typeof left[number]; gap: number; atEnd: boolean; flip: boolean } | undefined;
      for (const row of left) {
        const a = at(row.object.path[0]!), b = at(row.object.path[row.object.path.length - 1]!);
        for (const option of [{ gap: distance(end, a), atEnd: true, flip: false }, { gap: distance(end, b), atEnd: true, flip: true },
          { gap: distance(start, b), atEnd: false, flip: false }, { gap: distance(start, a), atEnd: false, flip: true }]) {
          if (option.gap <= reach && (!best || option.gap < best.gap)) best = { row, ...option };
        }
      }
      if (!best) break;
      const piece = best.flip ? reversePath(best.row.object.path) : best.row.object.path;
      path = best.atEnd ? append(path, piece, tolerance) : append(piece, path, tolerance);
      used.push(best.row.index);
      left.splice(left.indexOf(best.row), 1);
    }
    if (used.length >= 2) return { object: { ...first.object, path }, used };
  }
  return undefined;
}

/** Ägaren 2026-11-10 (jämförelsen med Mapper: «vänd riktning», för branter och stängsel): linjen åt andra hållet. */
export function reverseLine(object: MapObject): MapObject | undefined {
  return isLine(object) && simple(object.path) ? { ...object, path: reversePath(object.path) } : undefined;
}

/**
 * Saxen («klipp isär» på hjulet i Mapper): linjen delas i två där man klickar, vid en brytpunkt om klicket står på en, annars
 * på sträckan under pekaren. Den första delen behåller objektet; den andra blir ett nytt objekt med samma symbol. Inget
 * när klicket inte träffar linjen eller står på en ändpunkt.
 */
export function cutLineAt(object: MapObject, point: Point, tolerance: number): [MapObject, MapObject] | undefined {
  if (!isLine(object) || !simple(object.path)) return undefined;
  let line: Line = object, index = nearestVertex(object, point, tolerance)?.index;
  if (index === undefined) {
    const hit = nearestSegment(object, point, tolerance), inserted = hit ? insertOnSegment(object, hit, hit.t) : undefined;
    if (!inserted?.address || !isLine(inserted.object)) return undefined;
    line = inserted.object; index = inserted.address.index;
  }
  if (index <= 0 || index >= line.path.length - 1) return undefined;
  const at = line.path[index]!;
  return [{ ...line, path: line.path.slice(0, index + 1) }, { ...line, path: [{ ...marksOf(at), type: "M", x: at.x, y: at.y }, ...line.path.slice(index + 1)] }];
}
