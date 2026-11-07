/**
 * ADR-0219: modellens geometri (mm, y uppåt, modellens flaggor) till Mappers heltal, exakt omvänt mot läsaren
 * (`omap/coords.ts`). En punkt som finns i originalobjektet med samma heltal och samma kända flaggor får tillbaka
 * originalets hela värde, så att flaggbitar som modellen inte visar (t.ex. luckpunkten 4) följer med oförändrade. OCAD:s
 * motsvarighet skrivs i K7 (grenen kartfil-skrivning hade ett utkast).
 */
import type { Path, PathCommand } from "../model";
import type { RevisionGeometry } from "./change-set";

/** En punkt i Mappers enheter (0,001 mm, y nedåt) med sin flagga. */
interface UnitPoint { readonly x: number; readonly y: number; readonly flags: number }

/** Fel i geometrin som gör att ändringen inte kan skrivas. */
export class GeometryError extends Error {}

/** Mapper: 32-bitars heltal (0,001 mm). */
const XML_LIMIT = 2 ** 31 - 1;

function toUnit(value: number): number {
  if (!Number.isFinite(value)) throw new GeometryError("Geometrin har en koordinat som inte är ett tal.");
  const unit = Math.round(value * 1000);
  if (Math.abs(unit) > XML_LIMIT) throw new GeometryError("Geometrin ligger utanför det område som filformatet kan lagra.");
  return unit === 0 ? 0 : unit;
}

/** Kartans mm till Mappers x (0,001 mm). */
export const xmlUnitX = (value: number) => toUnit(value);
/** Kartans mm (y uppåt) till Mappers y (0,001 mm, y nedåt). */
export const xmlUnitY = (value: number) => toUnit(0 - value);

/** Delarna i geometrin: linjens delar (en per M) eller ytans ringar. Punkter och texter har en punkt. */
export function geometryParts(geometry: RevisionGeometry): Path[] {
  switch (geometry.kind) {
    case "point":
    case "text": return [[{ type: "M", x: geometry.at.x, y: geometry.at.y }]];
    case "area": return geometry.rings.map(ring => [...ring]);
    case "line": {
      const parts: PathCommand[][] = [];
      for (const command of geometry.path) {
        if (command.type === "M" || parts.length === 0) parts.push([]);
        parts[parts.length - 1]!.push(command);
      }
      return parts;
    }
  }
}

/** Kontrollerar att geometrin går att skriva: linjer har minst två punkter, ytor minst tre per ring, alla delar börjar med M. */
export function checkGeometry(geometry: RevisionGeometry): void {
  if (geometry.kind === "point" || geometry.kind === "text") {
    if (!Number.isFinite(geometry.at.x) || !Number.isFinite(geometry.at.y)) throw new GeometryError("Punkten saknar läge.");
    return;
  }
  const parts = geometryParts(geometry);
  if (parts.length === 0) throw new GeometryError("Geometrin är tom.");
  for (const part of parts) {
    if (part[0]?.type !== "M") throw new GeometryError("Varje del av geometrin ska börja med en flyttning (M).");
    if (part.slice(1).some(command => command.type === "M")) throw new GeometryError("En ring har flera flyttningar (M).");
    // En ring behöver tre punkter, eller två där en sträcka är en kurva; en linje två.
    const enough = geometry.kind === "area" ? part.length >= 3 || (part.length === 2 && part[1]!.type === "C") : part.length >= 2;
    if (!enough) throw new GeometryError(geometry.kind === "area" ? "En ring i ytan har för få punkter." : "Linjen har för få punkter.");
  }
}

/** Matchar nya punkter mot originalets: nyckeln är heltalen och de kända flaggorna, värdet originalets hela tal. */
class OriginalPoints<T> {
  private readonly queue = new Map<string, T[]>();

  add(key: string, value: T): void {
    const list = this.queue.get(key);
    if (list) list.push(value);
    else this.queue.set(key, [value]);
  }

  take(key: string): T | undefined {
    return this.queue.get(key)?.shift();
  }
}

// ---------------------------------------------------------------- Mapper

const XML_FLAG = { curveStart: 1, close: 2, hole: 16, dash: 32 } as const;
/** Mappers kända flaggor (de som skrivaren räknar fram). Luckpunkten (4) och okända bitar följer med från originalet. */
const XML_KNOWN = XML_FLAG.curveStart | XML_FLAG.close | XML_FLAG.hole | XML_FLAG.dash;

/** Mapper-punkter som trippel (x, y nedåt, flaggor) i 0,001 mm. */
export type XmlTriples = readonly number[];

/**
 * Geometrin som Mapper-punkter. Omvänt mot `omap/coords.ts`: kurvan börjar med flaggan 1 på punkten före styrpunkterna,
 * `corner` och `dash` blir streckpunkt (32), varje del utom den sista slutar med 16. En ring i en yta stängs med en kopia
 * av första punkten (flaggan 2 och första punktens streckflagga), som Mapper; en linje vars sista punkt ligger på den
 * första får flaggan 2 där. Med `holeOnLast` får också den sista delens sista punkt 16, som Mapper skriver ytor (vid en
 * ändring följer det originalets sista punkt).
 */
export function xmlPoints(geometry: RevisionGeometry, original?: XmlTriples, holeOnLast = geometry.kind === "area"): number[] {
  const points: UnitPoint[] = [];
  const parts = geometryParts(geometry);
  const mark = (index: number, flag: number) => { const point = points[index]!; points[index] = { ...point, flags: point.flags | flag }; };
  parts.forEach((part, partIndex) => {
    const start = points.length;
    part.forEach(command => {
      if (command.type === "C") {
        mark(points.length - 1, XML_FLAG.curveStart);
        points.push({ x: xmlUnitX(command.x1), y: xmlUnitY(command.y1), flags: 0 });
        points.push({ x: xmlUnitX(command.x2), y: xmlUnitY(command.y2), flags: 0 });
      }
      points.push({ x: xmlUnitX(command.x), y: xmlUnitY(command.y), flags: command.corner || command.dash ? XML_FLAG.dash : 0 });
    });
    const first = points[start]!;
    const last = points[points.length - 1]!;
    const closed = points.length - start > 2 && last.x === first.x && last.y === first.y;
    if (closed && (geometry.kind === "area" || geometry.kind === "line")) mark(points.length - 1, XML_FLAG.close);
    else if (geometry.kind === "area") points.push({ x: first.x, y: first.y, flags: XML_FLAG.close | (first.flags & XML_FLAG.dash) });
    if (partIndex < parts.length - 1 || holeOnLast) mark(points.length - 1, XML_FLAG.hole);
  });
  const known = new OriginalPoints<number>();
  if (original) {
    for (let i = 0; i + 2 < original.length; i += 3) known.add(`${original[i]},${original[i + 1]},${original[i + 2]! & XML_KNOWN}`, original[i + 2]!);
  }
  const out: number[] = [];
  for (const point of points) out.push(point.x, point.y, (original ? known.take(`${point.x},${point.y},${point.flags}`) : undefined) ?? point.flags);
  return out;
}

/** Mappers `<coords>`-text: "x y;" eller "x y flaggor;" per punkt, som Mapper skriver. */
export function xmlCoordsText(triples: XmlTriples): string {
  let out = "";
  for (let i = 0; i + 2 < triples.length; i += 3) {
    out += triples[i + 2] ? `${triples[i]} ${triples[i + 1]} ${triples[i + 2]};` : `${triples[i]} ${triples[i + 1]};`;
  }
  return out;
}
