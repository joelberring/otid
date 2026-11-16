import { SYMBOL_SETS } from "@o-tid/map-file";
import { suggestSymbol, type ImportLayer } from "../index";
import type { HeightGrid } from "./clear-contours";
import type { PixelAffine } from "./flat-contours";

/**
 * Underlag för frihandsritning (Högdalens kartritare via ägaren 2026-11-16): «Jag ritar ändå allt från grunden … vill kunna
 * se kurvning i hög upplösning och objekt-/vegetationshöjd, framför allt för positionering». Här finns det som räknas ur
 * laserkörningens markhöjd (`hojd.png`): täta kurvor med valfri ekvidistans, markens småformer (höjd över närmaste
 * omgivning) och släntkanter (vägkanter, banvallar, dikeskanter). Allt i rutnätets bildpunkter; den som anropar räknar om
 * med `affine` till SWEREF 99 TM. Ren TypeScript utan I/O, samma i webbläsaren och i test.
 */

type Pixel = readonly [column: number, row: number];
export interface BasisLine { readonly points: readonly Pixel[]; readonly closed: boolean }
export interface LevelLine extends BasisLine { readonly level: number }

/** Bildpunktens storlek i meter (rutnätet är kvadratiskt i SWEREF 99 TM). */
export const cellMeters = (affine: PixelAffine) => Math.hypot(affine[0], affine[3]);
export const pixelToWorld = (affine: PixelAffine, [column, row]: Pixel): [number, number] =>
  [affine[0] * column + affine[1] * row + affine[2], affine[3] * column + affine[4] * row + affine[5]];

/**
 * Utjämning 1-2-1 åt båda håll, `passes` gånger, utan att låta saknad data (NaN) sprida sig: en cell utan data förblir utan,
 * och grannar utan data räknas inte. Ett pass tar bort laserns brus på 0,1–0,2 m utan att flytta formerna märkbart.
 */
export function smoothGrid(grid: HeightGrid, passes: number): HeightGrid {
  let values = grid.meters;
  const { columns, rows } = grid;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const along of [1, columns] as const) {
      const out = new Float32Array(values.length);
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column, z = values[index]!;
        if (z !== z) { out[index] = NaN; continue; }
        let sum = 2 * z, weight = 2;
        const hasBefore = along === 1 ? column > 0 : row > 0, hasAfter = along === 1 ? column < columns - 1 : row < rows - 1;
        if (hasBefore) { const v = values[index - along]!; if (v === v) { sum += v; weight += 1; } }
        if (hasAfter) { const v = values[index + along]!; if (v === v) { sum += v; weight += 1; } }
        out[index] = sum / weight;
      }
      values = out;
    }
  }
  return { columns, rows, meters: values };
}

/** Kurvornas klass: vilken av de grövre nivåerna (t.ex. hela metrar och var femte meter) en nivå också är. */
export function majorSteps(interval: number): readonly number[] {
  return interval < 1 ? [5, 1] : interval < 5 ? [5] : [25];
}
export function contourClass(level: number, interval: number): number {
  for (const step of majorSteps(interval)) if (Math.abs(level / step - Math.round(level / step)) < 1e-6) return step;
  return interval;
}

/**
 * Höjdkurvorna med ekvidistansen `interval` (m) ur rutnätet (marching squares mellan cellernas mittpunkter, linjär
 * interpolation). Celler där något hörn saknar data hoppas över, så kurvan slutar vid vatten, hus och kanten. Sadlar avgörs
 * av rutans medelvärde. Segmenten fogas till linjer per nivå; slutna ringar kortare än `minRingCells` (bildpunkter) tas bort,
 * de är laserns brus och inga former man ser i skogen.
 */
