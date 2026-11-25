/**
 * Ägaren 2026-11-23 («skulle man kunna använda flygbildanalys med AI för att förstå vilka ytor som är vägar/hårdgjord mark?»):
 * Fyll ytor ur flygbilden. Varje sluten ruta som ytmotorn ger (`photo-fill.ts`) klassas ur ortofotot med pixelstatistik:
 *
 * - **hårdgjord** (asfalt, plattor, grus): grå och låg mättnad, lite grönt, låg NDVI när IR finns,
 * - **gräs/öppen mark**: grön och jämn (låg lokal textur), hög NDVI,
 * - **träd/skog**: grön och fläckig (hög lokal textur) eller mörkgrön,
 * - **vatten**: mörk, blåare än grön och röd, jämn, utan växtlighet (mörk i IR),
 * - **osäker**: blandat, mest skugga, utanför bilden, eller större än `PHOTO_MAX_AUTO_M2` (troligen inte en sorts mark).
 *
 * Skuggor från hus ska inte bli träd: mörka bildpunkter utan grönt (låg mättnad) räknas som okända och resten av rutan
 * avgör. Ren TypeScript utan I/O: samma kod i kartans Worker och i kartjobbet (AI-kopplingens `classify_cells`).
 */
import type { Point } from "@o-tid/map-file";

export type PhotoCellClass = "paved" | "grass" | "trees" | "water" | "unsure";
export const PHOTO_CELL_CLASSES: readonly Exclude<PhotoCellClass, "unsure">[] = ["paved", "grass", "trees", "water"];

/** En bild i kartans mm: bildpunkten (kolumn, rad) har mitten i (minX + (k + ½)·step, maxY − (r + ½)·step); RGBA. */
export interface PhotoRaster {
  readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray;
  readonly minX: number; readonly maxY: number; readonly step: number;
}

/** Rutor större än så här (m²) klassas inte automatiskt (ägaren: över 2–4 ha är troligen inte en enda sorts mark). */
export const PHOTO_MAX_AUTO_M2 = 20_000;
/** Under denna säkerhet är rutan osäker (förslaget visas men är inte förvalt; AI-steget frågas om den). */
export const PHOTO_CONFIDENT = 0.5;

export interface PhotoCellStats {
  /** Bildpunkter i rutan, med bild (alfa > 0), skugga och växtlighet (bland de som inte är skugga). */
  readonly pixels: number; readonly valid: number; readonly shadow: number; readonly vegetation: number;
  /** Medel bland bildpunkterna som inte är skugga (0–1). */
  readonly light: number; readonly saturation: number; readonly red: number; readonly green: number; readonly blue: number;
  /**
   * Lokal textur: medel av |ΔL| mellan grannar (vågrätt och lodrätt) som båda ligger i rutan, delat med rutans medelljushet
   * (skuggpunkterna med: luckorna mellan trädkronorna är det som gör skogen fläckig). Beror på bildpunktens storlek: ställd för
   * ca 0,25 m (Lantmäteriets ortofoto).
   */
  readonly texture: number;
  /** NDVI (−1–1) när IR-bilden finns. */
  readonly ndvi?: number | undefined;
}

export interface PhotoCellGuess {
  /** Bästa gissningen (också för en osäker ruta, utom när bilden saknas). */
  readonly guess: PhotoCellClass;
  /** 0–1. */
  readonly confidence: number;
  /** Kort orsak: «shadow», «mixed», «large», «no-photo», «few-pixels» eller klassens namn. */
  readonly reason: string;
}

/** Bildpunkten: ljushet, mättnad och grönhet (ExG). */
function pixel(r: number, g: number, b: number) {
  const high = Math.max(r, g, b), low = Math.min(r, g, b), sum = r + g + b;
  return { light: sum / 3, saturation: high === 0 ? 0 : (high - low) / high, exg: sum === 0 ? 0 : (2 * g - r - b) / sum };
}

/** Är bildpunkten skugga (mörk utan grönt)? Med IR: växtlighet i skugga (NDVI hög) är inte skugga. */
export function isShadowPixel(r: number, g: number, b: number, ndvi?: number): boolean {
  if (ndvi !== undefined && ndvi > 0.3) return false;
  const { light, exg, saturation } = pixel(r, g, b);
  return light < 0.12 || (light < 0.24 && exg < 0.06 && saturation < 0.4);
}

/**
 * NDVI över detta är växtlighet. Lantmäteriets falskfärgsbild (som underlaget ritas) ger låga värden: asfalt −0,26, gräsmatta
 * 0,17, trädkronor 0,3–0,4 (Högdalen); hårdgjort kräver medel under `PHOTO_PAVED_NDVI`.
 */
