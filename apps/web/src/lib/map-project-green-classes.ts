import type { SourceData, SourceFeature } from "@o-tid/map-revision";
import { fillHoles, simplification, smoothMask, smoothMaskWide, SMOOTH_RADIUS_CELLS } from "./map-project-mask-smooth";
import { scatteredTrees } from "./map-project-scattered-trees";
import { chaikin, compactMask, maskOutlines, simplifyRing, type PhotoPixels } from "@o-tid/map-revision/base-map";

/**
 * Ägaren 2026-11-11 («göra itereringar av olika lager, t.ex. grönt, efter första körning»): geo-arbetarens bild
 * `vegetationsklasser.png` har Karttapullautins klass per cell (2 m) i röd kanal: låga fyra bitar 1 = öppet, 2 och uppåt
 * grönskans steg (steg = klass − 2), höga bitar undervegetationen (1 lätt, 2 svår). Stegen för grönt dras här i webbläsaren och
 * ytorna blir kandidater med samma lagernamn som geo-arbetarens vegetation (401, 406, 408, 410, 407, 409).
 */
export type BorderLevel = "none" | "few" | "some" | "many";
export interface GreenSettings { readonly slow: number; readonly difficult: number; readonly fight: number; readonly undergrowth: boolean; readonly minAreaM2: number;
  /** Beståndsgränser (416) ur lasern (ägaren 2026-11-11: «få/några/många beståndsgränser»). */
  readonly borders?: BorderLevel | undefined;
  /**
   * Tätt buskskikt: andelen laserträffar 1–3 m över marken från vilken skogen blir grön (406). Förvalet 0,08 är geo-arbetarens
   * (`DENSE_MID_SHARE`); mätt mot Högdalen 2026-11-13 ger 0,08 mest träff (F 0,42, yta 0,6–1,1 × kartans), 0,10 ger 0,4–0,7 ×
   * (F 0,38) och 0,12 ger 0,2–0,5 × (F 0,35). Gäller klassbilder från geo-arbetaren 28 och senare.
   */
  readonly denseShare?: number | undefined;
  /**
   * Förenkla de gröna ytorna, 0–10 (ägaren 2026-11-14: «ett reglage som generaliserar gröna ytor mer»). 0 = som förut. Högre
   * sluter smala vikar, tar bort tunna armar och små fläckar, fyller små hål och rätar kanten (`simplification`). Gäller 406,
   * 408 och 410; stegen ligger kvar inuti varandra, eftersom alla tre förenklas lika.
   */
  readonly simplify?: number | undefined;
  /** Gläntor (401), 1–10 (`clearingShape`). Utelämnat = 5. */
  readonly clearings?: number | undefined }

/**
 * Gläntorna (ägaren 2026-11-15: «finns inget reglage för gläntor, de borde både kunna hittas mer och göras större, mer mjuka»):
 * öppen mark (401) med ett reglage 1–10. 5 är som förut (minsta yta ur `minAreaM2`). Högre tar med mindre gläntor (minsta ytan
 * 0,7 gånger per steg, ner till 50 m²) och gör dem större (0,6 m utåt per steg, in i vanlig skog men inte i grönt); lägre kräver
 * större ytor (1,5 gånger per steg). Kanten rundas alltid (Chaikin två varv) i stället för rasterns trappsteg.
 *
 * Mätt i Högdalen (kartritaren som facit, 39 gläntor under 5 000 m²): Karttapullautins öppna klass hittar 11 av dem, och
 * minsta ytan ändrar det knappt; laserns gläntor är få och små där kartritaren ritar halvöppen skog. Reglaget är därför ett
 * redskap för smak, inte en mätt förbättring.
 */
export function clearingShape(level: number, minAreaM2: number, cellMeters: number): { minCells: number; growCells: number } {
  const step = Math.round(Math.min(10, Math.max(1, level))) - 5;
  const area = step > 0 ? Math.max(50, minAreaM2 * 0.7 ** step) : minAreaM2 * 1.5 ** -step;
  return { minCells: Math.max(2, Math.round(area / (cellMeters * cellMeters))), growCells: step > 0 ? Math.round(step * 0.6 / cellMeters) : 0 };
}

/** Öppen mark utvidgad `cells` steg (fyrgrannar) in i celler där `room` är 1. */
function grow(mask: Uint8Array, room: Uint8Array, columns: number, rows: number, cells: number): Uint8Array {
  let a = mask;
  for (let k = 0; k < cells; k += 1) {
    const b = Uint8Array.from(a);
    for (let c = 0; c < columns; c += 1) for (let r = 0; r < rows; r += 1) {
      const i = c * rows + r;
      if (a[i] || !room[i]) continue;
      if ((r > 0 && a[i - 1]) || (r + 1 < rows && a[i + 1]) || (c > 0 && a[i - rows]) || (c + 1 < columns && a[i + rows])) b[i] = 1;
    }
    a = b;
  }
  return a;
}
/** Minsta bestånd (m²) och förenkling (celler) per nivå: färre gränser = större bestånd och rakare kanter. */
const BORDER_LEVELS: Readonly<Record<Exclude<BorderLevel, "none">, { minAreaM2: number; simplify: number }>> = {
  few: { minAreaM2: 5000, simplify: 2 }, some: { minAreaM2: 2000, simplify: 1.25 }, many: { minAreaM2: 600, simplify: 0.75 } };
/** Samma steg som geo-arbetarens förval (`GREEN_STEPS` i scripts/geo-vegetation.ts). */
/** Klassbildens alfa för halvöppna celler (samma som `SEMI_ALPHA` i scripts/geo-vegetation.ts). */
export const SEMI_ALPHA = 200;
export const DEFAULT_GREEN: GreenSettings = { slow: 2, difficult: 3, fight: 4, undergrowth: true, minAreaM2: 300, borders: "none", denseShare: 0.08 };