export function isolines(grid: HeightGrid, interval: number, options: { readonly minRingCells?: number } = {}): LevelLine[] {
  const { columns, rows, meters } = grid;
  if (!(interval > 0) || columns < 2 || rows < 2) return [];
  // Nivån flyttas en tusendels millimeter, så att inget hörn ligger exakt på den (ger inga dubbla eller tomma segment).
  const shift = 1e-6;
  // Segmenten per nivå som kantpar: kant = (rad · kolumner + kolumn) · 2 (+1 för den lodräta kanten nedåt).
  const buckets = new Map<number, number[]>();
  for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
    const i = row * columns + column;
    const tl = meters[i]!, tr = meters[i + 1]!, br = meters[i + columns + 1]!, bl = meters[i + columns]!;
    if (tl !== tl || tr !== tr || br !== br || bl !== bl) continue;
    const low = Math.min(tl, tr, br, bl), high = Math.max(tl, tr, br, bl);
    const first = Math.ceil((low - shift) / interval), last = Math.floor((high - shift) / interval);
    for (let step = first; step <= last; step += 1) {
      const level = step * interval + shift;
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Kanterna: överkant, högerkant, underkant, vänsterkant.
      const top = i * 2, right = (i + 1) * 2 + 1, bottom = (i + columns) * 2, left = i * 2 + 1;
      let pairs: number[];
      switch (code) {
        case 1: case 14: pairs = [left, bottom]; break;
        case 2: case 13: pairs = [bottom, right]; break;
        case 3: case 12: pairs = [left, right]; break;
        case 4: case 11: pairs = [top, right]; break;
        case 6: case 9: pairs = [top, bottom]; break;
        case 7: case 8: pairs = [left, top]; break;
        case 5: pairs = (tl + tr + br + bl) / 4 > level ? [left, top, bottom, right] : [left, bottom, top, right]; break;
        default: pairs = (tl + tr + br + bl) / 4 > level ? [top, right, left, bottom] : [top, left, bottom, right]; break;
      }
      let bucket = buckets.get(step);
      if (!bucket) { bucket = []; buckets.set(step, bucket); }
      for (const edge of pairs) bucket.push(edge);
    }
  }
  const edgePoint = (edge: number, level: number): Pixel => {
    const i = edge >> 1, row = Math.floor(i / columns), column = i - row * columns;
    const z0 = meters[i]!, z1 = edge & 1 ? meters[i + columns]! : meters[i + 1]!;
    const t = z1 === z0 ? 0.5 : Math.min(1, Math.max(0, (level - z0) / (z1 - z0)));
    return edge & 1 ? [column, row + t] : [column + t, row];
  };
  const minRing = options.minRingCells ?? 0;
  const lines: LevelLine[] = [];
  for (const step of [...buckets.keys()].sort((a, b) => a - b)) {
    const edges = buckets.get(step)!, level = step * interval, count = edges.length / 2;
    // Varje kant delas av högst två segment på samma nivå.
    const at = new Map<number, number[]>();
    for (let s = 0; s < count; s += 1) for (const edge of [edges[s * 2]!, edges[s * 2 + 1]!]) {
      const list = at.get(edge); if (list) list.push(s); else at.set(edge, [s]);
    }
    const used = new Uint8Array(count);
    const other = (s: number, edge: number) => edges[s * 2] === edge ? edges[s * 2 + 1]! : edges[s * 2]!;
    const next = (edge: number, from: number) => at.get(edge)!.find(s => s !== from && !used[s]);
    const walk = (s: number, edge: number): number[] => {
      const chain: number[] = [];
      let current: number | undefined = s, through = edge;
      while (current !== undefined) {
        used[current] = 1;
        const out = other(current, through);
        chain.push(out);
        through = out;
        current = next(out, current);
      }
      return chain;
    };
    for (let s = 0; s < count; s += 1) {
      if (used[s]) continue;
      const a = edges[s * 2]!, b = edges[s * 2 + 1]!;
      used[s] = 1;
      const forward = (() => { const n = next(b, s); return n === undefined ? [] : walk(n, b); })();
      const closed = forward.length > 0 && forward[forward.length - 1] === a;
      const backward = closed ? [] : (() => { const n = next(a, s); return n === undefined ? [] : walk(n, a); })();
      const chain = [...backward.reverse(), a, b, ...(closed ? forward.slice(0, -1) : forward)];
      if (closed && chain.length < minRing) continue;
      lines.push({ level: Math.round(level * 1000) / 1000, closed, points: chain.map(edge => edgePoint(edge, level + shift)) });
    }
  }
  return lines;
}

