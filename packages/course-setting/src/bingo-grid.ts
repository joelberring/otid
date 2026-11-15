/**
 * Bingoorientering (ägaren 2026-11-15): rutnätet för en grupp. Rutorna följer kartans papper (kartans norr uppåt), räknas
 * från områdets övre vänstra hörn och heter kolumnens bokstav och radens siffra (A1, B1 … AA1). En ruta som till största
 * delen ligger utanför området tas bort (en kantruta med mindre än `MIN_INSIDE` av sin yta inne i området).
 * Banpåtrycket ritar rutnätet och namnen i banans lila.
 */
import type { Sizes } from "./appearance";
import type { CourseSettingDocument, MapRect, OverprintPrimitive } from "./types";
import type { BingoTraining } from "./training-types";

export const BINGO_LIMITS = { minCellMeters: 20, maxCellMeters: 2000, maxCells: 900, maxShips: 8, maxShipLength: 6 } as const;
/** Förslagen på rutstorlek i meter. */
export const BINGO_CELL_SIZES = [100, 150, 250] as const;
/** Den minsta andelen av en kantruta som ska ligga i området. */
const MIN_INSIDE = 0.4;

export interface BingoCell {
  /** "A1", "B3" … */
  readonly name: string;
  readonly column: number;
  readonly row: number;
  /** Rutan i kartans mm (y uppåt), klippt till området. */
  readonly rect: MapRect;
}

/** Kolumnens bokstäver: 0 → A, 25 → Z, 26 → AA. */
export function bingoColumnName(index: number): string {
  let name = "", rest = Math.floor(index);
  do { name = String.fromCharCode(65 + (rest % 26)) + name; rest = Math.floor(rest / 26) - 1; } while (rest >= 0);
  return name;
}

/** Rutans sida i kartans mm (kartans skala: 1:10 000 ger 10 mm för 100 m). */
export function bingoCellMm(cellMeters: number, mapScale: number): number {
  return cellMeters * 1000 / mapScale;
}

/** Rutorna i ordning rad för rad (A1, B1 …, A2 …); tom lista om området eller rutan saknar storlek. */
export function bingoCells(bingo: BingoTraining, mapScale: number): BingoCell[] {
  const side = bingoCellMm(bingo.cellMeters, mapScale);
  const { minX, minY, maxX, maxY } = bingo.area;
  const width = maxX - minX, height = maxY - minY;
  if (!(side > 0) || !(width > 0) || !(height > 0)) return [];
  const columns = Math.ceil(width / side - 1e-9), rows = Math.ceil(height / side - 1e-9);
  if (columns * rows > BINGO_LIMITS.maxCells * 4) return [];
  const out: BingoCell[] = [];
  for (let row = 0; row < rows; row++) {
    const top = maxY - row * side, bottom = Math.max(minY, top - side);
    for (let column = 0; column < columns; column++) {
      const left = minX + column * side, right = Math.min(maxX, left + side);
      if (((right - left) * (top - bottom)) / (side * side) < MIN_INSIDE) continue;
      out.push({ name: `${bingoColumnName(column)}${row + 1}`, column, row, rect: { minX: left, minY: bottom, maxX: right, maxY: top } });
    }
  }
  return out.length > BINGO_LIMITS.maxCells ? [] : out;
}

/** Rutnätet och rutornas namn för banpåtrycket (kartans mm; texten och linjen i papperets mått genom `sizes.ratio`). */
export function bingoFigures(document: CourseSettingDocument, bingo: BingoTraining, sizes: Sizes): OverprintPrimitive[] {
  const cells = bingoCells(bingo, document.event.mapScale);
  if (cells.length === 0) return [];
  const width = 0.25 * sizes.ratio;
  const side = bingoCellMm(bingo.cellMeters, document.event.mapScale);
  // Namnet i rutans övre vänstra hörn, högst 3 mm på papperet och högst en femtedel av rutan.
  const height = Math.min(3 * sizes.ratio, side * 0.2);
  const pad = height * 0.35;
  const out: OverprintPrimitive[] = [];
  const edges = new Set<string>();
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const key = [a, b].map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort().join("|");
    if (edges.has(key)) return;
    edges.add(key);
    out.push({ kind: "polyline", role: "TRAINING", color: "COURSE", points: [a, b], width, ref: "bingo" });
  };
  for (const { rect } of cells) {
    const tl = { x: rect.minX, y: rect.maxY }, tr = { x: rect.maxX, y: rect.maxY }, br = { x: rect.maxX, y: rect.minY }, bl = { x: rect.minX, y: rect.minY };
    edge(tl, tr); edge(tr, br); edge(br, bl); edge(bl, tl);
  }
  for (const cell of cells) {
    out.push({ kind: "text", role: "TRAINING", color: "COURSE", at: { x: cell.rect.minX + pad, y: cell.rect.maxY - pad - height / 2 }, text: cell.name,
      heightMm: height, align: "left", font: { family: "Arial", bold: true, italic: false }, ref: `bingo:${cell.name}` });
  }
  return out;
}
