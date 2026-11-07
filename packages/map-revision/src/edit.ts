import type { MapObject, MapSymbol, ParsedMap, Path, PathCommand, Point } from "@o-tid/map-file";

/**
 * ADR-0219 beslut 5: redigeringen av ett objekt. Punktobjekt och texter flyttas; linjer och ytor ändras punkt för punkt
 * (flytta, lägg till på en rak sträcka, ta bort). Kurvor ändras bara så långt att deras befintliga punkter går att flytta
 * (styrpunkterna följer med); nya kurvor, att lägga till punkter på en kurva och att ändra styrpunkterna görs inte här.
 * Koordinater i kartans mm med y uppåt. Rena funktioner som ger nya objekt.
 */
export interface VertexAddress { readonly part: number; readonly index: number }
export interface Vertex extends VertexAddress { readonly at: Point; readonly curve: boolean }

export type ObjectKind = MapObject["kind"];

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const endOf = (command: PathCommand): Point => ({ x: command.x, y: command.y });

/** Linjens delar (en per M) eller ytans ringar. */
export function objectParts(object: MapObject): Path[] {
  if (object.kind === "area") return object.rings.map(ring => [...ring]);
  if (object.kind !== "line") return [];
  const parts: PathCommand[][] = [];
  for (const command of object.path) {
    if (command.type === "M" || parts.length === 0) parts.push([command.type === "M" ? command : { type: "M", x: command.x, y: command.y }]);
    else parts[parts.length - 1]!.push(command);
  }
  return parts;
}

function withParts(object: MapObject, parts: readonly Path[]): MapObject {
  if (object.kind === "area") return { ...object, rings: parts };
  if (object.kind === "line") return { ...object, path: parts.flat() };
  return object;
}

/** Ytans sista kommando slutar i första punkten (Mappers stängning som kurva): den räknas inte som egen punkt. */
const closingDuplicate = (object: MapObject, part: Path) => object.kind === "area" && part.length > 2 && near(endOf(part[part.length - 1]!), endOf(part[0]!));

/** Punkterna att ta tag i: varje kommandos slutpunkt (kurvornas styrpunkter inte). */
export function vertices(object: MapObject): Vertex[] {
  const out: Vertex[] = [];
  objectParts(object).forEach((part, partIndex) => {
    const last = closingDuplicate(object, part) ? part.length - 1 : part.length;
    for (let index = 0; index < last; index += 1) {
      const command = part[index]!;
      const next = part[index + 1];
      out.push({ part: partIndex, index, at: endOf(command), curve: command.type === "C" || next?.type === "C" });
    }
  });
  return out;
}

function shift(command: PathCommand, dx: number, dy: number, which: "end" | "c1" | "c2"): PathCommand {
  if (which === "end") return { ...command, x: command.x + dx, y: command.y + dy };
  if (command.type !== "C") return command;
  return which === "c1" ? { ...command, x1: command.x1 + dx, y1: command.y1 + dy } : { ...command, x2: command.x2 + dx, y2: command.y2 + dy };
}

/** Punkten flyttad till `to`; kurvornas styrpunkter vid punkten följer med. Punktobjekt och texter flyttas hela. */
export function moveVertex(object: MapObject, address: VertexAddress, to: Point): MapObject {
  if (object.kind === "point" || object.kind === "text") return { ...object, at: to };
  const parts = objectParts(object);
  const part = parts[address.part];
  const command = part?.[address.index];
  if (!part || !command) return object;
  const dx = to.x - command.x, dy = to.y - command.y;
  const next = [...part];
  const closing = address.index === 0 && closingDuplicate(object, part);
  next[address.index] = shift(shift(command, dx, dy, "end"), dx, dy, "c2");
  const after = next[address.index + 1];
  if (after) next[address.index + 1] = shift(after, dx, dy, "c1");
  // Ytans stängande kurva slutar i första punkten: dess slutpunkt och andra styrpunkt följer med.
  if (closing) next[next.length - 1] = shift(shift(next[next.length - 1]!, dx, dy, "end"), dx, dy, "c2");
  parts[address.part] = next;
  return withParts(object, parts);
}

/** Hela objektet flyttat. */
export function translate(object: MapObject, dx: number, dy: number): MapObject {
  const move = (command: PathCommand): PathCommand => command.type === "C"
    ? { ...command, x: command.x + dx, y: command.y + dy, x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy }
    : { ...command, x: command.x + dx, y: command.y + dy };
  if (object.kind === "point" || object.kind === "text") return { ...object, at: { x: object.at.x + dx, y: object.at.y + dy } };
  if (object.kind === "line") return { ...object, path: object.path.map(move) };
  return { ...object, rings: object.rings.map(ring => ring.map(move)) };
}