/** Douglas–Peucker med toleransen i bildpunkter. Ringar behåller start och slut. */
export function simplifyLine(points: readonly Pixel[], tolerance: number): Pixel[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const [x0, y0] = points[from]!, [x1, y1] = points[to]!, dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy);
    let worst = -1, farthest = 0;
    for (let k = from + 1; k < to; k += 1) {
      const [x, y] = points[k]!;
      const distance = length === 0 ? Math.hypot(x - x0, y - y0) : Math.abs(dy * (x - x0) - dx * (y - y0)) / length;
      if (distance > farthest) { farthest = distance; worst = k; }
    }
    if (worst > 0 && farthest > tolerance) { keep[worst] = 1; stack.push([from, worst], [worst, to]); }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * Markens småformer: höjden över medelhöjden inom `radiusCells` (summatabell, saknad data räknas inte). Stenar som lasern
 * klassat som mark, gropar, diken, vägbankar och kanter syns som plus och minus på 0,2–2 m, också där kurvorna inte visar
 * dem. NaN där data saknas.
 */
export function localRelief(grid: HeightGrid, radiusCells: number): Float32Array {
  const { columns, rows, meters } = grid, width = columns + 1;
  const sum = new Float64Array(width * (rows + 1)), count = new Float64Array(width * (rows + 1));
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const z = meters[row * columns + column]!, i = (row + 1) * width + column + 1;
    sum[i] = (z === z ? z : 0) + sum[i - 1]! + sum[i - width]! - sum[i - width - 1]!;
    count[i] = (z === z ? 1 : 0) + count[i - 1]! + count[i - width]! - count[i - width - 1]!;
  }
  const out = new Float32Array(columns * rows).fill(NaN);
  const r = Math.max(1, Math.round(radiusCells));
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const z = meters[row * columns + column]!;
    if (z !== z) continue;
    const c0 = Math.max(0, column - r), c1 = Math.min(columns, column + r + 1), r0 = Math.max(0, row - r), r1 = Math.min(rows, row + r + 1);
    const box = (table: Float64Array) => table[r1 * width + c1]! - table[r0 * width + c1]! - table[r1 * width + c0]! + table[r0 * width + c0]!;
    const n = box(count);
    if (n >= 4) out[row * columns + column] = z - box(sum) / n;
  }
  return out;
}

export interface BankSettings {
  /** Minsta lutning i kanten (grader). */
  readonly minDegrees: number;
  /** Största lutning (andel av kantens) på båda sidor om kanten, `reach` m bort längs lutningen. */
  readonly sideShare: number;
  /** Hur långt bort sidorna mäts (m). */
  readonly reach: number;
  /** Kantens höjd (m) mellan sidorna: lägsta och högsta. */
  readonly minStep: number;
  readonly maxStep: number;
  /** Kortaste linjen (m). */
  readonly minLength: number;
}
/**
 * Förvalen: en kant på 0,3–4 m med minst 20° lutning, flackare mark (högst halva lutningen) 1,5–4 m åt båda håll och minst
 * 12 m lång. Provat på Högdalen A (2,6 km², 2026-11-16): banvallar och vägbankar kommer med, men också en del korta
 * berg- och jordkanter i skogen; med 8 m och 25° blev bara 5 km kvar och banvallen bröts upp. Inte mätt mot kartan.
 */
export const DEFAULT_BANKS: BankSettings = { minDegrees: 20, sideShare: 0.5, reach: 2.5, minStep: 0.3, maxStep: 4, minLength: 12 };
/** Sidorna mäts på `reach` gånger de här talen. */
const REACH_FACTORS = [0.6, 1, 1.6] as const;

