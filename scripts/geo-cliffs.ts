/**
 * Grundkartan ur laser, G4 (ägaren 2026-11-10: «brantsymboler av olika typ vända åt rätt håll»). Karttapullautin ger branterna
 * som tusentals korta streck (2,94 m): varje streck ligger längs brantkanten mitt emellan en hög och en låg punkt, och den
 * låga sidan är till vänster om streckets riktning (`cliffs.rs`). Här blir strecken linjer:
 *
 * 1. strecken ritas i ett raster (1 m) och sluts (en cell), så att strecken längs samma brant hänger ihop,
 * 2. ytan tunnas till en mittlinje (Zhang–Suen),
 * 3. mittlinjen följs: den längsta vägen i varje del först, sedan grenarna som är långa nog,
 * 4. varje linje förenklas och vänds så att nedför är till höger om ritriktningen (där brantsymbolens taggar ritas).
 *
 * Opasserbara branter (Karttapullautins `c3g`) blir lagret `brant_opasserbar` (201), passerbara (`c2g`) `brant_passerbar`
 * (202); streck i `c2g` som ligger där det redan är opasserbart tas inte med två gånger.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { encodePng, moistureDxf, simplify } from "./geo-moisture.ts";

export type Tick = readonly [x1: number, y1: number, x2: number, y2: number];
export interface CliffSettings {
  /** Kortare branter (m) tas inte med. */
  readonly minLengthM: number;
}
export const DEFAULT_CLIFFS: CliffSettings = { minLengthM: 6 };
const CELL = 1;

/** Strecken ur Karttapullautins DXF (POLYLINE med två VERTEX). */
export function readTicks(dxf: string): Tick[] {
  const lines = dxf.split(/\r?\n/), ticks: Tick[] = [];
  let points: number[] = [], inVertex = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim(), value = lines[i + 1]!.trim();
    if (code === "0") {
      if (value === "SEQEND") { if (points.length >= 4) ticks.push([points[0]!, points[1]!, points[points.length - 2]!, points[points.length - 1]!]); points = []; }
      inVertex = value === "VERTEX";
    } else if (inVertex && (code === "10" || code === "20")) points.push(Number(value));
  }
  return ticks.filter(tick => tick.every(Number.isFinite));
}

interface Raster { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number; readonly mask: Uint8Array;
  /** Streckens summerade riktning per cell. */
  readonly dx: Float32Array; readonly dy: Float32Array }

function rasterize(ticks: readonly Tick[]): Raster | undefined {
  if (ticks.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of ticks) { minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2); minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2); }
  minX = Math.floor(minX) - 3; minY = Math.floor(minY) - 3;
  const width = Math.ceil(maxX - minX) + 4, height = Math.ceil(maxY - minY) + 4;
  if (width * height > 80_000_000) throw new Error("Området är för stort för branterna");
  const mask = new Uint8Array(width * height), dx = new Float32Array(width * height), dy = new Float32Array(width * height);
  for (const [x1, y1, x2, y2] of ticks) {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / length, uy = (y2 - y1) / length;
    for (let step = 0; step <= length; step += 0.5) {
      const i = Math.floor((x1 + ux * step - minX) / CELL) * height + Math.floor((y1 + uy * step - minY) / CELL);
      mask[i] = 1; dx[i] = dx[i]! + ux; dy[i] = dy[i]! + uy;
    }
  }
  return { minX, minY, width, height, mask, dx, dy };
}

/** Slutning med en cell: luckor på en cell mellan streck fylls. */
function close(mask: Uint8Array, width: number, height: number): Uint8Array {
  const grown = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    const i = x * height + y;
    if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - height] || mask[i + height]) grown[i] = 1;
  }
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    const i = x * height + y;
    if (grown[i] && grown[i - 1] && grown[i + 1] && grown[i - height] && grown[i + height]) out[i] = 1;
    else if (mask[i]) out[i] = 1;
  }
  return out;
}

