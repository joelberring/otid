/**
 * ADR-0207: modellens geometri (mm, y uppåt, modellens flaggor) till filens heltal, exakt omvänt mot läsarna
 * (`ocd/coords.ts` och `omap/coords.ts`). En punkt som finns i originalobjektet med samma heltal och samma kända flaggor
 * får tillbaka originalets hela värde, så att flaggbitar som modellen inte visar följer med oförändrade.
 */
import { GAP, type Path, type PathCommand } from "../model";
import type { RevisionGeometry } from "./change-set";

/** En punkt i filens enheter med flaggor: OCAD x- och y-flaggor (låga 8 bitar), Mapper en flagga per punkt. */
interface UnitPoint { readonly x: number; readonly y: number; readonly xFlags: number; readonly yFlags: number }

/** Fel i geometrin som gör att ändringen inte kan skrivas. */
export class GeometryError extends Error {}

/** OCAD: värdet ligger i de höga 24 bitarna (med tecken). */
const OCD_LIMIT = (1 << 23) - 1;
/** Mapper: 32-bitars heltal (0,001 mm). */
const XML_LIMIT = 2 ** 31 - 1;

function toUnit(value: number, scale: number, limit: number): number {
  if (!Number.isFinite(value)) throw new GeometryError("Geometrin har en koordinat som inte är ett tal.");
  const unit = Math.round(value * scale);
  if (Math.abs(unit) > limit) throw new GeometryError("Geometrin ligger utanför det område som filformatet kan lagra.");
  return unit === 0 ? 0 : unit;
}

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

// ---------------------------------------------------------------- OCAD

/** OCAD:s kända flaggor (de som modellen läser): x 1, 2, 4, 8 och y 1, 2, 4, 8. Resten följer med från originalet. */
const OCD_KNOWN = 0x0f;
const OCD = { firstControl: 1, secondControl: 2, leftGap: 4, mainGap: 8, corner: 1, holeStart: 2, rightGap: 4, dash: 8 } as const;

/** OCAD-punkter som två int32 per punkt (värde << 8 | flaggor). */
export interface OcdRaw { readonly x: Int32Array; readonly y: Int32Array }

function ocdGapFlags(gap: number | undefined): { x: number; y: number } {
  if (!gap) return { x: 0, y: 0 };
  return { x: ((gap & GAP.main) !== 0 ? OCD.mainGap : 0) | ((gap & GAP.left) !== 0 ? OCD.leftGap : 0), y: (gap & GAP.right) !== 0 ? OCD.rightGap : 0 };
}

const cornerDash = (command: PathCommand) => ((command.corner ? OCD.corner : 0) | (command.dash ? OCD.dash : 0));

/**
 * Geometrin som OCAD-punkter. Omvänt mot `coordsToParts(…, flags = true)`: luckan för sträckan fram till en punkt ligger på
 * sträckans första punkt, delens `M.gap` (stängande sträckan) på delens sista punkt, och varje del efter den första börjar
 * med y-flaggan 2.
 */
export function ocdPoints(geometry: RevisionGeometry, original?: OcdRaw): OcdRaw {
  const points: { x: number; y: number; xFlags: number; yFlags: number }[] = [];
  geometryParts(geometry).forEach((part, partIndex) => {
    const anchorOf: number[] = [];
    part.forEach((command, k) => {
      if (k > 0) {
        const gap = ocdGapFlags(command.gap);
        const anchor = points[anchorOf[k - 1]!]!;
        anchor.xFlags |= gap.x;
        anchor.yFlags |= gap.y;
      }
      const unit = (value: number) => toUnit(value, 100, OCD_LIMIT);
      if (command.type === "C") {
        points.push({ x: unit(command.x1), y: unit(command.y1), xFlags: OCD.firstControl, yFlags: 0 });
        points.push({ x: unit(command.x2), y: unit(command.y2), xFlags: OCD.secondControl, yFlags: 0 });
      }
      points.push({ x: unit(command.x), y: unit(command.y), xFlags: 0, yFlags: cornerDash(command) | (k === 0 && partIndex > 0 ? OCD.holeStart : 0) });
      anchorOf.push(points.length - 1);
    });
    if (geometry.kind === "line" || geometry.kind === "area") {
      const closing = ocdGapFlags(part[0]!.gap);
      const last = points[anchorOf[anchorOf.length - 1]!]!;
      last.xFlags |= closing.x;
      last.yFlags |= closing.y;
    }
  });
  const known = new OriginalPoints<readonly [number, number]>();
  if (original) {
    for (let i = 0; i < original.x.length; i++) {
      const rawX = original.x[i]!, rawY = original.y[i]!;
      known.add(`${rawX >> 8},${rawY >> 8},${rawX & OCD_KNOWN},${rawY & OCD_KNOWN}`, [rawX, rawY]);
    }
  }
  const x = new Int32Array(points.length), y = new Int32Array(points.length);
  points.forEach((point, i) => {
    const kept = original ? known.take(`${point.x},${point.y},${point.xFlags},${point.yFlags}`) : undefined;
    x[i] = kept ? kept[0] : (point.x * 256) | point.xFlags;
    y[i] = kept ? kept[1] : (point.y * 256) | point.yFlags;
  });
  return { x, y };
}

