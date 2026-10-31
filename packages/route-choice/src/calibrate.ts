/**
 * Steg 60 (ADR-0179 beslut 13): farterna kalibreras mot löparnas GPS-rutter.
 *
 * Varje spår delas i segment på ungefär 40 m. För varje segment räknas hur många meter som går i varje klass (ur samma
 * rutnät som analysen) och hur många höjdkurvor det korsar. Modellen är att segmentets tid är löparens egen faktor
 * (per `runner`, annars en gemensam) gånger summan av meter × tid per meter för klassen (stigningen räknas som meter
 * normal skog). Tiden per meter per
 * klass skattas med minsta kvadrat, löparfaktorerna växelvis, och segment med stora avvikelser (mer än 3 × MAD)
 * räknas bort i några varv (robust mot GPS-brus och stopp). Segment med orimlig fart, GPS-hopp eller mycket tid i ej
 * passerbar mark räknas bort från början.
 *
 * Farterna är relativa: normal skog behåller sin fart när den har tillräckligt med data, annars den klass som har mest
 * data. Klasser med för lite data behåller sitt värde.
 */
import type { Point } from "@o-tid/map-file";
import { preparedOf } from "./cost-model";
import { RUNNABLE_CLASSES, resolveSettings, type RunnableClass } from "./defaults";
import { boxFrame, BLOCKED, cellClass, cellOf, rasterize, type Grid } from "./raster";
import type { CalibrationResult, CalibrationSample, CostModel, RouteChoiceSettings } from "./types";

/** Segmentlängd i terrängen. */
export const SEGMENT_METERS = 40;
/** Rimlig fart för ett segment (m/s): långsammare är stopp, snabbare är fel. */
const MIN_SEGMENT_SPEED = 0.4;
const MAX_SEGMENT_SPEED = 8;
/** Fart mellan två GPS-punkter som räknas som ett hopp. */
const MAX_POINT_SPEED = 12;
/** Andel av segmentet i ej passerbar mark som tolereras (GPS-fel längs hus och staket). */
const MAX_BLOCKED_SHARE = 0.25;
/** Minsta data för att skatta en klass. */
export const MIN_CLASS_METERS = 300;
export const MIN_CLASS_SEGMENTS = 8;
/** En klass räknas in i ett segment från så här stor andel. */
const SHARE_FOR_COUNT = 0.25;
const ROUNDS = 4;
/** GPS-noggrannhet: punkter inom så här många meter från en väg eller stig räknas som på den. */
export const GPS_TRACK_METERS = 6;

interface Segment {
  /** Löparens grupp (samma löpare = samma faktor). */
  readonly group: string;
  readonly sample: number;
  readonly seconds: number;
  /** Meter per klass (index i `RUNNABLE_CLASSES`); stigningen ligger som meter i NORMAL. */
  readonly meters: Float64Array;
  readonly length: number;
  used: boolean;
}

function frameFor(points: readonly Point[], scale: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const margin = 30 * 1000 / scale;
  return boxFrame({ minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }, scale, 2_000_000);
}

/** Meter per klass längs polylinjen, stigningsenheter och meter i ej passerbart. */
function measure(grid: Grid, points: readonly Point[], speeds: Readonly<Record<RunnableClass, number>>, mmPerMeter: number) {
  const meters = new Float64Array(RUNNABLE_CLASSES.length);
  let blocked = 0, climbUnits = 0, previousContour = -1;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!, b = points[index]!;
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(lengthMm / (grid.cellMm / 2)));
    const stepMeters = lengthMm / steps / mmPerMeter;
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const { col, row } = cellOf(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;
      const cell = row * grid.width + col;
      const cls = cellClass(grid, cell, speeds);
      if (cls === BLOCKED) blocked += stepMeters; else meters[cls] = meters[cls]! + stepMeters;
      const contour = grid.contour[cell]!;
      if (previousContour >= 0) climbUnits += Math.abs(contour - previousContour);
      previousContour = contour;
    }
  }
  return { meters, blocked, climbUnits };
}

/** Utjämningens fönster (s åt varje håll): GPS-brus ger annars sicksack som gör vägen längre än den är. */
const SMOOTH_SECONDS = 4;

/**
 * Glidande medelvärde i tid (±4 s) av positionerna. Hopp (orimlig fart mellan två punkter) jämnas inte ut utan bryter
 * fönstret, så att de räknas bort som hopp senare.
 */
