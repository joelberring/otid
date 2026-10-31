import type { MapObject, ParsedMap, Path, PathCommand, PointElement, SymbolCode } from "./model";

/** Symbolnummer ur text som i filen ("406", "406.0", "105.100"). Saknas nummer blir huvudnumret 0. */
export function parseSymbolCode(text: string): SymbolCode {
  const match = /^\s*(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) return { text, main: 0, sub: 0 };
  return { text, main: Number(match[1]), sub: match[2] === undefined ? 0 : Number(match[2]) };
}

/** OCAD lagrar symbolnumret gånger 1000: 101001 visas som "101.1" och 105100 som "105.100". */
export function ocdSymbolCode(number: number): SymbolCode {
  const main = Math.floor(number / 1000);
  const sub = number % 1000;
  return { text: `${main}.${sub}`, main, sub };
}

export const NO_CODE: SymbolCode = { text: "", main: 0, sub: 0 };

/** Vinkel i grader till [0, 360), avrundad till 0,0001° så att radianer ur Mapper och tiondels grader ur OCAD möts. */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const value = Math.round((((degrees % 360) + 360) % 360) * 10000) / 10000;
  return value >= 360 ? 0 : value;
}

/** Rasterlinjer är symmetriska: vinkeln till [0, 180). */
export function normalizeHatchAngle(degrees: number): number {
  const value = normalizeAngle(degrees);
  return value >= 180 ? value - 180 : value;
}

/** En ytas ring är alltid stängd: en sista rak linje tillbaka till startpunkten tas bort (Mapper skriver den, OCAD inte). */
export function openRing(ring: Path): Path {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 2 && first && last?.type === "L" && Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) {
    return ring.slice(0, -1);
  }
  return ring;
}

/** Flyttar ett punktsymbolelement. */
export function moveElement(element: PointElement, dx: number, dy: number): PointElement {
  if (dx === 0 && dy === 0) return element;
  const path = (p: Path): Path => p.map(command => moveCommand(command, dx, dy));
  switch (element.kind) {
    case "circle":
    case "dot": return { ...element, center: { x: element.center.x + dx, y: element.center.y + dy } };
    case "line": return { ...element, path: path(element.path) };
    case "area": return { ...element, rings: element.rings.map(path) };
  }
}

export function moveCommand(command: PathCommand, dx: number, dy: number): PathCommand {
  if (command.type !== "C") return { type: command.type, x: command.x + dx, y: command.y + dy };
  return { type: "C", x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy, x: command.x + dx, y: command.y + dy };
}

type Bounds = NonNullable<ParsedMap["bounds"]>;

/** Ytan som objektens koordinater (även kurvornas styrpunkter) täcker, i mm. */
export function boundsOf(objects: readonly MapObject[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const addPath = (path: Path) => {
    for (const command of path) {
      if (command.type === "C") { add(command.x1, command.y1); add(command.x2, command.y2); }
      add(command.x, command.y);
    }
  };
  for (const object of objects) {
    if (object.kind === "point" || object.kind === "text") add(object.at.x, object.at.y);
    else if (object.kind === "line") addPath(object.path);
    else for (const ring of object.rings) addPath(ring);
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
