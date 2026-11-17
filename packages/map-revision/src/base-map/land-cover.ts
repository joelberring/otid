import type { SourceFeature } from "../index";
import { maskOutlines } from "./photo-interpret";
import { vegetationRing } from "./vegetation-shapes";

/**
 * Ägaren 2026-11-17 («kör NMD»): Naturvårdsverkets Nationella marktäckedata (NMD2023, 10 m, CC0) som källa i grundkartan.
 * NMD är tolkad ur Sentinel-2 (som har infrarött) och Lantmäteriets laserdata, och skiljer det lasern inte ser: öppen våtmark
 * från torr öppen mark, häll från mark med växter, löv från barr.
 *
 * Mätt 2026-11-17 mot kartritarnas kartor (öppna kärr = kartans sankmark 307–310 på öppen mark):
 *
 * | | Gömmaren P / R / F | Lida P / R / F |
 * |---|---|---|
 * | Laserns öppna mark | 0,03 / 0,74 / 0,06 | 0,01 / 0,57 / 0,03 |
 * | NMD:s öppna våtmark | 0,59 / 0,78 / 0,67 | 0,19 / 0,50 / 0,27 |
 *
 * Lida-kartan är från före 2020 och har mindre öppen sankmark än NMD (bl.a. vid sjön). NMD:s «öppen fastmark utan vegetation»
 * (411) träffade kartornas berg i dagen dåligt (Lida P 0,08, R 0,60): grus, vägkanter och sand räknas dit. Den används inte än.
 *
 * Här blir den öppna våtmarken ytor i lagret `sankmark_oppen_nmd` (föreslås som 308) i SWEREF 99 TM. Rastrets trappsteg om
 * 10 m förenklas och rundas som vegetationen (`vegetationRing`). Grundkartan låter laserns blöta mark gå först och klipper
 * fuktigt och marktäckets fasta sankmark mot NMD:s (marsh-merge.ts).
 */
export const NMD_ATTRIBUTION = "NMD2023, Naturvårdsverket";
export const NMD_OPEN_WETLAND_LAYER = "sankmark_oppen_nmd";

/** NMD:s klasser för rutan: rad 0 i norr, index rad · bredd + kolumn; 0 = ingen klass (utanför eller okänd färg). */
export interface LandCoverGrid {
  readonly minX: number;
  readonly maxY: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  readonly codes: Uint16Array;
}

/** Öppen våtmark: 200 (underindelning saknas), myrarna 211–218 och övrig våtmark 221–228. */
export const isOpenWetland = (code: number) => code >= 200 && code <= 228;

/** Minsta våtmark som tas med, i kartans mm² (normens minsta sankmark är mindre, men NMD:s 10 m-celler är grova). */
const MIN_AREA_MM2 = 1;

/** NMD:s öppna våtmark som ytor (SWEREF 99 TM) för kartans skala. */
export function landCoverFeatures(grid: LandCoverGrid, scale: number): SourceFeature[] {
  const { width, height, cell } = grid;
  if (width < 2 || height < 2 || grid.codes.length < width * height) return [];
  // Kolumnvis mask (index = kolumn · rader + rad), som `maskOutlines` vill ha.
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    if (isOpenWetland(grid.codes[row * width + column]!)) mask[column * height + row] = 1;
  }
  const minCells = Math.max(2, Math.round(MIN_AREA_MM2 * (scale / 1000) ** 2 / (cell * cell)));
  const kept = withoutSmall(mask, width, height, minCells);
  const features: SourceFeature[] = [];
  for (const ring of maskOutlines(kept, width, height)) {
    // Trappstegen om en cell förenklas bort (0,6 celler) och kanten rundas.
    const smooth = vegetationRing(ring, 0.6, 3);
    if (smooth.length < 3) continue;
    const points = [...smooth, smooth[0]!].map(([column, row]) => [grid.minX + column * cell, grid.maxY - row * cell] as [number, number]);
    features.push({ layer: NMD_OPEN_WETLAND_LAYER, geometry: { kind: "line", closed: true, points } });
  }
  return features;
}

/** Masken utan sammanhängande delar (fyrgrannar) mindre än `minCells`. */
function withoutSmall(mask: Uint8Array, columns: number, rows: number, minCells: number): Uint8Array {
  const out = new Uint8Array(mask.length), seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head]!; head += 1;
      const x = Math.floor(i / rows), y = i - x * rows;
      for (const n of [x > 0 ? i - rows : -1, x + 1 < columns ? i + rows : -1, y > 0 ? i - 1 : -1, y + 1 < rows ? i + 1 : -1]) {
        if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; queue[tail] = n; tail += 1; }
      }
    }
    if (tail >= minCells) for (let k = 0; k < tail; k += 1) out[queue[k]!] = 1;
  }
  return out;
}

/** Koderna ur svarets base64 (Uint16, little-endian), som webbläsaren och servern får dem. */
export function landCoverCodesFromBase64(text: string, cells: number): Uint16Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(text, "base64")) : Uint8Array.from(atob(text), char => char.charCodeAt(0));
  } catch { return undefined; }
  if (bytes.length !== cells * 2) return undefined;
  const codes = new Uint16Array(cells), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < cells; i += 1) codes[i] = view.getUint16(i * 2, true);
  return codes;
}