export const PHOTO_VEGETATION_NDVI = 0.1, PHOTO_PAVED_NDVI = 0.02;

/** Är bildpunkten växtlighet? Med IR avgör NDVI (Lantmäteriets falskfärgsbild: IR i röd kanal, rött i grön). */
export function isVegetationPixel(r: number, g: number, b: number, ndvi?: number): boolean {
  if (ndvi !== undefined) return ndvi > PHOTO_VEGETATION_NDVI;
  const { exg } = pixel(r, g, b);
  return exg > 0.04 && g >= r;
}

/** Bildpunkternas spann (kolumn från–till) per rad inom ringarna (jämn–udda), i bildens rutnät. */
function spans(raster: PhotoRaster, rings: readonly (readonly Point[])[], visit: (row: number, from: number, to: number) => void) {
  let minY = Infinity, maxY = -Infinity;
  for (const point of rings[0] ?? []) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  const firstRow = Math.max(0, Math.floor((raster.maxY - maxY) / raster.step)), lastRow = Math.min(raster.height - 1, Math.ceil((raster.maxY - minY) / raster.step));
  const xs: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = raster.maxY - (row + 0.5) * raster.step;
    xs.length = 0;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k]! - raster.minX) / raster.step - 0.5)), to = Math.min(raster.width - 1, Math.floor((xs[k + 1]! - raster.minX) / raster.step - 0.5));
      if (to >= from) visit(row, from, to);
    }
  }
}

/**
 * Rutans pixelstatistik i färgbilden (`rgb`) och, när den finns, IR-bilden (`ir`, samma rutnät: IR, rött, grönt i röd, grön
 * och blå kanal). Ringarna är rutans ytterkant och hål i kartans mm.
 */
export function photoCellStats(rgb: PhotoRaster, rings: readonly (readonly Point[])[], ir?: PhotoRaster): PhotoCellStats {
  const width = rgb.width, data = rgb.data, irData = ir && ir.width === width && ir.height === rgb.height ? ir.data : undefined;
  let pixels = 0, valid = 0, shadow = 0, vegetation = 0, kept = 0, light = 0, saturation = 0, red = 0, green = 0, blue = 0, ndviSum = 0, ndviCount = 0;
  let textureSum = 0, textureCount = 0, allLight = 0;
  // Ljusheten i rutans bildpunkter med bild, för texturen mot grannen ovanför och till vänster (två återanvända radbuffertar).
  let prevRow = new Float32Array(width).fill(-1);
  let currRow = new Float32Array(width).fill(-1);
  let currentRow = -2;
  spans(rgb, rings, (row, from, to) => {
    if (row !== currentRow) {
      if (row === currentRow + 1) {
        const tmp = prevRow;
        prevRow = currRow;
        currRow = tmp;
        currRow.fill(-1);
      } else {
        prevRow.fill(-1);
        currRow.fill(-1);
      }
      currentRow = row;
    }
    for (let column = from; column <= to; column += 1) {
      pixels += 1;
      const i = (row * width + column) * 4;
      if (data[i + 3] === 0) continue;
      valid += 1;
      const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
      let ndvi: number | undefined;
      if (irData && irData[i + 3] !== 0) { const nir = irData[i]! / 255, rd = irData[i + 1]! / 255; ndvi = (nir - rd) / (nir + rd + 1e-6); }
      const p = pixel(r, g, b);
      allLight += p.light;
      currRow[column] = p.light;
      const light32 = currRow[column]!;
      if (column > 0) {
        const left = currRow[column - 1]!;
        if (left >= 0) { textureSum += Math.abs(light32 - left); textureCount += 1; }
      }
      const up = prevRow[column]!;
      if (up >= 0) { textureSum += Math.abs(light32 - up); textureCount += 1; }
      if (isShadowPixel(r, g, b, ndvi)) { shadow += 1; continue; }
      kept += 1; light += p.light; saturation += p.saturation; red += r; green += g; blue += b;
      if (ndvi !== undefined) { ndviSum += ndvi; ndviCount += 1; }
      if (isVegetationPixel(r, g, b, ndvi)) vegetation += 1;
    }
  });
  const mean = (sum: number) => kept ? sum / kept : 0;
  return { pixels, valid, shadow, vegetation, light: mean(light), saturation: mean(saturation), red: mean(red), green: mean(green), blue: mean(blue),
    texture: textureCount && allLight ? textureSum / textureCount / (allLight / valid) : 0, ...(ndviCount ? { ndvi: ndviSum / ndviCount } : {}) };
}

