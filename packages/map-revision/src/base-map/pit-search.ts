import type { SourceFeature } from "../index";
import type { HeightGrid } from "./clear-contours";
import { isRing, ringTick } from "./depressions";
import type { PixelAffine } from "./flat-contours";
import { blend } from "./knoll-choice";
import { maskOutlines, simplifyRing } from "./photo-interpret";
import { extentOf, GENERALIZE, ISOM_RINGS, ringArea } from "./small-rings";

/**
 * Egen sökning efter sänkor (ägaren 2026-11-15, Grövelsjön). Geo-arbetaren letar små kullar men inga gropar, och Karttapullautin
 * hittar bara de sänkor som en nivå råkar korsa. Här fylls markens sänkor i höjdrastret (`hojd.png`) upp till sin tröskel, som
 * vatten skulle göra (Priority-Flood, Barnes m.fl. 2014): skillnaden mellan den fyllda ytan och marken är sänkans djup, oavsett
 * vilken nivå den ligger på. Varje sammanhängande sänka blir en kandidat med djup, yta och form, och valet bland dem görs med
 * reglage som för kullarna (`choosePits`): en liten sänka blir en gropsymbol (111), en större en ring av hjälpkurva efter formen
 * med lutningsstreck. Sänkor som grundkartan redan visar (en liten sluten kurva runt, eller Karttapullautins grop) tas inte med.
 *
 * Sjöar och mark utan laserdata saknar höjd i rastret och räknas som utlopp: en strandkant är ingen sänka. Rastret jämnas
 * först ut lätt (1–2–1 i båda led, två gånger), så att laserns brus inte blir gropar. Ren kod utan I/O.
 */
type Position = readonly [number, number];
export interface PitCandidate {
  /** Sänkans djupaste punkt. */
  readonly at: readonly [number, number];
  /** Djupet under tröskeln (m), ytan som ligger minst `PIT_LABEL_DEPTH` under tröskeln (m²) och formens längd och bredd (m). */
  readonly depth: number; readonly areaM2: number; readonly length: number; readonly width: number;
  /** Sänkans kant (en fjärdedel av djupet under tröskeln, minst 0,25 m), för de sänkor som kan bli en ring. */
  readonly ring?: readonly (readonly [number, number])[] | undefined;
}
/** Celler som ligger minst så djupt under tröskeln hör till sänkan; grundare kandidater än `PIT_MIN_DEPTH` sparas inte. */
export const PIT_LABEL_DEPTH = 0.2, PIT_MIN_DEPTH = 0.3;
/** En sänka får en kant sparad när den är minst så djup och ytan ligger mellan gränserna (m²). */
const RING_FROM_DEPTH = 0.6, RING_MIN_M2 = 40, RING_MAX_M2 = 6000;

/** Rastret lätt utjämnat (1–2–1 i båda led, två gånger); celler utan höjd står kvar utan höjd och väger inte in. */
export function smoothedHeights(grid: HeightGrid): Float32Array {
  const { columns, rows } = grid, first = new Float32Array(grid.meters.length), second = new Float32Array(grid.meters.length);
  /** En led: `count` celler per rad med `stride` emellan, `lines` rader med `lineStride` emellan. */
  const pass = (from: Float32Array, to: Float32Array, stride: number, count: number, lines: number, lineStride: number) => {
    for (let line = 0; line < lines; line += 1) {
      for (let i = 0; i < count; i += 1) {
        const at = line * lineStride + i * stride, here = from[at]!;
        if (here !== here) { to[at] = NaN; continue; }
        const before = i > 0 ? from[at - stride]! : NaN, after = i < count - 1 ? from[at + stride]! : NaN;
        let sum = 2 * here, weight = 2;
        if (before === before) { sum += before; weight += 1; }
        if (after === after) { sum += after; weight += 1; }
        to[at] = sum / weight;
      }
    }
  };
  pass(grid.meters, first, 1, columns, rows, columns); pass(first, second, columns, rows, columns, 1);
  pass(second, first, 1, columns, rows, columns); pass(first, second, columns, rows, columns, 1);
  return second;
}

