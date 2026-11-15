import type { SourceData, SourceFeature } from "@o-tid/map-revision";
import { compactMask, maskOutlines, simplifyRing, SLOPE_STEP_DEGREES, type PhotoPixels } from "@o-tid/map-revision/base-map";

/**
 * Ägaren 2026-11-11 («bra att kunna dra i markfuktighetslagren»): geo-arbetarens bild `fuktdjup.png` har höjden över närmaste
 * fuktstråk i varje cell (2 m), i steg om 2 cm i röd kanal (0–254), genomskinligt utan data och i vatten. Gränserna för blött
 * och fuktigt dras här i webbläsaren och ytorna blir kandidater (`blott`, 308, och `fuktigt`, 310), utan en ny körning.
 * Kanaltröskeln (hur stor tillrinning ett fuktstråk har) ändrar själva höjderna och kräver en ny körning.
 */
export const DEPTH_STEP_METERS = 0.02;
export interface DepthSettings { readonly wetMeters: number; readonly moistMeters: number; readonly minAreaM2: number;
  /** Brantast för blött (grader); fuktigt får vara dubbelt så brant. */
  readonly wetSlopeDegrees?: number | undefined;
  /** Inga kärr där minst så stor andel (0–1) av laserträffarna når marken (öppen, ofta utdikad mark); 1 = ingen gräns. */
  readonly openGroundShare?: number | undefined }
export const DEFAULT_DEPTH: DepthSettings = { wetMeters: 0.3, moistMeters: 0.6, minAreaM2: 400, wetSlopeDegrees: 3, openGroundShare: 0.8 };
/**
 * Ägaren 2026-11-11 (Högdalen som facit): bara flack mark blir blöt (högst 3°) eller fuktig (högst 6°), som i geo-arbetaren.
 * Lutningen står i blå kanal i steg om 0,1° (`SLOPE_STEP_DEGREES`); 255 (äldre bilder) betyder okänd och ingen gräns.
 */
/**
 * Ägaren 2026-11-12 («opasserbara kärr missas … precis ute vid havet»): öppen blöt mark inom 30 m från vatten är strandkärr
 * och räknas trots regeln om öppen mark (som geo-arbetaren, `SHORE_MARSH_METERS`). Vattnet är bildens genomskinliga celler.
 */
const SHORE_MARSH_METERS = 30;
/**
 * Kärren i sorter (ägaren 2026-11-15: «kärren ligger också dubbelt i raster. det borde istället skilja på olika typer av kärr,
 * från otydlig till öppen och misstänkt oöverkomlig»): blött (308) och fuktigt (310) låg på varandra, så att blött fick två
 * raster. Nu är fuktigt bara det som inte är blött. Öppen blöt mark vid vatten (strandkärr utan träd, ofta gult vid sjöar)
 * som ligger högst `OPEN_MARSH_LOW_METERS` över fuktstråket blir en egen kandidat, misstänkt oöverkomlig sankmark (307), som
 * kartritaren tar ställning till i fält.
 */
export const OPEN_MARSH_LOW_METERS = 0.1;
/** Bildpunkterna (rad för rad) inom `reach` celler från en genomskinlig. */
function nearTransparent(data: Uint8ClampedArray | Uint8Array, columns: number, rows: number, reach: number): Uint8Array {
  const distance = new Int32Array(columns * rows).fill(-1), queue = new Int32Array(columns * rows);
  let head = 0, tail = 0;
  for (let p = 0; p < columns * rows; p += 1) if (data[p * 4 + 3]! < 128) { distance[p] = 0; queue[tail++] = p; }
  while (head < tail) {
    const p = queue[head++]!, d = distance[p]!;
    if (d >= reach) continue;
    const column = p % columns, row = (p - column) / columns;
    if (column > 0 && distance[p - 1] === -1) { distance[p - 1] = d + 1; queue[tail++] = p - 1; }
    if (column < columns - 1 && distance[p + 1] === -1) { distance[p + 1] = d + 1; queue[tail++] = p + 1; }
    if (row > 0 && distance[p - columns] === -1) { distance[p - columns] = d + 1; queue[tail++] = p - columns; }
    if (row < rows - 1 && distance[p + columns] === -1) { distance[p + columns] = d + 1; queue[tail++] = p + columns; }
  }
  const out = new Uint8Array(columns * rows);
  for (let p = 0; p < out.length; p += 1) if (distance[p]! >= 0) out[p] = 1;
  return out;
}

const signed = (ring: readonly (readonly [number, number])[]) =>
  ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;