/** Raka sträckor där en ny punkt kan läggas in (mitten), med punkten före. Ytans stängande sträcka räknas. */
export function insertPoints(object: MapObject): (VertexAddress & { readonly at: Point })[] {
  const out: (VertexAddress & { at: Point })[] = [];
  objectParts(object).forEach((part, partIndex) => {
    for (let index = 0; index + 1 < part.length; index += 1) {
      const from = part[index]!, to = part[index + 1]!;
      if (to.type !== "C") out.push({ part: partIndex, index, at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } });
    }
    if (object.kind === "area" && part.length >= 3 && !closingDuplicate(object, part)) {
      const from = part[part.length - 1]!, to = part[0]!;
      out.push({ part: partIndex, index: part.length - 1, at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } });
    }
  });
  return out;
}

/**
 * En ny punkt efter punkten `address` (på sträckan till nästa). Bara på raka sträckor; på en kurva ger den undefined.
 */
export function insertVertex(object: MapObject, address: VertexAddress, at: Point): MapObject | undefined {
  const parts = objectParts(object);
  const part = parts[address.part];
  if (!part || address.index < 0 || address.index >= part.length) return undefined;
  const following = part[address.index + 1];
  if (following?.type === "C") return undefined;
  if (!following && object.kind !== "area") return undefined;
  const next = [...part];
  next.splice(address.index + 1, 0, { type: "L", x: at.x, y: at.y });
  parts[address.part] = next;
  return withParts(object, parts);
}

/** Minsta antal punkter: två på en linje, tre i en ytas ring. */
const minimumOf = (object: MapObject) => object.kind === "area" ? 3 : 2;

/**
 * Punkten borttagen. Sträckorna på båda sidor blir en: rak när båda var raka, annars en kurva med de yttre styrpunkterna.
 * En linje med två punkter eller en ring med tre ger undefined (ta bort objektet i stället).
 */
export function deleteVertex(object: MapObject, address: VertexAddress): MapObject | undefined {
  const parts = objectParts(object);
  const part = parts[address.part];
  if (!part) return undefined;
  const closing = closingDuplicate(object, part);
  const count = closing ? part.length - 1 : part.length;
  if (count <= minimumOf(object) || address.index < 0 || address.index >= count) return undefined;
  let next = [...part];
  if (address.index === 0) {
    const second = next[1]!;
    next = [{ type: "M", x: second.x, y: second.y, ...(second.corner ? { corner: true as const } : {}) }, ...next.slice(2)];
    if (closing) {
      const last = next[next.length - 1]!;
      next[next.length - 1] = { ...last, x: second.x, y: second.y };
    }
  } else {
    const incoming = next[address.index]!;
    const outgoing = next[address.index + 1];
    if (!outgoing) next.splice(address.index, 1);
    else {
      const from = next[address.index - 1]!;
      const merged: PathCommand = incoming.type === "C" || outgoing.type === "C"
        ? { type: "C", x1: incoming.type === "C" ? incoming.x1 : from.x, y1: incoming.type === "C" ? incoming.y1 : from.y,
            x2: outgoing.type === "C" ? outgoing.x2 : outgoing.x, y2: outgoing.type === "C" ? outgoing.y2 : outgoing.y, x: outgoing.x, y: outgoing.y }
        : { type: "L", x: outgoing.x, y: outgoing.y };
      next.splice(address.index, 2, merged);
    }
  }
  parts[address.part] = next;
  return withParts(object, parts);
}

/** Ett nytt punktobjekt, en linje eller en yta ur punkterna (raka sträckor). */
export function newObject(kind: "point" | "line" | "area", symbol: string, points: readonly Point[]): MapObject | undefined {
  const first = points[0];
  if (!first) return undefined;
  if (kind === "point") return { kind: "point", symbol, at: first, angle: 0 };
  if (points.length < (kind === "area" ? 3 : 2)) return undefined;
  const path: Path = [{ type: "M", x: first.x, y: first.y }, ...points.slice(1).map(point => ({ type: "L" as const, x: point.x, y: point.y }))];
  return kind === "line" ? { kind: "line", symbol, path } : { kind: "area", symbol, rings: [path], angle: 0 };
}

export const withSymbol = (object: MapObject, symbol: string): MapObject => ({ ...object, symbol });
export const withText = (object: MapObject, text: string): MapObject => object.kind === "text" ? { ...object, text } : object;

/**
 * Vilket slags objekt en symbol ritar: punkt, linje, yta eller text. Mappers sammansatta symbol är en yta när någon del är en
 * yta (som läsaren gör), annars en linje.
 */
export function symbolObjectKind(map: Pick<ParsedMap, "symbols">, symbol: MapSymbol, depth = 0): ObjectKind {
  switch (symbol.kind) {
    case "POINT": return "point";
    case "LINE": return "line";
    case "AREA": return "area";
    case "TEXT": return "text";
    case "COMBINED": {
      if (depth > 4) return "line";
      const kinds = symbol.parts.map(id => map.symbols.get(id)).filter((part): part is MapSymbol => !!part)
        .map(part => symbolObjectKind(map, part, depth + 1));
      return kinds.includes("area") ? "area" : "line";
    }
  }
}