/**
 * Släntkanter: smala branta band mellan flackare mark, dvs vägkanter, banvallar, dikeskanter och terrasskanter, men inte en
 * jämnt brant sluttning (där är sidorna lika branta) och inte en brant (högre än `maxStep`). Bandet tunnas till en mittlinje
 * (Zhang–Suen) och följs till linjer, riktade så att den lägre sidan ligger till höger (som branternas streck).
 */
export function bankLines(grid: HeightGrid, cell: number, settings: BankSettings = DEFAULT_BANKS): BasisLine[] {
  const { columns, rows } = grid, z = smoothGrid(grid, 1).meters;
  const at = (column: number, row: number) => column < 0 || row < 0 || column >= columns || row >= rows ? NaN : z[row * columns + column]!;
  const gradient = (column: number, row: number): [number, number] =>
    [(at(column + 1, row) - at(column - 1, row)) / (2 * cell), (at(column, row + 1) - at(column, row - 1)) / (2 * cell)];
  const minSlope = Math.tan(settings.minDegrees * Math.PI / 180), reach = settings.reach / cell;
  const mask = new Uint8Array(columns * rows);
  for (let row = 1; row < rows - 1; row += 1) for (let column = 1; column < columns - 1; column += 1) {
    const [gx, gy] = gradient(column, row), slope = Math.hypot(gx, gy);
    if (!(slope >= minSlope)) continue;
    const ux = gx / slope, uy = gy / slope;
    const side = (sign: number) => {
      const c = Math.round(column + sign * ux * reach), r = Math.round(row + sign * uy * reach);
      const [sx, sy] = gradient(c, r);
      return { slope: Math.hypot(sx, sy), z: at(c, r) };
    };
    // Kantens bredd varierar (en dikeskant 1 m, en banvall 3–4 m): den räcker om något av avstånden ger flack mark på båda sidor.
    for (const factor of REACH_FACTORS) {
      const up = side(factor), down = side(-factor);
      if (!(up.slope <= slope * settings.sideShare && down.slope <= slope * settings.sideShare)) continue;
      const step = up.z - down.z;
      if (step >= settings.minStep && step <= settings.maxStep) { mask[row * columns + column] = 1; break; }
    }
  }
  thin(mask, columns, rows);
  const lines: BasisLine[] = [];
  for (const path of tracePaths(mask, columns, rows)) {
    if ((path.length - 1) * cell < settings.minLength) continue;
    // Den lägre sidan till höger: rader växer söderut, så höger om (dx, dy) i bilden är (−dy, dx).
    let right = 0;
    for (let k = 1; k < path.length; k += 1) {
      const [c0, r0] = path[k - 1]!, [c1, r1] = path[k]!, [gx, gy] = gradient(c0, r0);
      if (gx === gx && gy === gy) right += -(r1 - r0) * gx + (c1 - c0) * gy;
    }
    const ordered = right > 0 ? path.reverse() : path;
    lines.push({ closed: false, points: simplifyLine(ordered, 0.6) });
  }
  return lines;
}

/** Zhang–Suens tunning på plats: masken blir en cell bred. */
function thin(mask: Uint8Array, columns: number, rows: number): void {
  const at = (c: number, r: number) => c < 0 || r < 0 || c >= columns || r >= rows ? 0 : mask[r * columns + c]!;
  let changed = true;
  const remove: number[] = [];
  while (changed) {
    changed = false;
    for (const phase of [0, 1]) {
      remove.length = 0;
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) {
        if (!mask[r * columns + c]) continue;
        const p = [at(c, r - 1), at(c + 1, r - 1), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1), at(c - 1, r + 1), at(c - 1, r), at(c - 1, r - 1)];
        const neighbours = p.reduce((sum, v) => sum + v, 0);
        if (neighbours < 2 || neighbours > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k += 1) if (!p[k] && p[(k + 1) % 8]) transitions += 1;
        if (transitions !== 1) continue;
        if (phase === 0 ? p[0]! * p[2]! * p[4]! || p[2]! * p[4]! * p[6]! : p[0]! * p[2]! * p[6]! || p[0]! * p[4]! * p[6]!) continue;
        remove.push(r * columns + c);
      }
      for (const index of remove) mask[index] = 0;
      if (remove.length) changed = true;
    }
  }
}

