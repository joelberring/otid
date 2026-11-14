import type { SourceFeature } from "../index";
import type { PixelAffine } from "./flat-contours";
import { blend } from "./knoll-choice";
import type { PhotoPixels } from "./photo-interpret";
import { ringArea } from "./small-rings";

/**
 * Ägaren 2026-11-14 («det finns en kritik mot autogenererade kartor att det är plottrigt och att läsbarheten tappas … jämföra
 * mot bra kartritare för att kunna göra medvetna generaliseringar … kartor kan ju både ha flacka och mer detaljerade delar»):
 * tre reglage för en tydligare kurvbild, mätta mot tre kartritares kartor (Högdalen, Gömmaren, Djurgården) över samma laser.
 *
 * - **Mjukare kurvor på flack mark** (`smooth`): kartritarna svänger 12–27 % mindre än lasern där marken lutar under 6 %, lika
 *   mycket vid 6–25 % och mer i brant. Kurvan jämnas därför ut längs sig själv (Gauss) bara där marken är flack, fullt under
 *   `fullSlope` och inte alls över `noSlope`. En punkt flyttas aldrig till mark som ligger mer än `SMOOTH_MAX_RISE` m (en
 *   fjärdedel av ekvidistansen 5 m, ISOM 2017-2 § 101) från där den låg; hjälpkurvor hälften. Då kan två kurvor inte mötas.
 * - **Färre hjälpkurvor** (`formlines`): kartritarna har 41–64 % av laserns hjälpkurvor. Det som bäst skiljer de behållna
 *   är att marken är en höjd i stort (höjden över medelhöjden på en ring 60 m bort, AUC 0,61–0,65), och i brant där kurvorna
 *   redan ligger tätt behålls få. Hjälpkurvan klipps där marken inte är en höjd (`minConvex`) eller en höjdkurva ligger
 *   närmare än `tight` m, minst `CLEAR_CUT_METERS` i sträck; rester under `CLEAR_KEEP_METERS` tas bort.
 * - **Små ringar av hjälpkurva** (`rings`): lasern ger 196–613 slutna hjälpkurvor där kartritarna har 49–453, och ingen form
 *   på marken skilde de behållna från de andra. De under `ringM2` tas bort.
 *
 * Bara borttagning och utjämning: inget ritas dit. Ren kod utan I/O (webbläsaren och servern). Koordinater i meter.
 */
export interface ClearSettings { readonly smooth: number; readonly formlines: number; readonly rings: number }
/** Förvalen på skalan 0–10 (0 = av): ungefär kartritarnas mått på de tre kartorna. */
export const DEFAULT_CLEAR: ClearSettings = { smooth: 5, formlines: 5, rings: 5 };

export interface SmoothLimits { readonly sigma: number; readonly fullSlope: number; readonly noSlope: number }
export interface FormlineLimits { readonly minConvex: number; readonly tight: number }
const between = <L extends object>(level: number, low: L, mid: L, high: L): L | undefined =>
  !(level >= 1) ? undefined : level < 5 ? blend(low, mid, (level - 1) / 4) : blend(mid, high, (level - 5) / 5);
/** Utjämningens längd (m) och lutningarna (andel, 0,04 = 4 %) där den är full och där den upphör. */
export const smoothLimitsAt = (level: number): SmoothLimits | undefined =>
  between(level, { sigma: 6, fullSlope: 0.03, noSlope: 0.08 }, { sigma: 15, fullSlope: 0.04, noSlope: 0.12 }, { sigma: 25, fullSlope: 0.05, noSlope: 0.2 });
/** Minsta höjd över omgivningen (m) för att en hjälpkurva ska stå kvar, och avståndet till en höjdkurva (m) där den tas bort. */
export const formlineLimitsAt = (level: number): FormlineLimits | undefined =>
  between(level, { minConvex: -1, tight: 0 }, { minConvex: 0, tight: 5 }, { minConvex: 1, tight: 7.5 });
/** Ytan (m²) som en sluten hjälpkurva minst ska ha för att stå kvar. */
export const ringLimitAt = (level: number): number | undefined =>
  between(level, { ringM2: 25 }, { ringM2: 150 }, { ringM2: 800 })?.ringM2;