function inside(ring: readonly (readonly [number, number])[], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** `maskOutlines` ger yttre ringar och hål åt motsatta håll: varje hål läggs till den minsta yttre ring det ligger i. */
export function polygonsOf(rings: readonly (readonly [number, number])[][]): (readonly [number, number])[][][] {
  const sorted = rings.map(ring => ({ ring, area: signed(ring) })).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const sign = Math.sign(sorted[0]?.area ?? 1), polygons: { outer: (readonly [number, number])[]; area: number; rings: (readonly [number, number])[][] }[] = [];
  for (const { ring, area } of sorted) {
    if (Math.sign(area) === sign) { polygons.push({ outer: ring, area: Math.abs(area), rings: [ring] }); continue; }
    const [x, y] = ring[0]!, owner = polygons.filter(polygon => inside(polygon.outer, x + 0.25, y + 0.25) || inside(polygon.outer, x - 0.25, y - 0.25))
      .sort((a, b) => a.area - b.area)[0];
    owner?.rings.push(ring);
  }
  return polygons.map(polygon => polygon.rings);
}

/** Ytorna ur bilden; `toSource` räknar en bildpunkt (kolumn, rad, hörn) till källans koordinater och `cellMeters` är cellens sida. */
export function depthCandidates(pixels: PhotoPixels, settings: DepthSettings, toSource: (column: number, row: number) => [number, number], crs: number,
  cellMeters = 2): { data: SourceData; wetHa: number; moistHa: number; soddenHa: number } {
  const { width: columns, height: rows, data } = pixels;
  const wetStep = settings.wetMeters / DEPTH_STEP_METERS, moistStep = settings.moistMeters / DEPTH_STEP_METERS;
  const steepest = settings.wetSlopeDegrees ?? 3, WET_SLOPE_STEPS = steepest / SLOPE_STEP_DEGREES, MOIST_SLOPE_STEPS = 2 * steepest / SLOPE_STEP_DEGREES;
  const wet = new Uint8Array(columns * rows), moist = new Uint8Array(columns * rows), sodden = new Uint8Array(columns * rows);
  const lowStep = OPEN_MARSH_LOW_METERS / DEPTH_STEP_METERS;
  // Grön kanal är markträffarnas andel i bilder från geo-arbetaren v12 (lärt av Högdalenkartan 2026-11-11); i äldre bilder
  // är den lika med röd överallt.
  let shares = false;
  for (let i = 0; i < data.length && !shares; i += 4) if (data[i + 3]! >= 128 && data[i + 1] !== data[i]) shares = true;
  const openLimit = shares ? (settings.openGroundShare ?? 0.8) * 254 : Infinity;
  const shore = Number.isFinite(openLimit) ? nearTransparent(data, columns, rows, Math.round(SHORE_MARSH_METERS / cellMeters)) : undefined;
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const i = (row * columns + column) * 4;
    if (data[i + 3]! < 128) continue;
    const open = data[i + 1]! < 255 && data[i + 1]! >= openLimit;
    if (open && !shore?.[row * columns + column]) continue;
    const step = data[i]!, slope = data[i + 2]!, known = slope < 255, at = column * rows + row;
    if (open && step <= Math.min(lowStep, wetStep) && !(known && slope > WET_SLOPE_STEPS)) sodden[at] = 1;
    else if (step <= wetStep && !(known && slope > WET_SLOPE_STEPS)) wet[at] = 1;
    else if (step <= moistStep && !(known && slope > MOIST_SLOPE_STEPS)) moist[at] = 1;
  }
  const minCells = Math.max(2, Math.round(settings.minAreaM2 / (cellMeters * cellMeters)));
  const features: SourceFeature[] = [];
  const hectares = (mask: Uint8Array) => Math.round(mask.reduce((sum, cell) => sum + cell, 0) * cellMeters * cellMeters / 100) / 100;
  const areas = { wet: 0, moist: 0, sodden: 0 };
  for (const [mask, layer, key] of [[sodden, "sankmark_misstankt_ooverkomlig", "sodden"], [wet, "blott", "wet"], [moist, "fuktigt", "moist"]] as const) {
    const clean = compactMask(mask, columns, rows, minCells);
    areas[key] = hectares(clean);
    // Ytor med hål (fuktigt runt blött får ett hål där det blöta ligger, annars får det blöta två raster).
    for (const rings of polygonsOf(maskOutlines(clean, columns, rows).map(ring => simplifyRing(ring, 0.75)).filter(ring => ring.length >= 4)))
      features.push({ layer, geometry: { kind: "area", rings: rings.map(ring => ring.map(([column, row]) => toSource(column, row))) } });
  }
  return { data: { features, skipped: 0, crs }, wetHa: areas.wet, moistHa: areas.moist, soddenHa: areas.sodden };
}