/** Den fyllda ytan: varje cells höjd, eller tröskelns höjd för celler i en sluten sänka. Celler utan höjd är utlopp. */
function fillDepressions(z: Float32Array, columns: number, rows: number): Float32Array {
  const filled = new Float32Array(z.length), seen = new Uint8Array(z.length);
  // Högen håller cellerna och deras fyllda höjd sida vid sida, så att jämförelserna inte slår i hela rastret.
  let heap = new Int32Array(1 << 16), keys = new Float32Array(1 << 16), size = 0;
  const push = (cell: number, key: number) => {
    if (size === heap.length) {
      const cells = new Int32Array(heap.length * 2), levels = new Float32Array(heap.length * 2);
      cells.set(heap); levels.set(keys); heap = cells; keys = levels;
    }
    let i = size++;
    while (i > 0) { const parent = (i - 1) >> 1; if (keys[parent]! <= key) break; heap[i] = heap[parent]!; keys[i] = keys[parent]!; i = parent; }
    heap[i] = cell; keys[i] = key;
  };
  const pop = (): number => {
    const top = heap[0]!, last = heap[--size]!, key = keys[size]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && keys[child + 1]! < keys[child]!) child += 1;
      if (keys[child]! >= key) break;
      heap[i] = heap[child]!; keys[i] = keys[child]!; i = child;
    }
    heap[i] = last; keys[i] = key;
    return top;
  };
  // Utloppen: kartans kant och allt som gränsar till en cell utan höjd.
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const cell = row * columns + column, here = z[cell]!;
    if (here !== here) { seen[cell] = 1; filled[cell] = NaN; continue; }
    let edge = row === 0 || column === 0 || row === rows - 1 || column === columns - 1;
    for (let dr = -1; dr <= 1 && !edge; dr += 1) for (let dc = -1; dc <= 1 && !edge; dc += 1) {
      const other = z[cell + dr * columns + dc]!;
      if (other !== other) edge = true;
    }
    if (edge) { seen[cell] = 1; filled[cell] = here; push(cell, here); }
  }
  // Celler inne i en sänka (inte högre än cellen de nås från) tas i en vanlig kö före högen: de har redan sin fyllda höjd.
  const queue: number[] = [];
  let head = 0;
  while (size > 0 || head < queue.length) {
    let cell: number;
    if (head < queue.length) { cell = queue[head++]!; if (head === queue.length) { queue.length = 0; head = 0; } } else cell = pop();
    const level = filled[cell]!, row = Math.floor(cell / columns), column = cell - row * columns;
    for (let dr = -1; dr <= 1; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= rows) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = column + dc;
        if (c < 0 || c >= columns) continue;
        const next = r * columns + c;
        if (seen[next]) continue;
        seen[next] = 1;
        const height = z[next]!;
        if (height <= level) { filled[next] = level; queue.push(next); } else { filled[next] = height; push(next, height); }
      }
    }
  }
  return filled;
}

