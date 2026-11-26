import { GAP, type LineSymbol, type Path, type Point, type PointElement, type RepeatedSymbol } from "../model";
import { flattenPath, withoutGaps, type Polyline } from "./geometry";

/**
 * Linjesymbolernas punktsymboler för skärmen: var de ligger längs objektets väg (hörn, början, slut och med jämna
 * avstånd). Egen kod efter OCAD:s och Mappers beskrivning av symbolerna; avstånden justeras som i de programmen så att
 * de går jämnt ut mellan ändarna och hörnen.
 */

/** Ett ställe för en punktsymbol: mittpunkt, vinkel (radianer moturs, x-axeln längs linjen) och sträckning på tvären. */
export interface Placement { readonly at: Point; readonly angle: number; readonly stretch: number }

/** Sträckningen i spetsiga hörn begränsas som i OCAD. */
const MAX_CORNER_STRETCH = 3;
const EPSILON = 1e-6;

/** En delväg som polylinje, med index för punkterna som är hörn (`corners`) och där mönstret börjar om (`breaks`). */
export interface MarkedLine { readonly points: Polyline; readonly corners: readonly number[]; readonly breaks: readonly number[] }

/** Vägen som polylinjer med hörn- och streckpunkterna markerade. Punkter som ligger på varandra slås ihop. */
export function markedLines(path: Path): MarkedLine[] {
  const lines: MarkedLine[] = [];
  let points: Point[] = [], corners: number[] = [], breaks: number[] = [];
  const flush = () => {
    if (points.length >= 2) lines.push({ points, corners: [...new Set(corners)], breaks: [...new Set(breaks)] });
    points = []; corners = []; breaks = [];
  };
  const add = (point: Point) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > EPSILON) points.push(point);
  };
  for (const command of path) {
    if (command.type === "M") { flush(); add(command); }
    else if (command.type === "L") add(command);
    else {
      const from = points[points.length - 1] ?? { x: command.x, y: command.y };
      const flat = flattenPath([{ type: "M", x: from.x, y: from.y }, command])[0] ?? [];
      for (const point of flat.slice(1)) add(point);
    }
    const index = points.length - 1;
    if (command.corner) { corners.push(index); breaks.push(index); }
    if (command.dash) breaks.push(index);
  }
  flush();
  return lines;
}

function direction(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
}

/** Hörnsymbolen: längs bisektrisen och sträckt med geringsfaktorn 1/cos(halva vridningen), högst tre gånger. */
export function cornerPlacements(line: MarkedLine, stretch: boolean, skipEnds: boolean): Placement[] {
  const { points } = line;
  const last = points.length - 1;
  const out: Placement[] = [];
  for (const index of line.corners) {
    if (skipEnds && (index === 0 || index === last)) continue;
    const before = index > 0 ? direction(points[index - 1]!, points[index]!) : undefined;
    const after = index < last ? direction(points[index]!, points[index + 1]!) : undefined;
    const a = before ?? after!, b = after ?? before!;
    const sum = { x: a.x + b.x, y: a.y + b.y };
    const length = Math.hypot(sum.x, sum.y);
    const angle = length > EPSILON ? Math.atan2(sum.y, sum.x) : Math.atan2(a.y, a.x);
    // cos(halva vridningen) = |a + b| / 2. I ändarna och där linjen går rakt sträcks inget.
    const factor = stretch && before && after ? (length > EPSILON ? Math.min(MAX_CORNER_STRETCH, 2 / length) : MAX_CORNER_STRETCH) : 1;
    out.push({ at: points[index]!, angle, stretch: Math.abs(factor - 1) < 1e-9 ? 1 : factor });
  }
  return out;
}

export function endPlacement(line: MarkedLine, which: "start" | "end"): Placement {
  const { points } = line;
  const n = points.length;
  const [from, to] = which === "start" ? [points[0]!, points[1]!] : [points[n - 2]!, points[n - 1]!];
  const d = direction(from, to);
  return { at: which === "start" ? from : to, angle: Math.atan2(d.y, d.x), stretch: 1 };
}

/**
 * Avstånden från början av en del med längden `length` där symbolerna ligger: första och sista `endLength` in, resten
 * med `spacing` emellan. Antalet avrundas och avstånden skalas så att mönstret går jämnt ut; en ensam symbol hamnar mitt
 * på. Minst `minimum` symboler.
 */
export function spacedDistances(length: number, spacing: number, endLength: number, minimum: number): number[] {
  if (!(length > 0) || !(spacing > 0)) return [];
  const end = Math.max(0, endLength);
  let count: number;
  if (length - 2 * end <= 0) count = minimum >= 1 || length >= end ? 1 : 0;
  else count = Math.round((length + spacing - 2 * end) / spacing);
  count = Math.max(count, minimum);
  if (count <= 0) return [];
  if (count === 1) return [length / 2];
  const actual = length / (count - 1 + (2 * end) / spacing);
  const first = (actual * end) / spacing;
  return Array.from({ length: count }, (_, index) => first + index * actual);
}

