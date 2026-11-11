import type { SourceData, SourceFeature } from "@o-tid/map-revision";
import { compactMask, maskOutlines, simplifyRing, type PhotoPixels } from "./map-project-photo-interpret";

/**
 * Ägaren 2026-11-11 («göra itereringar av olika lager, t.ex. grönt, efter första körning»): geo-arbetarens bild
 * `vegetationsklasser.png` har Karttapullautins klass per cell (2 m) i röd kanal: låga fyra bitar 1 = öppet, 2 och uppåt
 * grönskans steg (steg = klass − 2), höga bitar undervegetationen (1 lätt, 2 svår). Stegen för grönt dras här i webbläsaren och
 * ytorna blir kandidater med samma lagernamn som geo-arbetarens vegetation (401, 406, 408, 410, 407, 409).
 */
export interface GreenSettings { readonly slow: number; readonly difficult: number; readonly fight: number; readonly undergrowth: boolean; readonly minAreaM2: number }
/** Samma steg som geo-arbetarens förval (`GREEN_STEPS` i scripts/geo-vegetation.ts). */
export const DEFAULT_GREEN: GreenSettings = { slow: 2, difficult: 4, fight: 5, undergrowth: true, minAreaM2: 300 };

export function greenCandidates(pixels: PhotoPixels, settings: GreenSettings, toSource: (column: number, row: number) => [number, number], crs: number,
  cellMeters = 2): { data: SourceData; hectares: Readonly<Record<string, number>> } {
  const { width: columns, height: rows, data } = pixels;
  const shade = (value: number) => (value & 15) >= 2 ? (value & 15) - 2 : -1;
  const layers: { name: string; test: (value: number) => boolean }[] = [
    { name: "oppen_mark", test: value => (value & 15) === 1 },
    { name: "gron_lattlopt", test: value => shade(value) >= settings.slow },
    { name: "gron_svarlopt", test: value => shade(value) >= settings.difficult },
    { name: "gron_mycket_svarlopt", test: value => shade(value) >= settings.fight },
    ...(settings.undergrowth ? [{ name: "undervegetation_lattlopt", test: (value: number) => value >> 4 >= 1 },
      { name: "undervegetation_svarlopt", test: (value: number) => value >> 4 >= 2 }] : [])
  ];
  const values = new Uint8Array(columns * rows), known = new Uint8Array(columns * rows);
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const i = (row * columns + column) * 4;
    if (data[i + 3]! < 128) continue;
    values[column * rows + row] = data[i]!; known[column * rows + row] = 1;
  }
  const minCells = Math.max(2, Math.round(settings.minAreaM2 / (cellMeters * cellMeters)));
  const features: SourceFeature[] = [];
  const hectares: Record<string, number> = {};
  for (const layer of layers) {
    const mask = compactMask(values.map((value, i) => known[i] && layer.test(value) ? 1 : 0), columns, rows, minCells);
    hectares[layer.name] = Math.round(mask.reduce((sum, cell) => sum + cell, 0) * cellMeters * cellMeters / 100) / 100;
    for (const ring of maskOutlines(mask, columns, rows)) {
      const simple = simplifyRing(ring, 0.75);
      if (simple.length >= 4) features.push({ layer: layer.name, geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column, row)) } });
    }
  }
  return { data: { features, skipped: 0, crs }, hectares };
}
