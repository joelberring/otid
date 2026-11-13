import type { SourceData, SourceFeature } from "../index";
import { compactMask, maskOutlines, simplifyRing, type PhotoPixels } from "./photo-interpret";
import type { PixelAffine } from "./flat-contours";

/**
 * Ägaren 2026-11-13 («känns om algoritmen borde hitta berg i dagen, t.ex. här ute vid havet i Järflotta», «ett reglage att klassa
 * fler/färre områden som berg … standardläget kanske ska vara ganska restriktivt»): geo-arbetaren skriver bergbilden `berg.png`
 * (`encodeRockCell` i scripts/geo-rock.ts) med ojämnhet, öppenhet, höjd över omgivningen och avstånd till vatten per cell, och
 * valet av berg görs här i webbläsaren (och på servern för grundkartan) med en nivå 1–10, utan ny körning.
 *
 * Bildens kanaler: R = ojämnheten i mm (0–255), G = 128 om vegetationen är öppen plus höjden över omgivningen i dm (0–127),
 * B = avståndet till vatten i m (0–254; 255 = inget vatten inom 254 m). Genomskinligt = utan data eller i vatten.
 */
export const ROCK_LAYER = "berg_i_dagen";
/** Lagren som berg i dagen ur laserjobbet ligger i (berg.dxf) och som regeln ersätter. */
export const ROCK_LAYERS = /^berg_i_dagen(_laser)?$/;
/** Förvalet är restriktivt: bara tydliga hällar och de som ligger vid vatten. */
export const DEFAULT_ROCK_LEVEL = 3;

export interface RockLimits {
  /** Minsta ojämnhet (m) för öppen mark. */
  readonly roughness: number;
  /** Skog (inte öppen vegetation) räknas med: från nivå 6, med ojämnheten 1,5 gånger gränsen och högre än 0,3 m över omgivningen. */
  readonly forest: boolean;
  /** Strandregeln: öppen mark inom så här många meter från vatten (0 = ingen strandregel). */
  readonly shoreMeters: number;
  /** Vid vatten räcker en höjd över omgivningen på minst så här många meter … */
  readonly shoreRise: number;
  /** … eller en ojämnhet på minst så här stor del av gränsen. */
  readonly shoreRoughness: number;
  /** Minsta yta (m²). */
  readonly minAreaM2: number;
}

const lerp = (from: number, to: number, share: number) => from + (to - from) * share;

/** Gränserna för en nivå 1–10 (förval 3): rätlinjigt mellan nivå 1 (få) och 10 (många). */
export function rockLimitsAt(level: number): RockLimits {
  const rounded = Math.min(10, Math.max(1, Math.round(level))), s = (rounded - 1) / 9;
  return { roughness: lerp(0.12, 0.04, s), forest: rounded >= 6, shoreMeters: lerp(0, 40, s), shoreRise: lerp(1.5, 0.3, s), shoreRoughness: 0.6,
    minAreaM2: lerp(200, 50, s) };
}

/** Celler som är berg enligt nivån: ett fält med 1 (index kolumn · rader + rad, rad 0 överst). */
export function rockMask(pixels: PhotoPixels, level: number): Uint8Array {
  const { width: columns, height: rows, data } = pixels, limits = rockLimitsAt(level);
  const mask = new Uint8Array(columns * rows);
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const i = (row * columns + column) * 4;
    if (data[i + 3]! < 128) continue;
    const roughness = data[i]! / 1000, open = data[i + 1]! >= 128, rise = (data[i + 1]! & 127) / 10, water = data[i + 2]!;
    const rock = open
      ? roughness >= limits.roughness
        || (limits.shoreMeters > 0 && water <= limits.shoreMeters && (rise >= limits.shoreRise || roughness >= limits.shoreRoughness * limits.roughness))
      : limits.forest && roughness >= 1.5 * limits.roughness && rise > 0.3;
    if (rock) mask[column * rows + row] = 1;
  }
  return mask;
}