/** Mittlinjens celler som linjer: från ändpunkterna först, sedan det som är kvar (ringar). */
function tracePaths(mask: Uint8Array, columns: number, rows: number): Pixel[][] {
  const seen = new Uint8Array(mask.length);
  const around = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
  const neighbours = (c: number, r: number) => around.map(([dc, dr]) => [c + dc, r + dr] as const)
    .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < columns && nr < rows && mask[nr * columns + nc]);
  const follow = (c: number, r: number): Pixel[] => {
    const path: Pixel[] = [[c, r]];
    seen[r * columns + c] = 1;
    for (;;) {
      const [lc, lr] = path[path.length - 1]!;
      const step = neighbours(lc, lr).find(([nc, nr]) => !seen[nr * columns + nc]);
      if (!step) return path;
      seen[step[1] * columns + step[0]] = 1;
      path.push(step);
    }
  };
  const paths: Pixel[][] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) {
    if (mask[r * columns + c] && !seen[r * columns + c] && neighbours(c, r).length === 1) paths.push(follow(c, r));
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) {
    if (mask[r * columns + c] && !seen[r * columns + c]) paths.push(follow(c, r));
  }
  return paths;
}

/** Färg ur en trappa: värdet → den första gränsens färg som värdet är under. */
export type ColorStep = readonly [below: number, rgb: readonly [number, number, number]];

/**
 * Vegetationens höjd över mark (m) i skikt, ljusa toner att rita ovanpå: under 0,5 m ingen färg (mark, hällar, ris),
 * 0,5–2 m buskar och sly (gult), 2–5 m ungskog (grönt, starkast), 5–10 m ljusare och den höga skogen nästan vit. Det låga
 * och unga är det som avgör löpbarheten och syns i skogen; med mörkast grönt för den höga skogen blev fältutskriften av
 * Högdalen A grön över allt (provat 2026-11-16).
 */
export const VEGETATION_STEPS: readonly ColorStep[] = [
  [0.5, [255, 255, 255]], [2, [250, 214, 120]], [5, [120, 200, 120]], [10, [170, 222, 165]], [20, [212, 238, 208]], [Infinity, [232, 245, 230]]
];
export function stepColor(steps: readonly ColorStep[], value: number): readonly [number, number, number] {
  for (const [below, rgb] of steps) if (value < below) return rgb;
  return steps[steps.length - 1]![1];
}

/** Småformernas färg: upphöjt brunt, nedsänkt blått, mättat vid ±`full` m och vitt kring noll. */
export function reliefColor(value: number, full = 0.6): readonly [number, number, number] {
  const t = Math.max(-1, Math.min(1, value / full));
  const mix = (to: readonly [number, number, number], share: number) => to.map(channel => Math.round(255 + (channel - 255) * share)) as unknown as [number, number, number];
  return t >= 0 ? mix([150, 75, 20], t) : mix([20, 90, 200], -t);
}

/** DXF R12-lagrets namn: bara A–Z, 0–9 och understreck, högst 31 tecken. */
export function dxfLayerName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 31) || "lager";
}

export interface GridPart { readonly grid: HeightGrid; readonly affine: PixelAffine }
/**
 * Etappernas rutnät som ett: samma cellstorlek, axelparallella (som laserkörningens bilder). Där två etapper överlappar
 * gäller den första som har data. Inget svar utan delar eller om de inte går att lägga ihop.
 */