function smooth(points: readonly { x: number; y: number; ms: number }[], mmPerMeter: number) {
  const out: { x: number; y: number; ms: number }[] = [];
  const jumpBefore = points.map((p, index) => {
    if (index === 0) return false;
    const q = points[index - 1]!;
    const seconds = (p.ms - q.ms) / 1000;
    return seconds <= 0 || Math.hypot(p.x - q.x, p.y - q.y) / mmPerMeter / seconds > MAX_POINT_SPEED;
  });
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index]!;
    let sx = p.x, sy = p.y, n = 1;
    for (let k = index - 1; k >= 0 && !jumpBefore[k + 1] && p.ms - points[k]!.ms <= SMOOTH_SECONDS * 1000; k -= 1) { sx += points[k]!.x; sy += points[k]!.y; n += 1; }
    for (let k = index + 1; k < points.length && !jumpBefore[k] && points[k]!.ms - p.ms <= SMOOTH_SECONDS * 1000; k += 1) { sx += points[k]!.x; sy += points[k]!.y; n += 1; }
    out.push(jumpBefore[index] || (index + 1 < points.length && jumpBefore[index + 1]) ? { ...p } : { x: sx / n, y: sy / n, ms: p.ms });
  }
  return out;
}

/** Löser A x = b (liten, symmetrisk) med Gausselimination; `null` om singulär. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k += 1) a[row]![k]! -= factor * a[col]![k]!;
    }
  }
  return a.map((row, index) => row[n]! / row[index]!);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Föreslagna farter ur GPS-rutterna. Proven är i kartans mm med tid i ms (webben räknar om GPX med `wgs84ToMapPoint`).
 * Rena funktioner: inget sparas.
 */