/** Zhang–Suens tunning: ytan blir en mittlinje som är en cell bred. Bara cellerna i masken gås igenom. */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  let active: number[] = [];
  for (let i = 0; i < out.length; i += 1) if (out[i]) active.push(i);
  // Grannarna P2…P9 medurs från norr (y uppåt): N, NO, O, SO, S, SV, V, NV.
  const offsets = [1, height + 1, height, height - 1, -1, -height - 1, -height, -height + 1];
  const at = (i: number) => (i >= 0 && i < out.length ? out[i]! : 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove: number[] = [];
      for (const i of active) {
        const x = Math.floor(i / height), y = i - x * height;
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
        const p = offsets.map(offset => at(i + offset));
        const count = p.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k += 1) if (!p[k] && p[(k + 1) % 8]) transitions += 1;
        if (transitions !== 1) continue;
        const [n, , e, , s, , w] = p;
        if (pass === 0 ? (n! * e! * s! === 0 && e! * s! * w! === 0) : (n! * e! * w! === 0 && n! * s! * w! === 0)) remove.push(i);
      }
      if (remove.length) { changed = true; for (const i of remove) out[i] = 0; active = active.filter(i => out[i]); }
    }
  }
  return out;
}

/** Mittlinjens vägar: i varje sammanhängande del den längsta vägen först, sedan det som blir kvar, så länge delarna är långa nog. */
function paths(skeleton: Uint8Array, width: number, height: number, minCells: number): number[][] {
  const left = new Uint8Array(skeleton), out: number[][] = [];
  const neighbours = (i: number) => {
    const x = Math.floor(i / height), y = i - x * height, list: number[] = [];
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      if ((ax || ay) && x + ax >= 0 && y + ay >= 0 && x + ax < width && y + ay < height && left[(x + ax) * height + y + ay]) list.push((x + ax) * height + y + ay);
    }
    return list;
  };
  /** Bredden först från `start`: den avlägsnaste cellen och vägen dit. */
  const farthest = (start: number) => {
    const from = new Map<number, number>([[start, -1]]);
    let queue = [start], last = start;
    while (queue.length) {
      const next: number[] = [];
      for (const i of queue) { last = i; for (const n of neighbours(i)) if (!from.has(n)) { from.set(n, i); next.push(n); } }
      queue = next;
    }
    const path: number[] = [];
    for (let i = last; i >= 0; i = from.get(i)!) path.push(i);
    return { end: last, path, seen: from };
  };
  for (let start = 0; start < left.length; start += 1) {
    while (left[start]) {
      const first = farthest(start), longest = farthest(first.end);
      if (longest.path.length < minCells) { for (const i of longest.seen.keys()) left[i] = 0; break; }
      out.push(longest.path);
      // Vägen och cellerna intill den tas bort, så att grenarna blir egna delar utan att följa vägen en gång till.
      for (const i of longest.path) { left[i] = 0; }
      for (const i of longest.path) for (const n of neighbours(i)) if (neighbours(n).length <= 1) left[n] = 0;
    }
  }
  return out;
}

/** Branternas linjer ur strecken, riktade så att nedför är till höger. */
export function cliffLines(ticks: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS): [number, number][][] {
  const raster = rasterize(ticks);
  if (!raster) return [];
  const { minX, minY, width, height, dx, dy } = raster;
  const skeleton = thin(close(raster.mask, width, height), width, height);
  const lines: [number, number][][] = [];
  for (const path of paths(skeleton, width, height, Math.max(3, Math.round(settings.minLengthM / CELL / Math.SQRT2)))) {
    const points = path.map((i): [number, number] => { const x = Math.floor(i / height), y = i - x * height; return [minX + (x + 0.5) * CELL, minY + (y + 0.5) * CELL]; });
    let length = 0, along = 0;
    for (let k = 1; k < points.length; k += 1) {
      const tx = points[k]![0] - points[k - 1]![0], ty = points[k]![1] - points[k - 1]![1];
      length += Math.hypot(tx, ty);
      // Streckens riktning i cellen och grannarna (mittlinjen ligger inte alltid i en cell som ett streck gick genom).
      const x = Math.floor(path[k]! / height), y = path[k]! - x * height;
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
        const i = (x + ax) * height + y + ay;
        if (i >= 0 && i < dx.length) along += tx * dx[i]! + ty * dy[i]!;
      }
    }
    if (length < settings.minLengthM) continue;
    // Strecken har nedför till vänster: en linje som går med strecken vänds, så att nedför hamnar till höger.
    const line = simplify(along > 0 ? points.reverse() : points, 1.1);
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/** Markens höjd i 1 m-celler från `lasclip` (cellen (x, y) täcker minX + x … +1, y uppåt; index x·height + y; NaN = ingen markpunkt). */
export interface GroundGrid { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number; readonly z: Float32Array }

export function readGroundGrid(bytes: Uint8Array): GroundGrid {
  if (bytes.length < 40) throw new Error("Markrastret är för kort");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  if (!(width > 0 && height > 0) || bytes.length !== 40 + width * height * 4) throw new Error("Markrastret har fel storlek");
  const z = new Float32Array(width * height);
  for (let i = 0; i < z.length; i += 1) z[i] = view.getFloat32(40 + i * 4, true);
  return { minX: view.getFloat64(0, true), minY: view.getFloat64(8, true), cell: view.getFloat64(16, true), width, height, z };
}

/** Rutornas raster över samma klippta område: medel där flera rutor har mark, och luckor fyllda från grannarna (högst `rounds` celler bort). */
export function mergeGroundGrids(grids: readonly GroundGrid[], rounds = 4): GroundGrid {
  const first = grids[0];
  if (!first) throw new Error("Inget markraster");
  const { width, height } = first, sum = new Float64Array(width * height), count = new Uint16Array(width * height);
  for (const grid of grids) {
    if (grid.width !== width || grid.height !== height) throw new Error("Markrastren täcker olika områden");
    for (let i = 0; i < sum.length; i += 1) if (Number.isFinite(grid.z[i]!)) { sum[i] = sum[i]! + grid.z[i]!; count[i] = count[i]! + 1; }
  }
  let z = Float32Array.from(sum, (value, i) => count[i] ? value / count[i] : NaN);
  for (let round = 0; round < rounds; round += 1) {
    const next = new Float32Array(z);
    let filled = 0;
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
      const i = x * height + y;
      if (Number.isFinite(z[i]!)) continue;
      let total = 0, n = 0;
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
        const nx = x + ax, ny = y + ay;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const value = z[nx * height + ny]!;
        if (Number.isFinite(value)) { total += value; n += 1; }
      }
      if (n >= 2) { next[i] = total / n; filled += 1; }
    }
    z = next;
    if (!filled) break;
  }
  return { ...first, z };
}