export function mosaicGrids(parts: readonly GridPart[]): GridPart | undefined {
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  const cell = parts[0]!.affine[0];
  if (parts.some(({ affine: [a, b, , d, e] }) => b !== 0 || d !== 0 || Math.abs(a - cell) > 1e-6 || Math.abs(e + cell) > 1e-6)) return undefined;
  const minX = Math.min(...parts.map(({ affine }) => affine[2])), maxY = Math.max(...parts.map(({ affine }) => affine[5]));
  const maxX = Math.max(...parts.map(({ grid, affine }) => affine[2] + cell * (grid.columns - 1)));
  const minY = Math.min(...parts.map(({ grid, affine }) => affine[5] - cell * (grid.rows - 1)));
  const columns = Math.round((maxX - minX) / cell) + 1, rows = Math.round((maxY - minY) / cell) + 1;
  const meters = new Float32Array(columns * rows).fill(NaN);
  for (const { grid, affine } of parts) {
    const dc = Math.round((affine[2] - minX) / cell), dr = Math.round((maxY - affine[5]) / cell);
    for (let row = 0; row < grid.rows; row += 1) for (let column = 0; column < grid.columns; column += 1) {
      const z = grid.meters[row * grid.columns + column]!, target = (row + dr) * columns + column + dc;
      if (z === z && meters[target] !== meters[target]) meters[target] = z;
    }
  }
  return { grid: { columns, rows, meters }, affine: [cell, 0, minX, 0, -cell, maxY] };
}

/** ISOM 2017-2:s symboler som importens förslag läser dem (id = numret). */
const ISOM = SYMBOL_SETS["ISOM2017-2"].symbols.filter(symbol => symbol.kind !== "text").map(symbol => ({ id: symbol.code, code: symbol.code, kind: symbol.kind, name: symbol.name }));
/**
 * Lagrets namn i exporten: ISOM-numret och namnet när lagernamnet säger vilken symbol det är (samma förslag som importen
 * gör, t.ex. Karttapullautins `contour` → `101_Hojdkurva`), annars filens namn och lagret.
 */
export function basisLayerName(layer: ImportLayer, file: string): string {
  const code = suggestSymbol(layer, ISOM);
  const symbol = code ? ISOM.find(row => row.id === code) : undefined;
  return dxfLayerName(symbol ? `${symbol.code} ${symbol.name}` : `${file.replace(/\.[a-z]+$/i, "")} ${layer.name}`);
}

/**
 * Terrängskuggning i gråskala (0–255, vitt där data saknas), ljuset från `azimuths` (grader medurs från norr) 45° över
 * horisonten. Flera riktningar läggs ihop (medel): diken och vägkanter som löper i ljusets riktning syns då ändå.
 * `exaggerate` förstärker lutningen, så att låga former syns på flack mark.
 */
export function hillshade(grid: HeightGrid, cell: number, azimuths: readonly number[] = [315], exaggerate = 2): Uint8Array {
  const { columns, rows, meters } = grid, out = new Uint8Array(columns * rows).fill(255);
  const lights = azimuths.map(degrees => { const a = degrees * Math.PI / 180; return [Math.sin(a) * Math.SQRT1_2, Math.cos(a) * Math.SQRT1_2, Math.SQRT1_2] as const; });
  const at = (column: number, row: number, fallback: number) => {
    if (column < 0 || row < 0 || column >= columns || row >= rows) return fallback;
    const z = meters[row * columns + column]!;
    return z === z ? z : fallback;
  };
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const z = meters[row * columns + column]!;
    if (z !== z) continue;
    // Österut och norrut i terrängen (raderna växer söderut).
    const dx = exaggerate * (at(column + 1, row, z) - at(column - 1, row, z)) / (2 * cell);
    const dy = exaggerate * (at(column, row - 1, z) - at(column, row + 1, z)) / (2 * cell);
    const length = Math.hypot(dx, dy, 1);
    let lit = 0;
    for (const [lx, ly, lz] of lights) lit += Math.max(0, (-dx * lx - dy * ly + lz) / length);
    out[row * columns + column] = Math.round(255 * Math.min(1, 0.85 * lit / lights.length / Math.SQRT1_2));
  }
  return out;
}

/** RGB (3 byte per bildpunkt) ur värden och en färgregel; NaN blir vitt. */
export function rgbOf(values: ArrayLike<number>, color: (value: number) => readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(values.length * 3).fill(255);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    if (value !== value) continue;
    const [r, g, b] = color(value);
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
  }
  return out;
}
