import type { SourceFeature } from "../index";
import { blend } from "./knoll-choice";
import { depressionTick } from "./merge";
import type { PhotoPixels } from "./photo-interpret";
import { ringArea } from "./small-rings";

/**
 * Ägaren 2026-11-13 (Järflotta: «dels superdetaljerade dels helt flacka med brus. går det att ha en algoritm för att få bort
 * bruset i helt flacka områden?»): på flack mark flyttar ett höjdfel på 20 cm en kurva över 10 m i sidled vid 1° lutning, så
 * kurvorna där blir kringlor och småringar medan de i brant terräng ligger rätt. Första etappen är två rena borttagningar
 * (inga kurvor ritas om), styrda av markens medellutning i ett fönster på cirka 40 m (`flatSlopeFrom`):
 *
 * - hjälpkurvor (formlinjer) klipps bort där marken är flack minst `FLAT_CUT_METERS` i sträck; en rest kortare än
 *   `FLAT_KEEP_METERS` tas också bort, och en sluten hjälpkurva helt på flack mark tas bort hel,
 * - små slutna ringar (höjdkurvor, sänkor och hjälpkurvor, inte stödkurvor och mellankurvor) under en viss yta tas bort när
 *   minst `FLAT_RING_SHARE` av ringen ligger på flack mark. `smallRingsToPoints` har redan gjort ringarna under normens
 *   minsta mått till punkthöjder; de här är större än så och blir inget alls.
 *
 * Vanliga öppna kurvor rörs inte. Ren kod utan I/O: samma i webbläsaren (panelen och kandidaternas Worker) och på servern.
 */
export interface FlatLimits {
  /** Mark med lägre medellutning (grader) räknas som flack. */
  readonly slopeDegrees: number;
  /** Slutna ringar med mindre yta (m²) tas bort på flack mark. */
  readonly ringM2: number;
}
/** Förvalet på skalan 0–10 (försiktigt). */
export const DEFAULT_FLAT_LEVEL = 3;
const FLAT_LEVEL_1: FlatLimits = { slopeDegrees: 0.5, ringM2: 500 }, FLAT_LEVEL_5: FlatLimits = { slopeDegrees: 1.5, ringM2: 1500 },
  FLAT_LEVEL_10: FlatLimits = { slopeDegrees: 4, ringM2: 5000 };
/** Gränserna på skalan 0–10: 0 = av (inga gränser), 1 = bara det allra flackaste, 10 = mest. Rätlinjigt däremellan. */
export function flatLimitsAt(level: number): FlatLimits | undefined {
  if (!(level >= 1)) return undefined;
  return level < 5 ? blend(FLAT_LEVEL_1, FLAT_LEVEL_5, (level - 1) / 4) : blend(FLAT_LEVEL_5, FLAT_LEVEL_10, (level - 5) / 5);
}

export const FLAT_CUT_METERS = 20, FLAT_KEEP_METERS = 30, FLAT_RING_SHARE = 0.8;
/** Fönstret som medellutningen räknas i (meter i sida). */
export const FLAT_WINDOW_METERS = 40;
/** Längsta steget mellan två prov längs en kurva (meter). */
const SAMPLE_METERS = 5;
const FORMLINE = /^formline$/i, SMALL_RING = /^(contour|depression|formline)$/i;
type Position = readonly [number, number];
type Sample = { readonly at: Position; readonly original: boolean; readonly along: number };

export interface FlatContourResult {
  readonly features: SourceFeature[];
  /** Så många meter hjälpkurva och så många små ringar togs bort. */
  readonly formlineMeters: number; readonly rings: number;
  /**
   * Det som togs bort (hela ursprungliga objekt, också de klippta hjälpkurvorna och borttagna sänkors lutningsstreck) och det
   * som kom i stället (resterna av klippta hjälpkurvor), så att `restoreFlatContours` kan ge tillbaka det ursprungliga.
   */
  readonly removed: SourceFeature[]; readonly added: SourceFeature[];
}

/** Proven längs en linje: linjens egna punkter och så många emellan att inget steg är längre än `SAMPLE_METERS`. */
function samplesOf(points: readonly Position[]): Sample[] {
  const out: Sample[] = [];
  let along = 0;
  points.forEach((point, index) => {
    if (index > 0) {
      const from = points[index - 1]!, span = Math.hypot(point[0] - from[0], point[1] - from[1]), steps = Math.ceil(span / SAMPLE_METERS);
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        out.push({ at: [from[0] + (point[0] - from[0]) * t, from[1] + (point[1] - from[1]) * t], original: false, along: along + span * t });
      }
      along += span;
    }
    out.push({ at: point, original: true, along });
  });
  return out;
}