export const SMOOTH_MAX_RISE = 1.25, CLEAR_CUT_METERS = 20, CLEAR_KEEP_METERS = 30;
/** Radien (m) på ringen som markens höjd jämförs med. */
export const CONVEX_RADIUS = 60;
const SMOOTH_STEP = 2.5, SAMPLE = 5, SLOPE_REACH = 3, TOLERANCE = 0.25;
const CONTOUR = /^(contour|depression)(_index)?$/i, FORMLINE = /^formline$/i, SMOOTHED = /^(contour(_index)?|formline)$/i;
type Position = readonly [number, number];

/** Markens höjd, lutning (andel) och höjd över omgivningen i en punkt; inget svar utanför data. */
export interface HeightField {
  readonly heightAt: (x: number, y: number) => number | undefined;
  readonly slopeAt: (x: number, y: number) => number | undefined;
  readonly convexAt: (x: number, y: number) => number | undefined;
}
/** Markens höjd (m) i ett rutnät rad för rad norrifrån; NaN utan data. */
export interface HeightGrid { readonly columns: number; readonly rows: number; readonly meters: Float32Array }
/** Höjden ur laserkörningens bild `hojd.png`: cm + 10 000 som 24 bitar (R·65536 + G·256 + B), genomskinligt = utan data. */
export function heightGridOf(pixels: PhotoPixels): HeightGrid {
  const { width: columns, height: rows, data } = pixels, meters = new Float32Array(columns * rows).fill(NaN);
  for (let p = 0; p < meters.length; p += 1) {
    if (data[p * 4 + 3]! >= 128) meters[p] = (data[p * 4]! * 65536 + data[p * 4 + 1]! * 256 + data[p * 4 + 2]! - 10_000) / 100;
  }
  return { columns, rows, meters };
}

/** Höjdfältet ur ett eller flera rutnät (etapper): det första som har data i punkten svarar. */
export function heightFieldFrom(parts: readonly { readonly grid: HeightGrid; readonly affine: PixelAffine }[]): HeightField {
  const readers = parts.map(({ grid, affine: [a, b, c, d, e, f] }) => {
    const det = a * e - b * d;
    return (x: number, y: number): number => {
      const column = Math.round((e * (x - c) - b * (y - f)) / det), row = Math.round((a * (y - f) - d * (x - c)) / det);
      return column >= 0 && row >= 0 && column < grid.columns && row < grid.rows ? grid.meters[row * grid.columns + column]! : NaN;
    };
  });
  const raw = (x: number, y: number): number => {
    for (const read of readers) { const z = read(x, y); if (z === z) return z; }
    return NaN;
  };
  const ring = Array.from({ length: 16 }, (_, index) => [Math.cos(index * Math.PI / 8) * CONVEX_RADIUS, Math.sin(index * Math.PI / 8) * CONVEX_RADIUS] as const);
  return {
    heightAt: (x, y) => { const z = raw(x, y); return z === z ? z : undefined; },
    slopeAt: (x, y) => {
      const dx = (raw(x + SLOPE_REACH, y) - raw(x - SLOPE_REACH, y)) / (2 * SLOPE_REACH), dy = (raw(x, y + SLOPE_REACH) - raw(x, y - SLOPE_REACH)) / (2 * SLOPE_REACH);
      const slope = Math.hypot(dx, dy);
      return slope === slope ? slope : undefined;
    },
    convexAt: (x, y) => {
      const z = raw(x, y);
      if (z !== z) return undefined;
      let sum = 0, count = 0;
      for (const [dx, dy] of ring) { const other = raw(x + dx, y + dy); if (other === other) { sum += other; count += 1; } }
      return count >= 12 ? z - sum / count : undefined;
    }
  };
}

export interface ClearResult {
  readonly features: SourceFeature[];
  /** Meter kurva som jämnats ut, meter hjälpkurva som tagits bort och antalet små ringar som tagits bort. */
  readonly smoothedMeters: number; readonly formlineMeters: number; readonly rings: number;
  /** Det som togs bort eller byttes ut (ursprungliga objekt) och det som kom i stället, för `restoreFlatContours`. */
  readonly removed: SourceFeature[]; readonly added: SourceFeature[];
}