/** Flyttar originalets punkter (en text med sin ruta) så att den första hamnar på `at`; flaggorna behålls. */
export function ocdTranslate(original: OcdRaw, at: { x: number; y: number }): OcdRaw {
  const dx = toUnit(at.x, 100, OCD_LIMIT) - (original.x[0]! >> 8);
  const dy = toUnit(at.y, 100, OCD_LIMIT) - (original.y[0]! >> 8);
  const move = (raw: Int32Array, delta: number) => Int32Array.from(raw, value => {
    const unit = (value >> 8) + delta;
    if (Math.abs(unit) > OCD_LIMIT) throw new GeometryError("Geometrin ligger utanför det område som filformatet kan lagra.");
    return (unit * 256) | (value & 0xff);
  });
  return { x: move(original.x, dx), y: move(original.y, dy) };
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
 * första får flaggan 2 där.
 */
export function xmlPoints(geometry: RevisionGeometry, original?: XmlTriples): number[] {
  const unitX = (value: number) => toUnit(value, 1000, XML_LIMIT);
  const unitY = (value: number) => toUnit(0 - value, 1000, XML_LIMIT);
  const points: UnitPoint[] = [];
  const parts = geometryParts(geometry);
  parts.forEach((part, partIndex) => {
    const start = points.length;
    part.forEach(command => {
      const dash = command.corner || command.dash ? XML_FLAG.dash : 0;
      if (command.type === "C") {
        const anchor = points[points.length - 1]!;
        points[points.length - 1] = { ...anchor, xFlags: anchor.xFlags | XML_FLAG.curveStart };
        points.push({ x: unitX(command.x1), y: unitY(command.y1), xFlags: 0, yFlags: 0 });
        points.push({ x: unitX(command.x2), y: unitY(command.y2), xFlags: 0, yFlags: 0 });
      }
      points.push({ x: unitX(command.x), y: unitY(command.y), xFlags: dash, yFlags: 0 });
    });
    const first = points[start]!;
    const last = points[points.length - 1]!;
    const closed = points.length - start > 2 && last.x === first.x && last.y === first.y;
    if (closed && (geometry.kind === "area" || geometry.kind === "line")) {
      points[points.length - 1] = { ...last, xFlags: last.xFlags | XML_FLAG.close };
    } else if (geometry.kind === "area") {
      points.push({ x: first.x, y: first.y, xFlags: XML_FLAG.close | (first.xFlags & XML_FLAG.dash), yFlags: 0 });
    }
    if (partIndex < parts.length - 1) {
      const end = points[points.length - 1]!;
      points[points.length - 1] = { ...end, xFlags: end.xFlags | XML_FLAG.hole };
    }
  });
  const known = new OriginalPoints<number>();
  if (original) {
    for (let i = 0; i + 2 < original.length; i += 3) {
      known.add(`${original[i]},${original[i + 1]},${original[i + 2]! & XML_KNOWN}`, original[i + 2]!);
    }
  }
  const out: number[] = [];
  for (const point of points) {
    const kept = original ? known.take(`${point.x},${point.y},${point.xFlags}`) : undefined;
    out.push(point.x, point.y, kept ?? point.xFlags);
  }
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