/** Bitarna som blir kvar av en öppen linje (index i proven), eller inget när ingenting klipps. */
function keptRuns(samples: readonly Sample[], flat: readonly boolean[]): [number, number][] | undefined {
  const cut = new Uint8Array(samples.length);
  let any = false;
  for (let i = 0; i < samples.length; i += 1) {
    if (!flat[i]) continue;
    let j = i;
    while (j + 1 < samples.length && flat[j + 1]) j += 1;
    if (samples[j]!.along - samples[i]!.along >= FLAT_CUT_METERS) { cut.fill(1, i, j + 1); any = true; }
    i = j;
  }
  if (!any) return undefined;
  const runs: [number, number][] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (cut[i]) continue;
    let j = i;
    while (j + 1 < samples.length && !cut[j + 1]) j += 1;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}

/**
 * Grundkartans objekt (meter) utan hjälpkurvor och små ringar på flack mark. `flatSlopeAt` ger markens medellutning i grader
 * kring en punkt (inget svar utanför data: där rörs ingenting). Utan gränser (`flatLimitsAt(0)`) ändras ingenting.
 * Objekt som inte berörs lämnas som de är (samma objekt), i samma ordning.
 */
export function calmFlatContours(features: readonly SourceFeature[], flatSlopeAt: (x: number, y: number) => number | undefined,
  limits: FlatLimits | undefined): FlatContourResult {
  if (!limits) return { features: [...features], formlineMeters: 0, rings: 0, removed: [], added: [] };
  const isFlat = ({ at }: Sample) => { const slope = flatSlopeAt(at[0], at[1]); return slope !== undefined && slope < limits.slopeDegrees; };
  const removed: SourceFeature[] = [], added: SourceFeature[] = [], ticks: Position[] = [];
  let meters = 0, rings = 0;
  const pieceOf = (feature: SourceFeature, samples: readonly Sample[], from: number, to: number): SourceFeature => ({ ...feature,
    geometry: { kind: "line", closed: false, points: samples.slice(from, to + 1).filter((sample, index, all) => sample.original || index === 0 || index === all.length - 1).map(sample => sample.at) } });

  const calmed = features.flatMap((feature): SourceFeature[] => {
    const geometry = feature.geometry;
    if (geometry.kind !== "line" || geometry.points.length < 2) return [feature];
    const formline = FORMLINE.test(feature.layer);
    if (!formline && !SMALL_RING.test(feature.layer)) return [feature];
    const first = geometry.points[0]!, last = geometry.points[geometry.points.length - 1]!;
    const joined = geometry.points.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01;
    const closed = (geometry.closed || joined) && geometry.points.length >= 3;
    if (!closed) {
      if (!formline) return [feature];
      const samples = samplesOf(geometry.points), runs = keptRuns(samples, samples.map(isFlat));
      if (!runs) return [feature];
      const kept = runs.filter(([from, to]) => samples[to]!.along - samples[from]!.along >= FLAT_KEEP_METERS);
      const pieces = kept.map(([from, to]) => pieceOf(feature, samples, from, to));
      meters += samples[samples.length - 1]!.along - kept.reduce((sum, [from, to]) => sum + samples[to]!.along - samples[from]!.along, 0);
      removed.push(feature); added.push(...pieces);
      return pieces;
    }
    // Ringen ett varv, från första punkten och tillbaka dit (sista provet är första punkten igen).
    const ring = joined ? geometry.points.slice(0, -1) : geometry.points;
    const around = samplesOf([...ring, ring[0]!]), count = around.length - 1;
    const flat = around.map(isFlat), flatCount = flat.slice(0, count).filter(Boolean).length;
    if (ringArea(ring) < limits.ringM2 && flatCount >= FLAT_RING_SHARE * count) {
      rings += 1; removed.push(feature);
      ticks.push(...depressionTick(feature).map(tick => (tick.geometry as { at: Position }).at));
      return [];
    }
    if (!formline || flatCount === 0) return [feature];
    const perimeter = around[count]!.along;
    if (flatCount === count) { meters += perimeter; removed.push(feature); return []; }
    // Börja varvet på brant mark direkt efter flack, så att ingen flack sträcka går över varvets skarv.
    const start = flat.findIndex((value, index) => !value && flat[(index + count - 1) % count]);
    const turn: Sample[] = Array.from({ length: count + 1 }, (_, index) => {
      const sample = around[(start + index) % count]!;
      return { ...sample, along: (sample.along - around[start]!.along + perimeter) % perimeter + (index === count ? perimeter : 0) };
    });
    const runs = keptRuns(turn, turn.map((_, index) => flat[(start + index) % count]!));
    if (!runs) return [feature];
    // En kort flack sträcka precis före skarven klipps inte: då är varvets sista och första bit en och samma.
    const line = [...turn, ...turn.slice(1).map(sample => ({ ...sample, along: sample.along + perimeter }))];
    if (runs.length > 1 && runs[runs.length - 1]![1] === count) runs.splice(0, runs.length, ...runs.slice(1, -1), [runs[runs.length - 1]![0], count + runs[0]![1]]);
    const kept = runs.filter(([from, to]) => line[to]!.along - line[from]!.along >= FLAT_KEEP_METERS);
    const pieces = kept.map(([from, to]) => pieceOf(feature, line, from, to));
    meters += perimeter - kept.reduce((sum, [from, to]) => sum + line[to]!.along - line[from]!.along, 0);
    removed.push(feature); added.push(...pieces);
    return pieces;
  });
  // En borttagen sänkas lutningsstreck (`depressionTick`) tas bort med den.
  const out = ticks.length === 0 ? calmed : calmed.filter(feature => {
    if (feature.layer !== "lutningsstreck" || feature.geometry.kind !== "point") return true;
    const [x, y] = feature.geometry.at;
    if (!ticks.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 0.05)) return true;
    removed.push(feature);
    return false;
  });
  return { features: out, formlineMeters: Math.round(meters), rings, removed, added };
}