const heightAt = (grid: GroundGrid, x: number, y: number) => {
  const column = Math.floor((x - grid.minX) / grid.cell), row = Math.floor((y - grid.minY) / grid.cell);
  return column < 0 || row < 0 || column >= grid.width || row >= grid.height ? NaN : grid.z[column * grid.height + row]!;
};
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : NaN;

export interface CliffRules {
  /** Minsta fall (m) över ±3 m för att linjen ska vara en brant alls. */
  readonly minDrop: number;
  /** Opasserbar: minst så stort fall över ±3 m och över ±6 m, och minst så lång (m). */
  readonly impassableDrop3: number; readonly impassableDrop6: number; readonly impassableLength: number;
}
/** Trösklarna ur Kungshatt-kedjans brantkontroll (`s3c_brantkontroll.py`). */
export const DEFAULT_CLIFF_RULES: CliffRules = { minDrop: 1.3, impassableDrop3: 2.4, impassableDrop6: 3, impassableLength: 10 };

/**
 * Brantens fall mätt i markrastret (ägaren 2026-11-10, som i Kungshatt-kedjan): varje meter längs linjen jämförs marken
 * 3 m (och 6 m) uppför med marken lika långt nedför (linjen har nedför till höger). Medianen avgör: ingen brant, brant
 * (202) eller opasserbar brant (201). Utan mätvärden (linjen ligger utanför rastret) behåller linjen sin sort.
 */
export function measureCliff(line: readonly (readonly [number, number])[], ground: GroundGrid): { drop3: number; drop6: number; length: number } {
  const drops3: number[] = [], drops6: number[] = [];
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!, segment = Math.hypot(bx - ax, by - ay);
    if (segment === 0) continue;
    const rx = (by - ay) / segment, ry = -(bx - ax) / segment;
    for (let step = 0.5; step < segment; step += 1) {
      const x = ax + (bx - ax) * step / segment, y = ay + (by - ay) * step / segment;
      for (const [reach, into] of [[3, drops3], [6, drops6]] as const) {
        const up = heightAt(ground, x - rx * reach, y - ry * reach), down = heightAt(ground, x + rx * reach, y + ry * reach);
        if (Number.isFinite(up) && Number.isFinite(down)) into.push(up - down);
      }
    }
    length += segment;
  }
  return { drop3: median(drops3), drop6: median(drops6), length };
}

/**
 * Hela kedjan: opasserbara och passerbara branter som DXF, och en sammanfattning. Med markrastret (`ground`) görs linjerna av
 * alla streck tillsammans och sorten avgörs av det uppmätta fallet; utan det avgör Karttapullautins två filer.
 */