const lengthOf = (points: readonly Position[]) => points.reduce((sum, point, index) => index === 0 ? 0 : sum + Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]), 0);
/** Punkter med jämna steg (högst `step` m) längs linjen; första och sista punkten står kvar. */
function resample(points: readonly Position[], step: number): Position[] {
  const total = lengthOf(points), count = Math.max(1, Math.ceil(total / step)), out: Position[] = [points[0]!];
  let index = 1, before = 0;
  for (let k = 1; k < count; k += 1) {
    const target = total * k / count;
    let span = Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
    while (index < points.length - 1 && before + span < target) {
      before += span; index += 1;
      span = Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
    }
    const t = span > 0 ? (target - before) / span : 0, from = points[index - 1]!, to = points[index]!;
    out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Douglas–Peucker: punkterna som behövs för att linjen inte ska avvika mer än `tolerance`. */
function thin(points: readonly Position[], tolerance: number): Position[] {
  const keep = new Uint8Array(points.length), stack: [number, number][] = [[0, points.length - 1]];
  keep[0] = 1; keep[points.length - 1] = 1;
  while (stack.length > 0) {
    const [from, to] = stack.pop()!, a = points[from]!, b = points[to]!, span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let worst = 0, at = -1;
    for (let i = from + 1; i < to; i += 1) {
      const p = points[i]!;
      const distance = span > 0 ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / span : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (distance > worst) { worst = distance; at = i; }
    }
    if (at >= 0 && worst > tolerance) { keep[at] = 1; stack.push([from, at], [at, to]); }
  }
  return points.filter((_, index) => keep[index]);
}

const isClosed = (points: readonly Position[], closed: boolean) => points.length >= 3
  && (closed || (points.length > 3 && Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]) < 0.01));

/** Linjen utjämnad där marken är flack, eller inget när ingen punkt flyttas. */
function smoothLine(points: readonly Position[], closed: boolean, field: HeightField, limits: SmoothLimits, maxRise: number): { points: Position[]; meters: number } | undefined {
  const path = closed && Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]) >= 0.01 ? [...points, points[0]!] : points;
  const samples = resample(path, SMOOTH_STEP), count = samples.length;
  if (count < 5) return undefined;
  // Slutna linjer räknas runt varvet (sista provet är det första igen).
  const turn = count - 1, at = (index: number) => closed ? ((index % turn) + turn) % turn : Math.min(count - 1, Math.max(0, index));
  const slopes = samples.map(([x, y]) => field.slopeAt(x, y));
  const out: Position[] = [];
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    const here = samples[i]!;
    let sum = 0, known = 0;
    for (let k = -6; k <= 6; k += 1) {
      if (!closed && (i + k < 0 || i + k >= count)) continue;
      const slope = slopes[at(i + k)];
      if (slope !== undefined) { sum += slope; known += 1; }
    }
    const share = known === 0 ? 0 : Math.min(1, Math.max(0, (limits.noSlope - sum / known) / (limits.noSlope - limits.fullSlope)));
    const sigma = limits.sigma * share, origin = field.heightAt(here[0], here[1]);
    if (sigma < 1 || origin === undefined || (!closed && (i === 0 || i === count - 1))) { out.push(here); continue; }
    const reach = Math.ceil(2.5 * sigma / SMOOTH_STEP);
    let x = 0, y = 0, weights = 0;
    for (let k = -reach; k <= reach; k += 1) {
      const sample = samples[at(i + k)]!, weight = Math.exp(-0.5 * (k * SMOOTH_STEP / sigma) ** 2);
      x += weight * sample[0]; y += weight * sample[1]; weights += weight;
    }
    x /= weights; y /= weights;
    // Halvera flytten tills marken där ligger nära nog i höjd; annars står punkten kvar.
    let next: Position = here;
    for (let t = 1; t > 0.1; t /= 2) {
      const tx = here[0] + (x - here[0]) * t, ty = here[1] + (y - here[1]) * t, z = field.heightAt(tx, ty);
      if (z !== undefined && Math.abs(z - origin) <= maxRise) { next = [tx, ty]; break; }
    }
    if (Math.hypot(next[0] - here[0], next[1] - here[1]) > 0.05) moved += 1;
    out.push(next);
  }
  if (moved === 0) return undefined;
  if (closed) out[count - 1] = out[0]!;
  return { points: thin(out, TOLERANCE), meters: moved * SMOOTH_STEP };
}

/** Avståndet (m) till närmaste prov på en höjdkurva, uppslaget i rutor om `cell` m; större än `cell` ger `Infinity`. */
function contourDistance(features: readonly SourceFeature[], cell: number): (x: number, y: number) => number {
  const cells = new Map<number, number[]>(), key = (cx: number, cy: number) => cx * 2_000_003 + cy;
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.geometry.points.length < 2 || !CONTOUR.test(feature.layer)) continue;
    for (const [x, y] of resample(feature.geometry.points, 2)) {
      const k = key(Math.floor(x / cell), Math.floor(y / cell)), list = cells.get(k);
      if (list) list.push(x, y); else cells.set(k, [x, y]);
    }
  }
  return (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      const list = cells.get(key(cx + ax, cy + ay));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) best = Math.min(best, Math.hypot(list[i]! - x, list[i + 1]! - y));
    }
    return best <= cell ? best : Infinity;
  };
}

