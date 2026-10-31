/**
 * Steg 60 (ADR-0179 beslut 8–10, 13): analysen av en sträcka. Rutnätet byggs ur kostnadsmodellen, bästa vägen söks
 * med A*, stråket (vägar högst 5 % sämre) ur två avståndsfält från ändarna, alternativen genom att straffa de vägar som
 * redan hittats och söka igen, och osäkerheten genom att räkna om med farterna ändrade ±15 % mellan snabba och
 * långsamma klasser.
 */
import type { Point } from "@o-tid/map-file";
import { preparedOf } from "./cost-model";
import { RUNNABLE_CLASSES, type ResolvedSettings, type RunnableClass, resolveSettings } from "./defaults";
import { distance, distanceToPolyline, polylineLength, simplify } from "./geometry";
import { cellCenter, cellOf, legFrame, paceField, rasterize, strokeLine, type Grid } from "./raster";
import { backtrack, minimumPace, search, type SearchGrid } from "./search";
import { polylineCost, straighten } from "./smooth";
import type { CostModel, LegAnalysis, LegInput, LegWarning, RouteChoiceSettings, RouteLine } from "./types";

/** Stråket: vägar högst så här mycket sämre än den bästa. */
export const CORRIDOR_FACTOR = 1.05;
/** Alternativ: högst så här mycket sämre och mindre än så här stor del gemensam med tidigare vägar. */
export const ALTERNATIVE_FACTOR = 1.15;
export const MAX_SHARED = 0.5;
export const MAX_ALTERNATIVES = 3;
/** Osäkerheten: snabba klasser upp och långsamma ned (och tvärtom) med så här mycket. */
export const UNCERTAINTY = 0.15;
/** Kontrollringens radie på kartan (ISOM 703: diameter 5–6 mm). */
export const CONTROL_RING_RADIUS_MM = 3;
/** Så långt (m) en kontroll i ej passerbar mark får flyttas till närmaste passerbara cell. */
export const SNAP_METERS = 10;

interface Context {
  readonly grid: Grid;
  readonly searchGrid: SearchGrid;
  readonly settings: ResolvedSettings;
  readonly mmPerMeter: number;
}

interface FoundRoute {
  readonly corners: number[];
  /** Rutnätsvägens kostnad med farterna sökningen gjordes med (jämförbar med avståndsfälten). */
  readonly gridCost: number;
  readonly cost: number;
  readonly climbUnits: number;
  readonly meters: number;
}

function searchGridFor(grid: Grid, pace: Float32Array, settings: ResolvedSettings): SearchGrid {
  return {
    width: grid.width, height: grid.height, cellMeters: grid.cellMeters, pace, contour: grid.contour,
    climbCostPerUnit: settings.contourIntervalMeters * settings.climbFactor / 4
  };
}

/** Närmaste passerbara cell inom `SNAP_METERS`, eller −1. */
function snap(grid: Grid, pace: Float32Array, at: Point): number {
  const { col, row } = cellOf(grid, at);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < grid.width && r < grid.height;
  if (inside(col, row) && pace[row * grid.width + col]! < Infinity) return row * grid.width + col;
  const reach = Math.ceil(SNAP_METERS / grid.cellMeters);
  let best = -1, bestDistance = Infinity;
  for (let dr = -reach; dr <= reach; dr += 1) {
    for (let dc = -reach; dc <= reach; dc += 1) {
      const c = col + dc, r = row + dr;
      if (!inside(c, r)) continue;
      const index = r * grid.width + c;
      if (!(pace[index]! < Infinity)) continue;
      const d = distance(cellCenter(grid, index), at);
      if (d < bestDistance && d <= SNAP_METERS * grid.cellMm / grid.cellMeters) {
        best = index; bestDistance = d;
      }
    }
  }
  return best;
}