export function calibrateSpeeds(model: CostModel, samples: readonly CalibrationSample[], settings?: RouteChoiceSettings | null): CalibrationResult {
  const prepared = preparedOf(model, settings);
  const resolved = settings ? resolveSettings({ ...settings, classBySymbol: {} }) : prepared.settings;
  const speeds = resolved.speedByClass;
  const mmPerMeter = 1000 / prepared.scale;
  const climbMetersPerUnit = resolved.contourIntervalMeters * resolved.climbFactor / 4;
  const normal = RUNNABLE_CLASSES.indexOf("NORMAL");
  const segments: Segment[] = [];
  let rejected = 0;

  samples.forEach((sample, sampleIndex) => {
    const points = smooth(sample.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.ms)), mmPerMeter);
    if (points.length < 2) return;
    const grid = rasterize(prepared, frameFor(points, prepared.scale), speeds, { trackRadiusMm: GPS_TRACK_METERS * mmPerMeter });
    let start = 0, length = 0, jump = false;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!, b = points[index]!;
      const meters = Math.hypot(b.x - a.x, b.y - a.y) / mmPerMeter;
      const seconds = (b.ms - a.ms) / 1000;
      if (seconds <= 0 || meters / seconds > MAX_POINT_SPEED) jump = true;
      length += meters;
      if (length < SEGMENT_METERS && index < points.length - 1) continue;
      const part = points.slice(start, index + 1);
      const totalSeconds = (b.ms - points[start]!.ms) / 1000;
      const speed = totalSeconds > 0 ? length / totalSeconds : Infinity;
      if (length >= SEGMENT_METERS / 2) {
        const measured = measure(grid, part, speeds, mmPerMeter);
        if (jump || speed < MIN_SEGMENT_SPEED || speed > MAX_SEGMENT_SPEED || measured.blocked > MAX_BLOCKED_SHARE * length) rejected += 1;
        else {
          measured.meters[normal] = measured.meters[normal]! + measured.climbUnits * climbMetersPerUnit;
          segments.push({ group: sample.runner ?? "", sample: sampleIndex, seconds: totalSeconds, meters: measured.meters, length, used: true });
        }
      }
      start = index; length = 0; jump = false;
    }
  });

  // Klasser med tillräckligt med data skattas; ankaret behåller sin fart.
  const totals = RUNNABLE_CLASSES.map((_, cls) => segments.reduce((sum, s) => sum + s.meters[cls]!, 0));
  const counts = RUNNABLE_CLASSES.map((_, cls) => segments.filter(s => s.meters[cls]! >= SHARE_FOR_COUNT * s.length).length);
  const enough = RUNNABLE_CLASSES.map((_, cls) => totals[cls]! >= MIN_CLASS_METERS && counts[cls]! >= MIN_CLASS_SEGMENTS);
  let anchor = enough[normal] ? normal : -1;
  if (anchor < 0) for (let cls = 0; cls < RUNNABLE_CLASSES.length; cls += 1) if (enough[cls] && (anchor < 0 || totals[cls]! > totals[anchor]!)) anchor = cls;
  const free = RUNNABLE_CLASSES.map((_, cls) => enough[cls]! && cls !== anchor);
  const pace = RUNNABLE_CLASSES.map(cls => 1 / speeds[cls]);
  const runner = new Map<string, number>();
  const predicted = (s: Segment) => s.meters.reduce((sum, m, cls) => sum + m * pace[cls]!, 0);

  if (anchor >= 0 && free.some(Boolean)) {
    for (let round = 0; round < ROUNDS; round += 1) {
      // Löparfaktor: median av tid / förväntad tid per löpare.
      const ratios = new Map<string, number[]>();
      for (const s of segments) if (s.used) { const list = ratios.get(s.group) ?? []; list.push(s.seconds / predicted(s)); ratios.set(s.group, list); }
      for (const [group, list] of ratios) runner.set(group, median(list));
      // Minsta kvadrat för de fria klasserna, de andra flyttas till höger sida.
      const columns = RUNNABLE_CLASSES.map((_, cls) => cls).filter(cls => free[cls]);
      const ata = columns.map(() => columns.map(() => 0));
      const atb = columns.map(() => 0);
      for (const s of segments) {
        if (!s.used) continue;
        const factor = runner.get(s.group) ?? 1;
        let y = s.seconds / factor;
        for (let cls = 0; cls < RUNNABLE_CLASSES.length; cls += 1) if (!free[cls]) y -= s.meters[cls]! * pace[cls]!;
        // Vikt 1/längd: segmenten är ungefär lika långa, och långa segment ska inte dominera.
        const weight = 1 / Math.max(1, s.length);
        columns.forEach((ci, i) => {
          atb[i]! += weight * s.meters[ci]! * y;
          columns.forEach((cj, j) => { ata[i]![j]! += weight * s.meters[ci]! * s.meters[cj]!; });
        });
      }
      const solution = solve(ata, atb);
      if (!solution) break;
      columns.forEach((cls, i) => {
        const value = solution[i]!;
        // Fart mellan 0,05 och 3 gånger normal skog; annars behålls förra värdet.
        if (value > 1 / 3 && value < 20) pace[cls] = value;
      });
      // Avvikare: relativt fel mer än 3 × MAD räknas bort till nästa varv.
      const errors = segments.map(s => {
        const factor = runner.get(s.group) ?? 1;
        return Math.abs(s.seconds - factor * predicted(s)) / s.seconds;
      });
      const mad = median(errors.filter((_, i) => segments[i]!.used));
      const limit = Math.max(0.05, 3 * mad);
      segments.forEach((s, i) => { s.used = errors[i]! <= limit; });
    }
  }

  const used = segments.filter(s => s.used);
  const speedByClass = { ...speeds } as Record<RunnableClass, number>;
  const perClass = {} as Record<RunnableClass, { segments: number; meters: number; estimated: boolean }>;
  RUNNABLE_CLASSES.forEach((cls, index) => {
    const estimated = free[index]! && runner.size > 0;
    if (estimated) speedByClass[cls] = Math.round(1000 / pace[index]!) / 1000;
    perClass[cls] = {
      segments: used.filter(s => s.meters[index]! >= SHARE_FOR_COUNT * s.length).length,
      meters: Math.round(used.reduce((sum, s) => sum + s.meters[index]!, 0)),
      estimated
    };
  });
  const anyEstimated = RUNNABLE_CLASSES.some(cls => perClass[cls].estimated);
  const samplesUsed = new Set(used.map(s => s.sample)).size;
  const reliability = !anyEstimated ? "NONE" : used.length >= 300 && samplesUsed >= 10 ? "HIGH"
    : used.length >= 80 && samplesUsed >= 3 ? "MEDIUM" : "LOW";
  return {
    speedByClass, perClass, reliability, samplesUsed, segmentsUsed: used.length,
    segmentsRejected: rejected + (segments.length - used.length)
  };
}