/**
 * Relativ lokal textur över detta är träd, under är gräs; växtlighet mörkare än `PHOTO_TREE_LIGHT` är också träd. Ställt efter
 * Lantmäteriets ortofoto över Högdalen (0,26 m): gräsmatta 0,028, trädkronor 0,05–0,065; ljushet gräs 0,29–0,32, skog 0,22.
 */
export const PHOTO_TREE_TEXTURE = 0.042, PHOTO_TREE_LIGHT = 0.215;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Rutans klass ur statistiken och ytan (m²). */
export function classifyPhotoCell(stats: PhotoCellStats, areaM2: number): PhotoCellGuess {
  if (stats.pixels === 0 || stats.valid < stats.pixels * 0.5) return { guess: "unsure", confidence: 0, reason: "no-photo" };
  const kept = stats.valid - stats.shadow;
  if (kept < 4) return { guess: "unsure", confidence: 0, reason: stats.valid < 8 ? "few-pixels" : "shadow" };
  const vegShare = stats.vegetation / kept, shadowShare = stats.shadow / stats.valid;
  // Mest skugga: resten säger för lite.
  const shadowFactor = clamp(1 - Math.max(0, shadowShare - 0.4) / 0.4);
  const fewFactor = clamp(kept / 40);
  let guess: PhotoCellClass, confidence: number, reason: string;
  const waterish = vegShare < 0.15 && stats.blue > stats.green * 1.02 && stats.blue > stats.red * 1.05 && stats.light < 0.35 && stats.texture < 0.03
    && (stats.ndvi === undefined || stats.ndvi < 0);
  if (waterish) {
    guess = "water"; confidence = 0.6 * clamp((0.03 - stats.texture) / 0.015 + 0.5); reason = "water";
  } else if (vegShare >= 0.5) {
    const tex = stats.texture, dark = stats.light < PHOTO_TREE_LIGHT;
    const trees = tex > PHOTO_TREE_TEXTURE || dark;
    guess = trees ? "trees" : "grass"; reason = guess;
    const greenSure = clamp((vegShare - 0.5) / 0.3);
    const textureSure = dark ? clamp((PHOTO_TREE_LIGHT - stats.light) / 0.03 + 0.5) : clamp(Math.abs(tex - PHOTO_TREE_TEXTURE) / 0.015);
    confidence = Math.min(greenSure, 0.3 + 0.7 * textureSure);
  } else if (vegShare <= 0.3 && (stats.ndvi === undefined ? stats.saturation < 0.32 : stats.ndvi < PHOTO_PAVED_NDVI)) {
    guess = "paved"; reason = "paved";
    confidence = Math.min(clamp((0.3 - vegShare) / 0.2), stats.ndvi === undefined ? clamp((0.32 - stats.saturation) / 0.12) : clamp((PHOTO_PAVED_NDVI - stats.ndvi) / 0.12));
  } else {
    // Torrt gräs och ruderat: lite grönt men inte hårdgjort enligt IR.
    const openish = vegShare >= 0.3 || (stats.ndvi !== undefined && stats.ndvi >= PHOTO_PAVED_NDVI);
    guess = openish ? (stats.texture > PHOTO_TREE_TEXTURE && vegShare >= 0.3 ? "trees" : "grass") : "paved"; reason = "mixed";
    confidence = 0.2;
  }
  confidence = Math.round(confidence * shadowFactor * fewFactor * 100) / 100;
  if (shadowFactor < 0.5 && confidence < PHOTO_CONFIDENT) reason = "shadow";
  if (areaM2 > PHOTO_MAX_AUTO_M2) return { guess, confidence: Math.min(confidence, 0.2), reason: "large" };
  return { guess, confidence, reason };
}

/** Symbolerna att välja mellan per klass (den första som finns i kartan är förvald). */
export const PHOTO_CLASS_CODES: Readonly<Record<Exclude<PhotoCellClass, "unsure">, readonly string[]>> = {
  paved: ["501", "529"], grass: ["401", "403", "402"], trees: ["405", "406", "408", "404", "402"], water: ["301", "302"]
};

/** Förhandsvisningens färger per klass (fyllning med genomskinlighet läggs på av den som ritar). */
export const PHOTO_CLASS_COLORS: Readonly<Record<PhotoCellClass, string>> = {
  paved: "#8a8a8a", grass: "#f2c230", trees: "#2f9e44", water: "#1c7ed6", unsure: "#e8590c"
};
