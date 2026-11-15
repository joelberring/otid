import type { SourceFeature } from "../index";
import type { HeightGrid } from "./clear-contours";
import type { PixelAffine } from "./flat-contours";
import { maskOutlines, simplifyRing } from "./photo-interpret";
import { chaikin } from "./pit-search";

/**
 * Kärren följer kurvbilden (ägaren 2026-11-15: «kärr anpassas inte riktigt efter kurvbilden och kärrmarkeringar går upp över
 * höjdkurvor och ibland över höjder både stora och små»). Laserns fuktsteg (`blott`, `fuktigt`) räknas ur höjden över närmaste
 * fuktstråk och når därför upp i sluttningar och över små höjder i ett kärr. En kartritares kärr är nästan plant: i Högdalen låg
 * 97–99 % av kartritarens kärr högst 1 m över det lägsta kärret inom 20 m, men bara 67 % av O-Tids högst 0,5 m.
 *
 * Varje cell i laserns kärr jämförs därför med det lägsta kärret inom `MARSH_FLOOR_REACH_M` (alla sankmarkslager räknas). Celler
 * mer än `MARSH_FLOOR_RISE_M` över det lägsta tas bort, och det som blir kvar ritas om med mjuk kant; rester under
 * `MARSH_FLOOR_MIN_M2` tas bort. Mätt mot kartritaren (Högdalen, två block): F1 för kärren 0,42 → 0,51 och 0,49 → 0,55 vid
 * 20 m och 0,6 m; kärren minskar med 30–45 %, och nästan bara där kartritaren inte har kärr (0,2 s per block).
 *
 * Lantmäteriets sankmark (`sankmark_vat`, `sankmark_fast`) är karterad ur flygbild och rörs inte (som i `soil-marsh.ts`).
 */
export const MARSH_FLOOR_LAYERS: ReadonlySet<string> = new Set(["blott", "fuktigt"]);
const ALL_MARSH: ReadonlySet<string> = new Set(["blott", "fuktigt", "sankmark_vat", "sankmark_fast"]);
export const MARSH_FLOOR_REACH_M = 20;
export const MARSH_FLOOR_RISE_M = 0.6;
export const MARSH_FLOOR_MIN_M2 = 200;
/** Störst yta (celler) som prövas på en gång; större områden lämnas som de är. */
const MAX_CELLS = 30_000_000;

type Ring = [number, number][];
type Part = { readonly grid: HeightGrid; readonly affine: PixelAffine };

/** Minsta värdet inom `reach` celler åt varje håll längs en rad (van Herk/Gil-Werman, linjär tid). */
function minLine(source: Float32Array, target: Float32Array, length: number, offset: number, stride: number, reach: number, block: Float32Array, back: Float32Array) {
  const size = 2 * reach + 1;
  for (let i = 0; i < length; i += 1) {
    const value = source[offset + i * stride]!;
    block[i] = i % size === 0 ? value : Math.min(block[i - 1]!, value);
  }
  for (let i = length - 1; i >= 0; i -= 1) {
    const value = source[offset + i * stride]!;
    back[i] = i === length - 1 || (i + 1) % size === 0 ? value : Math.min(back[i + 1]!, value);
  }
  for (let i = 0; i < length; i += 1) {
    const lo = Math.max(0, i - reach), hi = Math.min(length - 1, i + reach);
    target[offset + i * stride] = Math.min(back[lo]!, block[hi]!);
  }
}