export function greenCandidates(pixels: PhotoPixels, settings: GreenSettings, toSource: (column: number, row: number) => [number, number], crs: number,
  cellMeters = 2): { data: SourceData; hectares: Readonly<Record<string, number>> } {
  const { width: columns, height: rows, data } = pixels;
  const shade = (value: number) => (value & 15) >= 2 ? (value & 15) - 2 : -1;
  const layers: { name: string; test: (value: number, i: number) => boolean }[] = [
    { name: "oppen_mark", test: (value, i) => (value & 15) === 1 && scattered[i] !== 1 },
    { name: "oppen_mark_spridda_trad", test: (_, i) => scattered[i] === 1 },
    { name: "gron_lattlopt", test: value => shade(value) >= settings.slow },
    { name: "gron_svarlopt", test: value => shade(value) >= settings.difficult },
    { name: "gron_mycket_svarlopt", test: value => shade(value) >= settings.fight },
    ...(settings.undergrowth ? [{ name: "undervegetation_lattlopt", test: (value: number) => value >> 4 >= 1 },
      { name: "undervegetation_svarlopt", test: (value: number) => value >> 4 >= 2 }] : [])
  ];
  const values = new Uint8Array(columns * rows), known = new Uint8Array(columns * rows), semi = new Uint8Array(columns * rows);
  // Klassbilder från geo-arbetaren 28: grön kanal är buskskiktets andel (tusendelar) och blå klassen utan tillägget för tätt
  // buskskikt. Äldre bilder har 160 i grön kanal överallt.
  let shares = false;
  for (let i = 0; i < data.length && !shares; i += 4) if (data[i + 3]! >= 128 && data[i + 1] !== 160) shares = true;
  const dense = Math.round((settings.denseShare ?? DEFAULT_GREEN.denseShare!) * 1000);
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
    const i = (row * columns + column) * 4;
    if (data[i + 3]! < 128) continue;
    let value = data[i]!;
    if (shares) {
      value = data[i + 2]!;
      if ((value & 15) !== 1 && data[i + 1]! >= dense && shade(value) < settings.slow) value = (value & 0xf0) | (settings.slow + 2);
    }
    values[column * rows + row] = value; known[column * rows + row] = 1;
    // Ägaren 2026-11-16: geo-arbetaren 37 märker halvöppna celler ur punktmolnet med alfa 200 (`SEMI_ALPHA`); de blir 404.
    if (Math.abs(data[i + 3]! - SEMI_ALPHA) <= 20) semi[column * rows + row] = 1;
  }
  const scattered = scatteredTrees(values, columns, rows, shade, settings.slow);
  for (let i = 0; i < scattered.length; i += 1) if (semi[i]) scattered[i] = 1;
  const minCells = Math.max(2, Math.round(settings.minAreaM2 / (cellMeters * cellMeters)));
  const features: SourceFeature[] = [];
  const hectares: Record<string, number> = {};
  const simpler = (settings.simplify ?? 0) > 0 ? simplification(settings.simplify!, cellMeters) : undefined;
  for (const layer of layers) {
    // Ägaren 2026-11-12: ytorna jämnas ut som i geo-arbetaren (gult öppnas bara ett steg, så att smala gläntor finns kvar).
    const raw = values.map((value, i) => (known[i] || layer.name === "oppen_mark_spridda_trad") && layer.test(value, i) ? 1 : 0);
    const green = simpler && layer.name.startsWith("gron_") ? simpler : undefined;
    const smooth = green ? fillHoles(smoothMaskWide(raw, columns, rows, green.close, green.open), columns, rows, green.holeCells)
      : smoothMask(raw, columns, rows, SMOOTH_RADIUS_CELLS, layer.name.startsWith("oppen_mark") ? 1 : SMOOTH_RADIUS_CELLS);
    const clearing = layer.name === "oppen_mark" ? clearingShape(settings.clearings ?? 5, settings.minAreaM2, cellMeters) : undefined;
    const compact = compactMask(smooth, columns, rows, clearing ? clearing.minCells : Math.round(minCells * (green?.areaFactor ?? 1)));
    const mask = clearing?.growCells ? grow(compact, values.map((value, i) => known[i] && shade(value) < settings.slow ? 1 : 0), columns, rows, clearing.growCells) : compact;
    hectares[layer.name] = Math.round(mask.reduce((sum, cell) => sum + cell, 0) * cellMeters * cellMeters / 100) / 100;
    for (const ring of maskOutlines(mask, columns, rows)) {
      const simple = clearing ? simplifyRing(chaikin(ring, 2), 0.4) : simplifyRing(ring, green?.tolerance ?? 0.75);
      if (simple.length >= 4) features.push({ layer: layer.name, geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column, row)) } });
    }
  }
  // Beståndsgränserna: kanterna mellan öppet, vanlig skog och grönt, med större minsta bestånd för färre gränser.
  const level = settings.borders && settings.borders !== "none" ? BORDER_LEVELS[settings.borders] : undefined;
  if (level) {
    const stand = Math.max(2, Math.round(level.minAreaM2 / (cellMeters * cellMeters)));
    for (const test of [(value: number) => (value & 15) === 1, (value: number) => shade(value) >= settings.slow]) {
      const mask = compactMask(values.map((value, i) => known[i] && test(value) ? 1 : 0), columns, rows, stand);
      for (const ring of maskOutlines(mask, columns, rows)) {
        const simple = simplifyRing(ring, level.simplify);
        if (simple.length >= 4) features.push({ layer: "bestandsgrans_laser", geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column, row)) } });
      }
    }
  }
  return { data: { features, skipped: 0, crs }, hectares };
}