function findRoute(searchGrid: SearchGrid, pace: Float32Array, start: number, goal: number, minPace: number, truePace: Float32Array): FoundRoute | null {
  const result = search(searchGrid, pace, start, { goal, minPace });
  if (!(result.cost[goal]! < Infinity)) return null;
  const cells = backtrack(result.parent, start, goal);
  if (cells.length === 0) return null;
  const corners = straighten(searchGrid, pace, cells);
  const measured = polylineCost(searchGrid, truePace, corners);
  return { corners, gridCost: result.cost[goal]!, cost: measured.cost, climbUnits: measured.climbUnits, meters: measured.meters };
}

function toLine(context: Context, route: FoundRoute, from: Point, to: Point): RouteLine {
  const { grid, settings } = context;
  const points = route.corners.map(index => cellCenter(grid, index));
  points[0] = from;
  points[points.length - 1] = to;
  const simplified = simplify(points, grid.cellMm / 2);
  const meters = polylineLength(simplified) / context.mmPerMeter;
  return {
    points: simplified,
    meters,
    climbMeters: route.climbUnits / 4 * settings.contourIntervalMeters,
    seconds: route.cost * settings.referencePaceSecondsPerKm / 1000
  };
}

/** Celler inom `radiusMm` från polylinjerna. */
function bufferMask(grid: Grid, lines: readonly (readonly Point[])[], radiusMm: number): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  for (const line of lines) strokeLine(grid, line, radiusMm, index => { mask[index] = 1; });
  return mask;
}

/** Andel av vägens längd som ligger inom bufferten. */
function sharedFraction(grid: Grid, points: readonly Point[], mask: Uint8Array): number {
  let shared = 0, total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!, b = points[index]!;
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / (grid.cellMm / 2)));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const { col, row } = cellOf(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const inside = col >= 0 && row >= 0 && col < grid.width && row < grid.height && mask[row * grid.width + col] === 1;
      total += length / steps;
      if (inside) shared += length / steps;
    }
  }
  return total > 0 ? shared / total : 1;
}

/** Farterna med snabba klasser (fortare än normal skog) ×(1+f) och långsamma ×(1−f), eller tvärtom. */
export function shiftedSpeeds(speeds: Readonly<Record<RunnableClass, number>>, factor: number): Record<RunnableClass, number> {
  const normal = speeds.NORMAL;
  const out = { ...speeds };
  for (const cls of RUNNABLE_CLASSES) {
    if (speeds[cls] > normal) out[cls] = speeds[cls] * (1 + factor);
    else if (speeds[cls] < normal) out[cls] = speeds[cls] * (1 - factor);
  }
  return out;
}

function corridorOf(grid: Grid, fieldA: Float64Array, fieldB: Float64Array, limit: number): LegAnalysis["corridor"] {
  let minCol = Infinity, maxCol = -1, minRow = Infinity, maxRow = -1;
  const w = grid.width;
  for (let index = 0; index < fieldA.length; index += 1) {
    if (fieldA[index]! + fieldB[index]! <= limit) {
      const col = index % w, row = (index - col) / w;
      if (col < minCol) minCol = col; if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) return undefined;
  const width = maxCol - minCol + 1, height = maxRow - minRow + 1;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = (row + minRow) * w + col + minCol;
      if (fieldA[index]! + fieldB[index]! <= limit) mask[row * width + col] = 1;
    }
  }
  return { origin: { x: grid.x0 + minCol * grid.cellMm, y: grid.yTop - minRow * grid.cellMm }, cellMm: grid.cellMm, width, height, mask };
}

/**
 * Analysen av en sträcka. `settings` ger farter, ekvidistans, stigningsfaktor och referensfart; klasserna per symbol
 * kommer ur kostnadsmodellen (bygg om den när tabellen ändras).
 */