/** Fyller hål (celler utan berg, 4-grannar, som inte når kanten) under `minCells` celler, så att en liten lucka inte blir en egen ring. */
export function fillSmallHoles(mask: Uint8Array, columns: number, rows: number, minCells: number): Uint8Array {
  const out = Uint8Array.from(mask), seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const cells = [start];
    let edge = false;
    seen[start] = 1;
    for (let k = 0; k < cells.length; k += 1) {
      const column = Math.floor(cells[k]! / rows), row = cells[k]! - column * rows;
      if (column === 0 || row === 0 || column === columns - 1 || row === rows - 1) edge = true;
      for (const [nc, nr] of [[column + 1, row], [column - 1, row], [column, row + 1], [column, row - 1]] as const) {
        if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
        const n = nc * rows + nr;
        if (!mask[n] && !seen[n]) { seen[n] = 1; cells.push(n); }
      }
    }
    if (!edge && cells.length < minCells) for (const cell of cells) out[cell] = 1;
  }
  return out;
}

export interface RockAreas { readonly data: SourceData; readonly areas: number; readonly hectares: number }

/**
 * Bergytorna för en nivå som kandidater i lagret `berg_i_dagen` (214). `toSource` räknar ett bildhörn (kolumn, rad) till källans
 * koordinater och `cellMeters` är cellens sida. Ytorna rensas från små öar och smala delar (`compactMask`), små hål fylls och
 * ringarna förenklas.
 */
export function rockAreas(pixels: PhotoPixels, level: number, cellMeters: number, toSource: (column: number, row: number) => [number, number], crs: number): RockAreas {
  const { width: columns, height: rows } = pixels;
  const minCells = Math.max(2, Math.round(rockLimitsAt(level).minAreaM2 / (cellMeters * cellMeters)));
  const clean = compactMask(fillSmallHoles(rockMask(pixels, level), columns, rows, minCells), columns, rows, minCells);
  const features: SourceFeature[] = [];
  let areas = 0;
  for (const ring of maskOutlines(clean, columns, rows)) {
    const simple = simplifyRing(ring, 0.75);
    if (simple.length < 4) continue;
    features.push({ layer: ROCK_LAYER, geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column, row)) } });
    areas += 1;
  }
  const cells = clean.reduce((sum, cell) => sum + cell, 0);
  return { data: { features, skipped: 0, crs }, areas, hectares: Math.round(cells * cellMeters * cellMeters / 100) / 100 };
}

/** Bergytorna för en körnings bergbild (SWEREF 99 TM, världsfilens `affine`), med förvalets nivå om ingen anges. */
export function rockAreasOfJob(pixels: PhotoPixels, affine: PixelAffine, level: number = DEFAULT_ROCK_LEVEL): RockAreas {
  const [a, b, c, d, e, f] = affine;
  // Affinen gäller bildpunktens mitt (kolumn, rad); ett hörn ligger en halv cell före.
  return rockAreas(pixels, level, Math.hypot(a, d), (column, row) => [a * (column - 0.5) + b * (row - 0.5) + c, d * (column - 0.5) + e * (row - 0.5) + f], 3006);
}

/**
 * Berg i dagen ur laserjobbets filer ersätts av regelns ytor: i filen `berg.dxf` byts lagren `berg_i_dagen` och
 * `berg_i_dagen_laser` mot `rock` (stenar och kullar står kvar). Saknas filen läggs en till.
 */
export function withRockAreas<P extends { readonly name: string; readonly data: SourceData }>(parts: readonly P[], rock: SourceData): (P | { name: string; data: SourceData })[] {
  const replace = (data: SourceData): SourceData => ({ ...data, features: [...data.features.filter(feature => !ROCK_LAYERS.test(feature.layer)), ...rock.features] });
  return parts.some(part => part.name === "berg.dxf") ? parts.map(part => part.name === "berg.dxf" ? { ...part, data: replace(part.data) } : part)
    : [...parts, { name: "berg.dxf", data: { features: rock.features, skipped: 0, crs: rock.crs } }];
}