export function cliffsFromTicks(impassable: readonly Tick[], passable: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS, ground?: GroundGrid,
  rules: CliffRules = DEFAULT_CLIFF_RULES) {
  const meters = (lines: [number, number][][]) => Math.round(lines.reduce((sum, line) => sum + line.reduce((part, point, i) =>
    i === 0 ? 0 : part + Math.hypot(point[0] - line[i - 1]![0], point[1] - line[i - 1]![1]), 0), 0));
  let high: [number, number][][], low: [number, number][][], dropped = 0;
  if (ground) {
    high = []; low = [];
    for (const line of cliffLines([...impassable, ...passable], settings)) {
      const { drop3, drop6, length } = measureCliff(line, ground);
      if (!Number.isFinite(drop3)) { low.push(line); continue; }
      if (drop3 < rules.minDrop) { dropped += 1; continue; }
      if (drop3 >= rules.impassableDrop3 && drop6 >= rules.impassableDrop6 && length >= rules.impassableLength) high.push(line); else low.push(line);
    }
  } else {
    // Passerbara streck där det redan är opasserbart (inom 2 m) hör till den opasserbara branten.
    const taken = new Set<string>();
    const key = (x: number, y: number) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
    for (const [x1, y1, x2, y2] of impassable) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      for (let ax = -2; ax <= 2; ax += 2) for (let ay = -2; ay <= 2; ay += 2) taken.add(key(mx + ax, my + ay));
    }
    high = cliffLines(impassable, settings);
    low = cliffLines(passable.filter(([x1, y1, x2, y2]) => !taken.has(key((x1 + x2) / 2, (y1 + y2) / 2))), settings);
  }
  return { dxf: moistureDxf([{ name: "brant_opasserbar", closed: false, parts: high }, { name: "brant_passerbar", closed: false, parts: low }]),
    lines: { impassable: high, passable: low },
    summary: { cliffs201: high.length, cliffs202: low.length, cliffMeters201: meters(high), cliffMeters202: meters(low), ...(ground ? { cliffsDropped: dropped } : {}) } };
}

/**
 * Terrängskuggning ur markrastret (ägaren 2026-11-10: «terrängskuggning som man kan tona för att få en förståelse för
 * kurvbilden»): ljus från nordväst blandat med ljus rakt uppifrån (branter mörka åt alla håll), som en gråskalebild med
 * världsfil. Mycket stora raster glesas ut så att bilden blir högst `maxSide` punkter i sida.
 */
/** Skuggningens grå (0–255) för en cell i det utglesade rastret, eller inget där marken saknas. Rad 0 är längst i söder. */
export function shadeValue(ground: GroundGrid, step: number, column: number, row: number): number | undefined {
  const size = ground.cell * step;
  const z = (c: number, r: number) => {
    const x = Math.min(ground.width - 1, Math.max(0, c * step)), y = Math.min(ground.height - 1, Math.max(0, r * step));
    return ground.z[x * ground.height + y]!;
  };
  const here = z(column, row);
  if (!Number.isFinite(here)) return undefined;
  const value = (c: number, r: number) => { const v = z(c, r); return Number.isFinite(v) ? v : here; };
  const dx = (value(column + 1, row) - value(column - 1, row)) / (2 * size), dy = (value(column, row + 1) - value(column, row - 1)) / (2 * size);
  // Ljuset kommer från nordväst, 45° över horisonten.
  const lx = -0.5, ly = 0.5, lz = Math.SQRT1_2, length = Math.hypot(dx, dy, 1);
  const lit = Math.max(0, (-dx * lx - dy * ly + lz) / length);
  // Plan mark blir ljusgrå (0,8), sluttningar mot ljuset ljusare och bort från det mörkare; branter mörknar åt alla håll.
  return Math.round(255 * Math.min(1, Math.max(0, 0.8 * lit / lz * (0.7 + 0.3 / length))));
}

export function hillshade(ground: GroundGrid, maxSide = 6000): { png: Buffer; world: string; width: number; height: number } {
  const step = Math.max(1, Math.ceil(Math.max(ground.width, ground.height) / maxSide));
  const width = Math.floor(ground.width / step), height = Math.floor(ground.height / step), size = ground.cell * step;
  const png = encodePng(width, height, (column, line) => {
    const shade = shadeValue(ground, step, column, height - 1 - line);
    return shade === undefined ? [0, 0, 0, 0] : [shade, shade, shade, 255];
  });
  return { png, world: `${size}\n0\n0\n${-size}\n${ground.minX + size / 2}\n${ground.minY + (height - 0.5) * size}\n`, width, height };
}