/** Ringen jämnad med hörnklippning (Chaikin), `rounds` gånger. */
export function chaikin(ring: readonly Position[], rounds: number): [number, number][] {
  let current = ring.map(([x, y]) => [x, y] as [number, number]);
  for (let round = 0; round < rounds; round += 1) {
    const next: [number, number][] = [];
    for (let i = 0; i < current.length; i += 1) {
      const [ax, ay] = current[i]!, [bx, by] = current[(i + 1) % current.length]!;
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    current = next;
  }
  return current;
}

/**
 * Alla slutna sänkor i höjdrastret som kandidater, djupast först. `affine` säger var rastret ligger (bildpunktens mitt till
 * koordinater, som `worldFileAffine`).
 */
export function findPits(grid: HeightGrid, affine: PixelAffine): PitCandidate[] {
  const { columns, rows } = grid;
  if (columns < 3 || rows < 3) return [];
  const z = smoothedHeights(grid), filled = fillDepressions(z, columns, rows);
  const [a, b, c, d, e, f] = affine, cellM2 = Math.abs(a * e - b * d), cellM = Math.sqrt(cellM2);
  const toSource = (column: number, row: number): [number, number] => [a * column + b * row + c, d * column + e * row + f];
  const depthAt = (cell: number) => filled[cell]! - z[cell]!;
  const taken = new Uint8Array(z.length), out: PitCandidate[] = [];
  for (let start = 0; start < z.length; start += 1) {
    if (taken[start] || !(filled[start]! - z[start]! >= PIT_LABEL_DEPTH)) continue;
    const cells = [start];
    const take = (next: number) => { if (!taken[next] && filled[next]! - z[next]! >= PIT_LABEL_DEPTH) { taken[next] = 1; cells.push(next); } };
    taken[start] = 1;
    let deepest = start, depth = 0, sumC = 0, sumR = 0, sumCC = 0, sumRR = 0, sumCR = 0;
    let minC = columns, maxC = 0, minR = rows, maxR = 0;
    for (let k = 0; k < cells.length; k += 1) {
      const cell = cells[k]!, row = Math.floor(cell / columns), column = cell - row * columns, here = depthAt(cell);
      if (here > depth) { depth = here; deepest = cell; }
      sumC += column; sumR += row; sumCC += column * column; sumRR += row * row; sumCR += column * row;
      if (column < minC) minC = column; if (column > maxC) maxC = column; if (row < minR) minR = row; if (row > maxR) maxR = row;
      if (column > 0) take(cell - 1);
      if (column < columns - 1) take(cell + 1);
      if (row > 0) take(cell - columns);
      if (row < rows - 1) take(cell + columns);
    }
    const count = cells.length, areaM2 = count * cellM2;
    if (depth < PIT_MIN_DEPTH || areaM2 < 4) continue;
    // Formens längd och bredd ur cellernas spridning (fyra standardavvikelser längs huvudaxlarna).
    const mc = sumC / count, mr = sumR / count, vcc = sumCC / count - mc * mc, vrr = sumRR / count - mr * mr, vcr = sumCR / count - mc * mr;
    const mean = (vcc + vrr) / 2, spread = Math.sqrt(Math.max(0, ((vcc - vrr) / 2) ** 2 + vcr * vcr));
    const length = 4 * Math.sqrt(Math.max(0.08, mean + spread)) * cellM, width = 4 * Math.sqrt(Math.max(0.08, mean - spread)) * cellM;
    const deepRow = Math.floor(deepest / columns), deepColumn = deepest - deepRow * columns;
    let ring: [number, number][] | undefined;
    if (depth >= RING_FROM_DEPTH && areaM2 >= RING_MIN_M2 && areaM2 <= RING_MAX_M2) {
      // Kanten: cellerna som ligger minst en fjärdedel av djupet (minst 0,25 m) under tröskeln och hänger ihop med botten.
      const limit = Math.max(0.25, depth / 4), width_ = maxC - minC + 3, height_ = maxR - minR + 3;
      const local = new Uint8Array(width_ * height_), at = (column: number, row: number) => (column - minC + 1) * height_ + (row - minR + 1);
      for (const cell of cells) if (depthAt(cell) >= limit) { const row = Math.floor(cell / columns); local[at(cell - row * columns, row)] = 1; }
      const part = new Uint8Array(local.length), stack = [at(deepColumn, deepRow)];
      part[stack[0]!] = 1;
      while (stack.length) {
        const here = stack.pop()!;
        for (const next of [here - 1, here + 1, here - height_, here + height_]) if (local[next] === 1 && !part[next]) { part[next] = 1; stack.push(next); }
      }
      const outline = maskOutlines(part, width_, height_).sort((p, q) => q.length - p.length)[0];
      if (outline && outline.length >= 8) {
        // Hörnens koordinater (kolumn, rad) ligger en halv cell före cellens mitt.
        const smooth = simplifyRing(chaikin(outline, 2), 0.2);
        ring = smooth.map(([column, row]) => { const [x, y] = toSource(column + minC - 1.5, row + minR - 1.5); return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; });
      }
    }
    const [x, y] = toSource(deepColumn, deepRow), round = (value: number) => Math.round(value * 100) / 100;
    out.push({ at: [round(x), round(y)], depth: round(depth), areaM2: Math.round(areaM2), length: round(length), width: round(width), ...(ring ? { ring } : {}) });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

export interface PitLimits {
  /** Minsta djup (m) för en gropsymbol och för en ring, och minsta avstånd (m) mellan två gropsymboler. */
  readonly minDepth: number; readonly ringDepth: number; readonly spacing: number;
}
/**
 * Förvalen, ställda mot kartan över Grövelsjön (2,1 km² dödisterräng, 2026-11-15): med 0,4 m blir det 133 gropsymboler per km²,
 * lika många som kartritarens (hittade i kartbilden), och var fjärde ligger inom 10 m från en av hennes (slumpen ger var
 * tjugofemte). Grundare än 0,4 m träffar sämre; djupare sänkor ritar hon oftare som ringar. 1 på skalan ger bara de djupaste med
 * gott om plats emellan, 10 allt som sökningen har sparat.
 */
export const DEFAULT_PIT_LIMITS: PitLimits = { minDepth: 0.4, ringDepth: 1, spacing: 15 };
const FEWEST_PITS: PitLimits = { minDepth: 1.2, ringDepth: 2, spacing: 40 }, MOST_PITS: PitLimits = { minDepth: PIT_MIN_DEPTH, ringDepth: RING_FROM_DEPTH, spacing: 10 };
export const DEFAULT_PIT_LEVEL = 5;
export const pitLimitsAt = (level: number): PitLimits => blend(DEFAULT_PIT_LIMITS, level < 5 ? FEWEST_PITS : MOST_PITS, level < 5 ? (5 - level) / 4 : (level - 5) / 5);

/** En gropsymbol visar en liten sänka: större ytor än så (m²) blir en ring eller ingenting. En ring ritas upp till `PIT_RING_MAX_M2`. */
export const PIT_POINT_MAX_M2 = 600, PIT_RING_MAX_M2 = 3000;
export const PIT_POINT_LAYER = "udepression_laser", PIT_RING_LAYER = "formline_grop", PIT_TICK_LAYER = "lutningsstreck_grop";
/** Sänksökningens egna lager i grundkartan (reglagen byter bara dem). */
export const PIT_LAYERS = /^(udepression_laser|formline_grop|lutningsstreck_grop)$/;
const SHOWN_RING = /^(contour|depression)(_index)?$|^formline$/i, SHOWN_PIT = /^udepression$/i;

function inside(ring: readonly Position[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export interface PitChoice { readonly points: [number, number][]; readonly rings: (readonly (readonly [number, number])[])[] }

/**
 * Valet bland kandidaterna, djupast först. En sänka som är minst `ringDepth` djup och vars kant rymmer normens minsta grop
 * (1,1 × 0,7 mm på kartan, med generaliseringens marginal) blir en ring; annars en gropsymbol när den är minst `minDepth` djup,
 * högst `PIT_POINT_MAX_M2` stor och inte ligger närmare en annan än `spacing`. `shown` är grundkartan som den ser ut: en sänka
 * med botten i en liten sluten kurva eller hjälpkurva, eller vid Karttapullautins grop, visas redan och tas inte med.
 */
export function choosePits(candidates: readonly PitCandidate[], limits: PitLimits, scale: number, shown: readonly SourceFeature[] = []): PitChoice {
  const mm = (value: number) => value * GENERALIZE * scale / 1000;
  const shownRings = shown.filter(feature => SHOWN_RING.test(feature.layer) && isRing(feature)).map(feature => {
    const points = (feature.geometry as { points: readonly Position[] }).points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { points, area: ringArea(points), minX, minY, maxX, maxY };
  });
  const shownPits = shown.filter(feature => feature.geometry.kind === "point" && SHOWN_PIT.test(feature.layer)).map(feature => (feature.geometry as { at: Position }).at);
  const reach = limits.spacing, cells = new Map<string, Position[]>();
  const near = (x: number, y: number, list: Map<string, Position[]>, within: number) => {
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach);
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      for (const [px, py] of list.get(`${cx + ax},${cy + ay}`) ?? []) if (Math.hypot(px - x, py - y) < within) return true;
    }
    return false;
  };
  const remember = (x: number, y: number, list: Map<string, Position[]>) => {
    const key = `${Math.floor(x / reach)},${Math.floor(y / reach)}`, row = list.get(key);
    if (row) row.push([x, y]); else list.set(key, [[x, y]]);
  };
  const karttapullautin = new Map<string, Position[]>();
  for (const [x, y] of shownPits) remember(x, y, karttapullautin);
  const points: [number, number][] = [], rings: (readonly (readonly [number, number])[])[] = [];
  for (const pit of [...candidates].sort((p, q) => q.depth - p.depth)) {
    const [x, y] = pit.at;
    if (pit.depth < Math.min(limits.minDepth, limits.ringDepth)) continue;
    // Redan visad: en sluten kurva runt botten som inte är mycket större än sänkan, eller Karttapullautins grop intill.
    if (shownRings.some(ring => x >= ring.minX && x <= ring.maxX && y >= ring.minY && y <= ring.maxY && ring.area <= 3 * Math.max(pit.areaM2, 100) && inside(ring.points, x, y))) continue;
    if (near(x, y, karttapullautin, Math.min(reach, 8))) continue;
    if (rings.some(ring => inside(ring, x, y))) continue;
    if (pit.ring && pit.depth >= limits.ringDepth) {
      const { length, width } = extentOf(pit.ring);
      if (length >= mm(ISOM_RINGS.depression[0]) && width >= mm(ISOM_RINGS.depression[1])) {
        if (ringArea(pit.ring) <= PIT_RING_MAX_M2) { rings.push(pit.ring); remember(x, y, cells); }
        continue;
      }
    }
    if (pit.depth < limits.minDepth || pit.areaM2 > PIT_POINT_MAX_M2 || near(x, y, cells, reach)) continue;
    points.push([x, y]); remember(x, y, cells);
  }
  return { points, rings };
}

/** Valet som grundkartans objekt: gropsymboler (111), ringar av hjälpkurva (103) och ringarnas lutningsstreck (101.1). */
export function pitFeatures(choice: PitChoice): SourceFeature[] {
  return [
    ...choice.rings.flatMap(ring => ringTick(ring, PIT_TICK_LAYER)),
    ...choice.rings.map((ring): SourceFeature => ({ layer: PIT_RING_LAYER, geometry: { kind: "line", closed: true, points: ring.map(([x, y]) => [x, y] as [number, number]) } })),
    ...choice.points.map((at): SourceFeature => ({ layer: PIT_POINT_LAYER, geometry: { kind: "point", at: [at[0], at[1]] } }))
  ];
}
