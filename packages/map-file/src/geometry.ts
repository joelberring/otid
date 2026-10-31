import type { MapObject, ParsedMap, Path, SymbolCode } from "./model";

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