export function analyseLeg(model: CostModel, leg: LegInput, settings?: RouteChoiceSettings | null): LegAnalysis {
  const started = performance.now();
  const prepared = preparedOf(model, settings);
  const resolved = settings ? resolveSettings({ ...settings, classBySymbol: {} }) : prepared.settings;
  const mmPerMeter = 1000 / prepared.scale;
  const straightMeters = distance(leg.from, leg.to) / mmPerMeter;
  const warnings: LegWarning[] = [];
  const finish = (rest: Omit<LegAnalysis, "key" | "straightMeters" | "warnings" | "milliseconds">): LegAnalysis =>
    ({ key: leg.key, straightMeters, ...rest, warnings, milliseconds: performance.now() - started });

  const frame = legFrame(leg.from, leg.to, prepared.scale);
  const grid = rasterize(prepared, frame, resolved.speedByClass);
  const pace = paceField(grid, resolved.speedByClass);
  const searchGrid = searchGridFor(grid, pace, resolved);
  const context: Context = { grid, searchGrid, settings: resolved, mmPerMeter };

  const ends: { end: "from" | "to"; at: Point; cell: number; point: Point }[] = [];
  for (const [end, at] of [["from", leg.from], ["to", leg.to]] as const) {
    const { col, row } = cellOf(grid, at);
    const direct = row * grid.width + col;
    const cell = snap(grid, pace, at);
    if (cell !== direct) warnings.push({ kind: "CONTROL_IN_IMPASSABLE", end });
    ends.push({ end, at, cell, point: cell === direct ? at : cell >= 0 ? cellCenter(grid, cell) : at });
  }
  const [a, b] = ends as [typeof ends[0], typeof ends[0]];
  if (a.cell < 0 || b.cell < 0) {
    warnings.push({ kind: "NO_ROUTE" });
    return finish({ best: undefined, alternatives: [], corridor: undefined, verdict: "NO_CHOICE" });
  }
  const minPace = minimumPace(pace);
  const best = findRoute(searchGrid, pace, a.cell, b.cell, minPace, pace);
  if (!best) {
    warnings.push({ kind: "NO_ROUTE" });
    return finish({ best: undefined, alternatives: [], corridor: undefined, verdict: "NO_CHOICE" });
  }
  const bestLine = toLine(context, best, a.point, b.point);

  // Två fält från ändarna, beskurna till celler som kan ligga på en väg högst 15 % sämre än bästa. Stråket är de
  // celler där summan är högst 5 % sämre; alternativen söks bland resten.
  const bound = best.gridCost * ALTERNATIVE_FACTOR + 1e-6;
  const fromA = search(searchGrid, pace, a.cell, { towards: b.cell, minPace, bound });
  const fromB = search(searchGrid, pace, b.cell, { towards: a.cell, minPace, bound });
  const corridor = corridorOf(grid, fromA.cost, fromB.cost, best.gridCost * CORRIDOR_FACTOR + 1e-6);
  const fields: Fields = { costA: fromA.cost, costB: fromB.cost, parentA: fromA.parent, parentB: fromB.parent };
  const alternatives = findAlternatives(context, best, bestLine, a, b, fields, minPace);

  for (const control of leg.otherControls ?? []) {
    if (distance(control.at, leg.from) < 0.01 || distance(control.at, leg.to) < 0.01) continue;
    if (distanceToPolyline(control.at, bestLine.points) <= CONTROL_RING_RADIUS_MM) warnings.push({ kind: "THROUGH_OTHER_CONTROL", code: control.code });
  }

  const switched = bestSwitches(context, resolved, best, alternatives.map(alt => alt.route), a, b);
  const verdict = switched ? "ABOUT_EQUAL" : alternatives.length > 0 ? "ROUTE_CHOICE" : "NO_CHOICE";
  return finish({
    best: bestLine,
    alternatives: alternatives.map(alt => ({ ...alt.line, timeRatio: alt.route.cost / best.cost })),
    corridor,
    verdict
  });
}

interface End { readonly cell: number; readonly point: Point }

interface Fields { readonly costA: Float64Array; readonly costB: Float64Array; readonly parentA: Int32Array; readonly parentB: Int32Array }