/** Objekten som de var innan `calmFlatContours` (det borttagna läggs sist). Det som bytts ut av annat sedan dess står kvar. */
export function restoreFlatContours(features: readonly SourceFeature[], calmed: Pick<FlatContourResult, "removed" | "added">): SourceFeature[] {
  const added = new Set(calmed.added);
  return [...features.filter(feature => !added.has(feature)), ...calmed.removed];
}

/** Lutningens steg i fuktdjupets blå kanal (grader per värde; 255 = okänt), som geo-arbetaren skriver den. */
export const SLOPE_STEP_DEGREES = 0.1;
/** Markens lutning i ett rutnät, rad för rad norrifrån, i steg om `SLOPE_STEP_DEGREES`; 255 = okänt (utan data eller vatten). */
export interface SlopeGrid { readonly columns: number; readonly rows: number; readonly steps: Uint8Array }
/** Lutningen ur laserkörningens bild `fuktdjup.png` (blå kanal; genomskinligt = utan data). */
export function slopeGridOf(pixels: PhotoPixels): SlopeGrid {
  const { width: columns, height: rows, data } = pixels, steps = new Uint8Array(columns * rows).fill(255);
  for (let p = 0; p < steps.length; p += 1) if (data[p * 4 + 3]! >= 128) steps[p] = data[p * 4 + 2]!;
  return { columns, rows, steps };
}

/** Bildpunktens mitt (kolumn, rad) till terrängens koordinater: x = a·kolumn + b·rad + c, y = d·kolumn + e·rad + f. */
export type PixelAffine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
/** Världsfilens sex rader (A, D, B, E, C, F) som `PixelAffine`. */
export function worldFileAffine(text: string): PixelAffine | undefined {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length < 6 || values.slice(0, 6).some(value => !Number.isFinite(value))) return undefined;
  const [a, d, b, e, c, f] = values as [number, number, number, number, number, number];
  return a * e - b * d === 0 ? undefined : [a, b, c, d, e, f];
}

/**
 * Markens medellutning (grader) i ett fönster på cirka `windowMeters` kring en punkt, ur lutningens rutnät. Summorna hålls i
 * en summatabell (integralbild), så varje fråga är fyra uppslag. Inget svar utanför rutnätet eller där fönstret saknar data.
 */
export function flatSlopeFrom(grid: SlopeGrid, affine: PixelAffine, windowMeters = FLAT_WINDOW_METERS): (x: number, y: number) => number | undefined {
  const { columns, rows, steps } = grid, width = columns + 1;
  const sums = new Float64Array(width * (rows + 1)), counts = new Int32Array(width * (rows + 1));
  for (let row = 0; row < rows; row += 1) {
    let sum = 0, count = 0;
    for (let column = 0; column < columns; column += 1) {
      const step = steps[row * columns + column]!;
      if (step < 255) { sum += step; count += 1; }
      const at = (row + 1) * width + column + 1;
      sums[at] = sums[at - width]! + sum; counts[at] = counts[at - width]! + count;
    }
  }
  const [a, b, c, d, e, f] = affine, det = a * e - b * d;
  const reach = Math.max(1, Math.round(windowMeters / Math.hypot(a, d) / 2));
  return (x, y) => {
    const column = Math.round((e * (x - c) - b * (y - f)) / det), row = Math.round((a * (y - f) - d * (x - c)) / det);
    if (!(column >= 0 && row >= 0 && column < columns && row < rows)) return undefined;
    const left = Math.max(0, column - reach), right = Math.min(columns, column + reach + 1), top = Math.max(0, row - reach), bottom = Math.min(rows, row + reach + 1);
    const count = counts[bottom * width + right]! - counts[top * width + right]! - counts[bottom * width + left]! + counts[top * width + left]!;
    if (count === 0) return undefined;
    return (sums[bottom * width + right]! - sums[top * width + right]! - sums[bottom * width + left]! + sums[top * width + left]!) / count * SLOPE_STEP_DEGREES;
  };
}