/** Bitarna av en hjälpkurva som står kvar, eller inget när ingenting klipps. */
function keptPieces(points: readonly Position[], drop: (x: number, y: number) => boolean): Position[][] | undefined {
  const samples = resample(points, SAMPLE), step = lengthOf(points) / (samples.length - 1), cut = new Uint8Array(samples.length);
  let any = false;
  for (let i = 0; i < samples.length; i += 1) {
    if (!drop(samples[i]![0], samples[i]![1])) continue;
    let j = i;
    while (j + 1 < samples.length && drop(samples[j + 1]![0], samples[j + 1]![1])) j += 1;
    if ((j - i) * step >= CLEAR_CUT_METERS) { cut.fill(1, i, j + 1); any = true; }
    i = j;
  }
  if (!any) return undefined;
  const pieces: Position[][] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (cut[i]) continue;
    let j = i;
    while (j + 1 < samples.length && !cut[j + 1]) j += 1;
    if ((j - i) * step >= CLEAR_KEEP_METERS) pieces.push(thin(samples.slice(i, j + 1), TOLERANCE));
    i = j;
  }
  return pieces;
}

/**
 * Grundkartans objekt (meter) med tydligare kurvbild. Objekt som inte berörs lämnas som de är (samma objekt), i samma
 * ordning. Utan höjd i en punkt rörs ingenting där. Nivå 0 stänger av ett reglage.
 */
export function clearContours(features: readonly SourceFeature[], field: HeightField, settings: ClearSettings): ClearResult {
  const smooth = smoothLimitsAt(settings.smooth), formlines = formlineLimitsAt(settings.formlines), ringM2 = ringLimitAt(settings.rings);
  const removed: SourceFeature[] = [], added: SourceFeature[] = [];
  let smoothedMeters = 0, formlineMeters = 0, rings = 0;
  const near = formlines && formlines.tight > 0 ? contourDistance(features, Math.max(10, formlines.tight)) : undefined;
  const drop = formlines && ((x: number, y: number) => {
    const convex = field.convexAt(x, y);
    return (convex !== undefined && convex < formlines.minConvex) || (near !== undefined && near(x, y) < formlines.tight);
  });
  const out = features.flatMap((feature): SourceFeature[] => {
    const geometry = feature.geometry;
    if (geometry.kind !== "line" || geometry.points.length < 2 || !SMOOTHED.test(feature.layer)) return [feature];
    const formline = FORMLINE.test(feature.layer), closed = isClosed(geometry.points, geometry.closed);
    let pieces: { points: readonly Position[]; closed: boolean }[] = [{ points: geometry.points, closed }], changed = false;
    if (formline && closed && ringM2 !== undefined && ringArea(geometry.points) < ringM2) { rings += 1; removed.push(feature); return []; }
    if (formline && drop) {
      const kept = keptPieces(geometry.closed ? [...geometry.points, geometry.points[0]!] : geometry.points, drop);
      if (kept) {
        formlineMeters += lengthOf(geometry.points) - kept.reduce((sum, piece) => sum + lengthOf(piece), 0);
        pieces = kept.map(points => ({ points, closed: false })); changed = true;
      }
    }
    if (smooth) pieces = pieces.map(piece => {
      const result = smoothLine(piece.points, piece.closed, field, smooth, formline ? SMOOTH_MAX_RISE / 2 : SMOOTH_MAX_RISE);
      if (!result) return piece;
      smoothedMeters += result.meters; changed = true;
      // En linje som är sluten i sig (`closed`) har inte första punkten en gång till sist.
      return { points: piece.closed && geometry.closed ? result.points.slice(0, -1) : result.points, closed: piece.closed };
    });
    if (!changed) return [feature];
    const next = pieces.map((piece): SourceFeature => ({ ...feature, geometry: { kind: "line", closed: piece.closed && geometry.closed, points: piece.points } }));
    removed.push(feature); added.push(...next);
    return next;
  });
  return { features: out, smoothedMeters: Math.round(smoothedMeters), formlineMeters: Math.round(formlineMeters), rings, removed, added };
}