/** Vägen från a via cellen till b ur de två sökträden. */
function viaCells(fields: Fields, a: number, b: number, via: number): number[] {
  const first = backtrack(fields.parentA, a, via);
  const second = backtrack(fields.parentB, b, via);
  if (first.length === 0 || second.length === 0) return [];
  second.reverse();
  return [...first, ...second.slice(1)];
}

/** Rutnätsvägen uträtad på båda sidor om via-cellen (via-cellen ligger kvar som hörn). */
function straightenVia(searchGrid: SearchGrid, cells: readonly number[], position: number): number[] {
  const first = straighten(searchGrid, searchGrid.pace, cells.slice(0, position + 1));
  const second = straighten(searchGrid, searchGrid.pace, cells.slice(position));
  return [...first, ...second.slice(1)];
}

/**
 * Är vägen via `via` lokalt optimal? Delvägen ungefär `reach` celler före till `reach` celler efter via-cellen jämförs
 * med den bästa vägen mellan samma celler (T-testet), båda uträtade så att rutnätets många lika långa sicksackvägar
 * inte räknas som vägval. En krok ut i öppen skog klarar inte testet; en väg runt andra sidan av en sjö gör det.
 */
function locallyOptimal(searchGrid: SearchGrid, cells: readonly number[], position: number, reach: number, minPace: number): boolean {
  const w = searchGrid.width;
  const step = (i: number, j: number) => {
    const p = cells[i]!, q = cells[j]!;
    return Math.hypot((p % w) - (q % w), Math.floor(p / w) - Math.floor(q / w));
  };
  let before = position, length = 0;
  while (before > 0 && length < reach) { length += step(before - 1, before); before -= 1; }
  let after = position;
  length = 0;
  while (after < cells.length - 1 && length < reach) { length += step(after, after + 1); after += 1; }
  const u = cells[before]!, x = cells[after]!;
  const along = polylineCost(searchGrid, searchGrid.pace, straightenVia(searchGrid, cells.slice(before, after + 1), position - before)).cost;
  const result = search(searchGrid, searchGrid.pace, u, { goal: x, minPace });
  const shortestCells = backtrack(result.parent, u, x);
  if (shortestCells.length === 0) return true;
  const shortest = polylineCost(searchGrid, searchGrid.pace, straighten(searchGrid, searchGrid.pace, shortestCells)).cost;
  return along <= shortest * (1 + LOCAL_TOLERANCE) + 1e-6;
}

/** Hur mycket dyrare delvägen runt via-cellen får vara än den bästa vägen mellan samma celler. */
const LOCAL_TOLERANCE = 0.002;
/** Högst så många via-celler prövas per sträcka. */
const MAX_CANDIDATES = 12;

/**
 * Alternativen: via-celler i ordning efter kostnaden för vägen genom dem (summan av fälten), högst 15 % sämre än bästa.
 * En kandidat godtas om den är lokalt optimal och delar mindre än hälften med vägar som redan finns. Varje prövad väg
 * stänger sin omgivning för nästa kandidat.
 */