/** Polylinjen mellan två index, med längderna och kumulativa avstånd längs vägen. */
function piece(points: Polyline, from: number, to: number): { points: Polyline; lengths: number[]; cum: number[]; total: number } {
  const part = points.slice(from, to + 1);
  const segCount = Math.max(0, part.length - 1);
  const lengths = new Array<number>(segCount);
  const cum = new Array<number>(segCount + 1);
  cum[0] = 0;
  for (let i = 0; i < segCount; i += 1) {
    const len = Math.hypot(part[i + 1]!.x - part[i]!.x, part[i + 1]!.y - part[i]!.y);
    lengths[i] = len;
    cum[i + 1] = cum[i]! + len;
  }
  return { points: part, lengths, cum, total: cum[segCount]! };
}

function pointAt(part: ReturnType<typeof piece>, distance: number, cursor: { segment: number }): Placement {
  const target = Math.min(Math.max(distance, 0), part.total);
  const maxSeg = part.lengths.length - 1;
  let segment = cursor.segment;
  while (segment > 0 && part.cum[segment]! >= target) segment -= 1;
  while (segment < maxSeg && part.cum[segment + 1]! < target) segment += 1;
  cursor.segment = segment;
  const from = part.points[segment]!, to = part.points[segment + 1]!;
  const len = part.lengths[segment]!;
  const t = len > 0 ? (target - part.cum[segment]!) / len : 0;
  return { at: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, angle: Math.atan2(to.y - from.y, to.x - from.x), stretch: 1 };
}

/**
 * Upprepade symboler längs linjen, del för del mellan hörn- och streckpunkterna. `between` ger i stället ett ställe mitt
 * emellan varje par (OCAD:s sekundärsymbol).
 */
export function spacedPlacements(line: MarkedLine, symbol: RepeatedSymbol, between = false, limit = Infinity): Placement[] {
  const stops = [0, ...line.breaks.filter(index => index > 0 && index < line.points.length - 1).sort((a, b) => a - b), line.points.length - 1];
  const parts = stops.slice(1).map((to, index) => piece(line.points, stops[index]!, to));
  const longest = parts.reduce((best, part, index) => (part.total > parts[best]!.total ? index : best), 0);
  const endLength = symbol.endLength ?? symbol.spacing / 2;
  const count = Math.max(1, symbol.count ?? 1);
  const groupSpacing = symbol.groupSpacing ?? 0;
  const out: Placement[] = [];
  parts.forEach((part, index) => {
    // Minsta antalet gäller hela linjen och läggs på den längsta delen, som OCAD gör.
    let distances = spacedDistances(part.total, symbol.spacing, endLength, index === longest ? (symbol.minimum ?? 1) : 0);
    if (between) distances = distances.slice(1).map((distance, k) => (distance + distances[k]!) / 2);
    const cursor = { segment: 0 };
    for (const distance of distances) {
      for (let k = 0; k < count && out.length < limit; k += 1) out.push(pointAt(part, distance + (k - (count - 1) / 2) * groupSpacing, cursor));
    }
  });
  return out;
}

/** Alla punktsymboler i en linjesymbol för en väg, var för sig med sina element. */
export function lineDecorations(symbol: LineSymbol, paths: readonly Path[], limit: number): { elements: readonly PointElement[]; places: Placement[] }[] {
  const needsActive = Boolean(
    (symbol.repeated && symbol.repeated.spacing > 0) ||
    (symbol.between && symbol.between.spacing > 0) ||
    symbol.corner
  );
  const needsEnds = Boolean(symbol.start || symbol.end);
  if (!needsActive && !needsEnds) return [];
  // Upprepade symboler och hörnsymboler ritas inte över luckor i huvudlinjen (`GAP.main`); start/slut behåller ursprungsvägen.
  let activeLines: MarkedLine[] = [];
  let lines: MarkedLine[] = [];
  if (needsActive && needsEnds) {
    for (const path of paths) {
      const activePath = withoutGaps(path, GAP.main);
      const active = markedLines(activePath);
      activeLines.push(...active);
      lines.push(...(activePath === path ? active : markedLines(path)));
    }
  } else if (needsActive) {
    activeLines = paths.flatMap(path => markedLines(withoutGaps(path, GAP.main)));
  } else {
    lines = paths.flatMap(markedLines);
  }
  const out: { elements: readonly PointElement[]; places: Placement[] }[] = [];
  const add = (elements: readonly PointElement[] | undefined, places: Placement[]) => {
    if (elements && elements.length > 0 && places.length > 0) out.push({ elements, places: places.slice(0, limit) });
  };
  if (symbol.repeated && symbol.repeated.spacing > 0) add(symbol.repeated.elements, activeLines.flatMap(line => spacedPlacements(line, symbol.repeated!, false, limit)));
  if (symbol.between && symbol.between.spacing > 0) add(symbol.between.elements, activeLines.flatMap(line => spacedPlacements(line, symbol.between!, true, limit)));
  if (symbol.corner) add(symbol.corner.elements, activeLines.flatMap(line => cornerPlacements(line, symbol.corner!.stretch, symbol.corner!.skipEnds ?? false)));
  if (symbol.start) add(symbol.start.elements, lines.map(line => endPlacement(line, "start")));
  if (symbol.end) add(symbol.end.elements, lines.map(line => endPlacement(line, "end")));
  return out;
}
