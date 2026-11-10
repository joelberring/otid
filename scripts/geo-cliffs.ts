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
import { moistureDxf, simplify } from "./geo-moisture.ts";

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

/** Hela kedjan: opasserbara och passerbara branter som DXF, och en sammanfattning. */
export function cliffsFromTicks(impassable: readonly Tick[], passable: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS) {
  // Passerbara streck där det redan är opasserbart (inom 2 m) hör till den opasserbara branten.
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
  for (const [x1, y1, x2, y2] of impassable) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    for (let ax = -2; ax <= 2; ax += 2) for (let ay = -2; ay <= 2; ay += 2) taken.add(key(mx + ax, my + ay));
  }
  const high = cliffLines(impassable, settings);
  const low = cliffLines(passable.filter(([x1, y1, x2, y2]) => !taken.has(key((x1 + x2) / 2, (y1 + y2) / 2))), settings);
  const meters = (lines: [number, number][][]) => Math.round(lines.reduce((sum, line) => sum + line.reduce((part, point, i) =>
    i === 0 ? 0 : part + Math.hypot(point[0] - line[i - 1]![0], point[1] - line[i - 1]![1]), 0), 0));
  return { dxf: moistureDxf([{ name: "brant_opasserbar", closed: false, parts: high }, { name: "brant_passerbar", closed: false, parts: low }]),
    lines: { impassable: high, passable: low },
    summary: { cliffs201: high.length, cliffs202: low.length, cliffMeters201: meters(high), cliffMeters202: meters(low) } };
}