/** Ytans ringar (yttre och hål) fyllda i masken (kolumn för kolumn, som `maskOutlines`), jämn–udda över cellernas mitt. */
function fillRings(mask: Uint8Array, columns: number, rows: number, rings: readonly (readonly (readonly [number, number])[])[],
  toCell: (x: number, y: number) => [number, number], value: number) {
  const edges: [number, number, number, number][] = [];
  let low = Infinity, high = -Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = toCell(...ring[i]!), [x2, y2] = toCell(...ring[(i + 1) % ring.length]!);
    if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    low = Math.min(low, y1); high = Math.max(high, y1);
  }
  const crossings: number[] = [];
  for (let row = Math.max(0, Math.floor(low)); row <= Math.min(rows - 1, Math.ceil(high)); row += 1) {
    crossings.length = 0;
    for (const [x1, y1, x2, y2] of edges) if ((y1 <= row) !== (y2 <= row)) crossings.push(x1 + (row - y1) * (x2 - x1) / (y2 - y1));
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i]!)), to = Math.min(columns - 1, Math.floor(crossings[i + 1]!));
      for (let column = from; column <= to; column += 1) mask[column * rows + row] = value;
    }
  }
}

const signedArea = (ring: readonly (readonly [number, number])[]) =>
  ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;
function insideRing(ring: readonly (readonly [number, number])[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ringsOf = (feature: SourceFeature) => feature.geometry.kind === "area" ? feature.geometry.rings
  : feature.geometry.kind === "line" && feature.geometry.closed ? [feature.geometry.points] : [];

export interface MarshFloorResult { readonly features: SourceFeature[]; readonly removedM2: number; readonly changed: number }

/**
 * Grundkartans objekt med laserns kärr klippta till det som ligger nära kärrets botten. Utan höjd i ett område (eller med ett
 * vridet rutnät) lämnas kärren där som de är.
 */
export function marshOnFloor(features: readonly SourceFeature[], parts: readonly Part[], options: { rise?: number; reach?: number; minM2?: number } = {})
  : MarshFloorResult {
  const rise = options.rise ?? MARSH_FLOOR_RISE_M, reachM = options.reach ?? MARSH_FLOOR_REACH_M, minM2 = options.minM2 ?? MARSH_FLOOR_MIN_M2;
  const marsh = features.filter(feature => ALL_MARSH.has(feature.layer) && ringsOf(feature).length > 0);
  const laser = new Set(marsh.filter(feature => MARSH_FLOOR_LAYERS.has(feature.layer)));
  if (laser.size === 0) return { features: [...features], removedM2: 0, changed: 0 };
  const replaced = new Map<SourceFeature, SourceFeature[]>();
  let removedM2 = 0;
  for (const { grid, affine } of parts) {
    const [a, b, c, d, e, f] = affine;
    if (b !== 0 || d !== 0 || a <= 0 || e >= 0) continue;
    const cellM2 = a * -e, toCell = (x: number, y: number): [number, number] => [(x - c) / a, (y - f) / e];
    // Området: kärren som har sin mitt i rutnätet, med marginal för golvet.
    const mine = [...laser].filter(feature => {
      const [x, y] = ringsOf(feature)[0]![0]!, [column, row] = toCell(x, y);
      return !replaced.has(feature) && column >= 0 && row >= 0 && column < grid.columns && row < grid.rows;
    });
    if (mine.length === 0) continue;
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const feature of mine) for (const ring of ringsOf(feature)) for (const [x, y] of ring) {
      const [column, row] = toCell(x, y);
      minC = Math.min(minC, column); maxC = Math.max(maxC, column); minR = Math.min(minR, row); maxR = Math.max(maxR, row);
    }
    const reach = Math.ceil(reachM / a);
    const c0 = Math.max(0, Math.floor(minC) - reach), r0 = Math.max(0, Math.floor(minR) - reach);
    const c1 = Math.min(grid.columns - 1, Math.ceil(maxC) + reach), r1 = Math.min(grid.rows - 1, Math.ceil(maxR) + reach);
    const columns = c1 - c0 + 1, rows = r1 - r0 + 1;
    if (columns <= 0 || rows <= 0 || columns * rows > MAX_CELLS) continue;
    const local = (x: number, y: number): [number, number] => { const [column, row] = toCell(x, y); return [column - c0, row - r0]; };
    // Alla kärr i området, och höjden där (oändlig utanför kärr och utan höjd).
    const wet = new Uint8Array(columns * rows);
    for (const feature of marsh) fillRings(wet, columns, rows, ringsOf(feature), local, 1);
    const floor = new Float32Array(columns * rows).fill(Infinity);
    for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
      const z = grid.meters[(row + r0) * grid.columns + column + c0]!;
      if (wet[column * rows + row] && z === z) floor[column * rows + row] = z;
    }
    const temp = new Float32Array(columns * rows), longest = Math.max(columns, rows);
    const block = new Float32Array(longest), back = new Float32Array(longest);
    for (let column = 0; column < columns; column += 1) minLine(floor, temp, rows, column * rows, 1, reach, block, back);
    for (let row = 0; row < rows; row += 1) minLine(temp, floor, columns, row, rows, reach, block, back);
    const toSource = (column: number, row: number): [number, number] => [a * (column + c0) + c, e * (row + r0) + f];
    for (const feature of mine) {
      // Kärrets egen ruta (med en cells marginal), så att arbetet följer kärrets storlek och inte hela området.
      let fc0 = Infinity, fr0 = Infinity, fc1 = -Infinity, fr1 = -Infinity;
      for (const ring of ringsOf(feature)) for (const [x, y] of ring) {
        const [column, row] = local(x, y);
        fc0 = Math.min(fc0, column); fc1 = Math.max(fc1, column); fr0 = Math.min(fr0, row); fr1 = Math.max(fr1, row);
      }
      const bc0 = Math.max(0, Math.floor(fc0) - 1), br0 = Math.max(0, Math.floor(fr0) - 1);
      const width = Math.min(columns - 1, Math.ceil(fc1) + 1) - bc0 + 1, tall = Math.min(rows - 1, Math.ceil(fr1) + 1) - br0 + 1;
      if (width <= 0 || tall <= 0) continue;
      const own = new Uint8Array(width * tall);
      fillRings(own, width, tall, ringsOf(feature), (x, y) => { const [column, row] = local(x, y); return [column - bc0, row - br0]; }, 1);
      let before = 0, after = 0;
      for (let i = 0; i < own.length; i += 1) {
        if (!own[i]) continue;
        before += 1;
        const column = Math.floor(i / tall) + bc0, row = (i % tall) + br0, z = grid.meters[(row + r0) * grid.columns + column + c0]!;
        if (z === z && z - floor[column * rows + row]! > rise) own[i] = 0; else after += 1;
      }
      if (after === before) continue;
      removedM2 += (before - after) * cellM2;
      // Ny kant: mjuk och förenklad. De yttre ringarna går åt samma håll som den största; de andra är hål och hör till den
      // yttre ring de ligger i.
      const traced = maskOutlines(own, width, tall).filter(ring => ring.length >= 8)
        .map(ring => simplifyRing(chaikin(ring, 2), 0.4).map(([column, row]): [number, number] => toSource(column + bc0 - 0.5, row + br0 - 0.5)));
      const byArea = traced.map(ring => ({ ring, area: signedArea(ring) })).sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
      const outerSign = Math.sign(byArea[0]?.area ?? 1);
      const polygons: Ring[][] = [];
      for (const { ring, area } of byArea) {
        if (Math.sign(area) === outerSign) { if (Math.abs(area) >= minM2) polygons.push([ring]); continue; }
        const [x, y] = ring[0]!, owner = polygons.find(polygon => insideRing(polygon[0]!, x, y));
        if (owner && Math.abs(area) >= cellM2 * 4) owner.push(ring);
      }
      replaced.set(feature, polygons.map(rings => ({ ...feature, geometry: { kind: "area", rings } })));
    }
  }
  if (replaced.size === 0) return { features: [...features], removedM2: 0, changed: 0 };
  return { features: features.flatMap(feature => replaced.get(feature) ?? [feature]), removedM2: Math.round(removedM2), changed: replaced.size };
}
