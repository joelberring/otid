import type { SourceData, SourceFeature } from "../index";
import type { GridPart } from "./drawing-basis";
import { compactMask, maskOutlines, simplifyRing, type PhotoPixels } from "./photo-interpret";

/**
 * Ägaren 2026-11-18 («tolkningen av berg blev inte så bra. en massa fält utan grönska blev berg»): flygbilden tolkas
 * tillsammans med laserkörningen. Mätt mot Högdalen och Tyresta (projektets `ortofoto-matning-*-2026-11-18.md`):
 *
 * - Lasern ger formen och kanten: öppet är där vegetationen är lägre än `OPEN_MAX_VEGETATION` m (F 0,67 i båda kartorna).
 * - Fotot säger vad ytan är, jämfört med *bildens egen fördelning* och utan fasta gränser (färgerna beror på flygdatum och
 *   årstid; i Högdalen var torrt gräs lägst i NDVI, i Tyresta de kala hällarna):
 *   - en lucka med levande krontak (NDVI över bildens 70:e percentil) är ingen glänta (en fjärdedel färre falska gläntor,
 *     över 90 % av kartritarnas gläntor kvar),
 *   - berg i dagen är den öppna, torra marken med lägst NDVI i bilden (under `rockPercentile`; Tyresta F 0,34 mot 0,09 för
 *     den gamla regeln). Ägaren: «ofta finns en flytande gräns mellan dem så de kan också ritas som gläntor» – reglaget.
 *
 * Fotot måste ha nära infrarött (falskfärgsbilden «– IR»); utan det blir bara laserns öppna mark kvar och inget berg.
 * Alla koordinater i SWEREF 99 TM (laserkörningens rutnät).
 */
export const OPEN_MAX_VEGETATION = 1.5;
/** Över så här mycket (m) ovanför närmaste fuktstråk är marken torr nog för berg i dagen. */
export const ROCK_MIN_DRY = 0.5;
export const GLADE_LIVE_PERCENTILE = 70;
export const DEFAULT_ROCK_PERCENTILE = 10;
export const PHOTO_LASER_LAYERS = { rock: "berg_i_dagen", open: "oppen_mark_laser_foto" } as const;

export interface PhotoLaserSettings {
  /** Bildpunkter i sida per cell (ca 2 m). */
  readonly cellPixels: number;
  readonly minCells: number;
  /** Bilden är falskfärgsbilden (IR i röd kanal, rött i grön). */
  readonly infrared: boolean;
  /** Berg i dagen = NDVI under den här percentilen av bildens celler (0–100). */
  readonly rockPercentile: number;
}
export interface PhotoLaser {
  /** Vegetationens högsta höjd över mark (m; `lasveg.png`), NaN utan punkter. */
  readonly vegetation: GridPart;
  /** Höjden över närmaste fuktstråk (m; `fuktdjup.png`); utan den räknas all mark som torr. */
  readonly wet?: GridPart | undefined;
}

/** Värdet i rutnätet vid en punkt (närmaste cell), NaN utanför. */
export function gridValue(part: GridPart, x: number, y: number): number {
  const [a, , c, , e, f] = part.affine;
  const column = Math.round((x - c) / a), row = Math.round((y - f) / e);
  if (column < 0 || row < 0 || column >= part.grid.columns || row >= part.grid.rows) return Number.NaN;
  return part.grid.meters[row * part.grid.columns + column]!;
}

/** Percentilen (0–100) av värdena (sorteras inte på plats). */
export function percentile(values: Float32Array | readonly number[], q: number): number {
  const sorted = Float32Array.from(values).sort();
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q / 100 * (sorted.length - 1))))]!;
}

export function interpretPhotoWithLaser(pixels: PhotoPixels, settings: PhotoLaserSettings, toSource: (column: number, row: number) => [number, number],
  crs: number, laser: PhotoLaser): { data: SourceData; rockCells: number; openCells: number } {
  const size = settings.cellPixels, columns = Math.floor(pixels.width / size), rows = Math.floor(pixels.height / size);
  const cells = columns * rows, ndvi = new Float32Array(cells).fill(Number.NaN), open = new Uint8Array(cells), dry = new Uint8Array(cells);
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const index = column * rows + row;
    const [x, y] = toSource((column + 0.5) * size, (row + 0.5) * size);
    const vegetation = gridValue(laser.vegetation, x, y);
    if (!(vegetation < OPEN_MAX_VEGETATION)) continue;
    open[index] = 1;
    const wet = laser.wet ? gridValue(laser.wet, x, y) : Number.POSITIVE_INFINITY;
    if (!(wet <= ROCK_MIN_DRY)) dry[index] = 1;
  }
  if (settings.infrared) {
    for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
      let nir = 0, red = 0, count = 0;
      for (let dx = 0; dx < size; dx += 1) for (let dy = 0; dy < size; dy += 1) {
        const i = ((row * size + dy) * pixels.width + column * size + dx) * 4;
        if (pixels.data[i + 3] === 0) continue;
        nir += pixels.data[i]!; red += pixels.data[i + 1]!; count += 1;
      }
      if (count >= size * size / 2) ndvi[column * rows + row] = (nir - red) / (nir + red + 1e-6);
    }
  }
  const known = ndvi.filter(Number.isFinite);
  const live = known.length ? percentile(known, GLADE_LIVE_PERCENTILE) : Number.POSITIVE_INFINITY;
  const bare = known.length ? percentile(known, settings.rockPercentile) : Number.NEGATIVE_INFINITY;
  const rock = new Uint8Array(cells), openOnly = new Uint8Array(cells);
  for (let index = 0; index < cells; index += 1) {
    if (!open[index]) continue;
    const value = ndvi[index]!;
    if (Number.isFinite(value) && value > live) continue;
    if (dry[index] && Number.isFinite(value) && value < bare) rock[index] = 1; else openOnly[index] = 1;
  }
  const features: SourceFeature[] = [];
  const counts = { rock: 0, open: 0 };
  for (const [mask, layer, name] of [[rock, PHOTO_LASER_LAYERS.rock, "rock"], [openOnly, PHOTO_LASER_LAYERS.open, "open"]] as const) {
    const kept = compactMask(mask, columns, rows, settings.minCells);
    counts[name] = kept.reduce((sum, cell) => sum + cell, 0);
    for (const ring of maskOutlines(kept, columns, rows)) {
      const simple = simplifyRing(ring, 0.75);
      if (simple.length < 4) continue;
      features.push({ layer, geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column * size, row * size)) } });
    }
  }
  return { data: { features, skipped: 0, crs }, rockCells: counts.rock, openCells: counts.open };
}