function findAlternatives(context: Context, best: FoundRoute, bestLine: RouteLine, a: End, b: End, fields: Fields, minPace: number) {
  const { grid, searchGrid, mmPerMeter } = context;
  const pace = searchGrid.pace;
  const straightMm = distance(a.point, b.point);
  const bufferMm = Math.max(2 * grid.cellMm, 10 * mmPerMeter, 0.05 * straightMm);
  const endClearMm = Math.max(bufferMm, 0.1 * straightMm);
  const limit = best.gridCost * ALTERNATIVE_FACTOR;
  const reach = Math.max(10 / grid.cellMeters, 0.25 * straightMm / grid.cellMm);
  const accepted: { route: FoundRoute; line: RouteLine }[] = [];
  const lines: (readonly Point[])[] = [bestLine.points];
  const closed = bufferMask(grid, [bestLine.points], bufferMm);
  for (const end of [a.point, b.point]) strokeLine(grid, [end], endClearMm, index => { closed[index] = 1; });
  const total = fields.costA.length;
  for (let attempt = 0; attempt < MAX_CANDIDATES && accepted.length < MAX_ALTERNATIVES; attempt += 1) {
    let via = -1, viaCost = Infinity;
    for (let index = 0; index < total; index += 1) {
      if (closed[index] === 1) continue;
      const cost = fields.costA[index]! + fields.costB[index]!;
      if (cost < viaCost) { viaCost = cost; via = index; }
    }
    if (via < 0 || viaCost > limit) break;
    const cells = viaCells(fields, a.cell, b.cell, via);
    if (cells.length === 0) { closed[via] = 1; continue; }
    const points = cells.map(index => cellCenter(grid, index));
    const position = cells.indexOf(via);
    const corners = straightenVia(searchGrid, cells, position);
    const measured = polylineCost(searchGrid, pace, corners);
    if (measured.cost <= best.cost * ALTERNATIVE_FACTOR && locallyOptimal(searchGrid, cells, position, reach, minPace)) {
      const route: FoundRoute = { corners, gridCost: viaCost, cost: measured.cost, climbUnits: measured.climbUnits, meters: measured.meters };
      const line = toLine(context, route, a.point, b.point);
      if (sharedFraction(grid, line.points, bufferMask(grid, lines, bufferMm)) < MAX_SHARED) {
        accepted.push({ route, line });
        lines.push(line.points);
      }
    }
    // Stäng omgivningen kring den prövade vägen, men bara där den lämnat tidigare vägar.
    strokeLine(grid, points, bufferMm, index => { closed[index] = 1; });
  }
  accepted.sort((x, y) => x.route.cost - y.route.cost);
  return accepted;
}

/** Byter bästa vägvalet plats när snabba och långsamma klasser ändras ±15 % mot varandra? */
function bestSwitches(context: Context, settings: ResolvedSettings, best: FoundRoute, alternatives: readonly FoundRoute[], a: End, b: End): boolean {
  const { grid, searchGrid, mmPerMeter } = context;
  const bestPoints = best.corners.map(index => cellCenter(grid, index));
  const bufferMm = Math.max(2 * grid.cellMm, 10 * mmPerMeter, 0.03 * distance(a.point, b.point));
  const bestMask = bufferMask(grid, [bestPoints], bufferMm);
  for (const sign of [1, -1]) {
    const speeds = shiftedSpeeds(settings.speedByClass, sign * UNCERTAINTY);
    const pace = paceField(grid, speeds);
    const shiftedGrid = { ...searchGrid, pace };
    const bestCost = polylineCost(shiftedGrid, pace, best.corners).cost;
    if (alternatives.some(alt => polylineCost(shiftedGrid, pace, alt.corners).cost < bestCost)) return true;
    const other = findRoute(shiftedGrid, pace, a.cell, b.cell, minimumPace(pace), pace);
    if (other && other.cost < bestCost * 0.995) {
      const points = other.corners.map(index => cellCenter(grid, index));
      if (sharedFraction(grid, points, bestMask) < MAX_SHARED) return true;
    }
  }
  return false;
}

/** Hela banan sträcka för sträcka; `onLeg` får varje svar så fort det är klart. */
export function analyseCourse(model: CostModel, legs: readonly LegInput[], settings?: RouteChoiceSettings | null,
  onLeg?: (analysis: LegAnalysis, index: number) => void): LegAnalysis[] {
  const out: LegAnalysis[] = [];
  legs.forEach((leg, index) => {
    const analysis = analyseLeg(model, leg, settings);
    out.push(analysis);
    onLeg?.(analysis, index);
  });
  return out;
}

/** Rutnätet för en sträcka (för bilder och felsökning). */
export function legGrid(model: CostModel, leg: Pick<LegInput, "from" | "to">, settings?: RouteChoiceSettings | null): Grid {
  const prepared = preparedOf(model, settings);
  const resolved = settings ? resolveSettings({ ...settings, classBySymbol: {} }) : prepared.settings;
  return rasterize(prepared, legFrame(leg.from, leg.to, prepared.scale), resolved.speedByClass);
}
