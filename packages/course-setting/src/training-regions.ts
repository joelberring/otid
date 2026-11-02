/**
 * Ytorna för träningsformerna (ADR-0192 beslut 2): korridor (kantig eller mjuk), fönster och bälte längs ett avsnitts
 * sträckor. Bitarna (rektanglar per linjesegment, hörn, cirklar) slås ihop till en yta utan överlapp med polygon-clipping
 * (MIT), så att ytan kan klippas jämn–udda både inåt och utåt.
 */
import type { Point } from "@o-tid/map-file";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { legKey } from "./ppen-common";
import type { CourseSettingDocument } from "./types";
import type { CorridorOptions, TrainingSection, WindowOptions } from "./training-types";
import { enumerateCourseControls, legPath, variations } from "./walk";

/** En yta: ringar som fylls jämn–udda. */
export type Region = readonly (readonly Point[])[];

const CIRCLE_SEGMENTS = 48;
/** Kantig korridor: spetsiga hörn högst så här många halva bredder ut (som SVG:s miterlimit). */
const MITER_LIMIT = 3;

/** Meter i terrängen till kartans mm. */
export const metersToMm = (document: CourseSettingDocument, meters: number) => meters * 1000 / document.event.mapScale;

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number) => ({ x: a.x * k, y: a.y * k });
const len = (a: Point) => Math.hypot(a.x, a.y);
const unit = (a: Point) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : { x: 0, y: 0 }; };
const left = (d: Point) => ({ x: -d.y, y: d.x });

/** Cirkeln som polygon. */
export function circlePolygon(center: Point, radius: number, segments = CIRCLE_SEGMENTS): Point[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}

function squarePolygon(center: Point, half: number): Point[] {
  return [{ x: center.x - half, y: center.y - half }, { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half }, { x: center.x - half, y: center.y + half }];
}

/** Linjen utan punkter på samma ställe. */
function clean(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (out.length === 0 || len(sub(p, out[out.length - 1]!)) > 1e-6) out.push(p);
  return out;
}

/** Chaikins hörnklippning (ändpunkterna står kvar, så korridoren går genom kontrollerna). */
export function chaikin(points: readonly Point[], iterations: number): Point[] {
  let current = clean(points);
  for (let n = 0; n < iterations && current.length > 2; n++) {
    const next: Point[] = [current[0]!];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]!, b = current[i + 1]!;
      if (i > 0) next.push(add(mul(a, 0.75), mul(b, 0.25)));
      if (i < current.length - 2) next.push(add(mul(a, 0.25), mul(b, 0.75)));
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

/** Rektangeln längs segmentet, `extendStart`/`extendEnd` mm förlängd. */
function segmentRect(a: Point, b: Point, half: number, extendStart = 0, extendEnd = 0): Point[] {
  const d = unit(sub(b, a));
  const n = mul(left(d), half);
  const p = sub(a, mul(d, extendStart)), q = add(b, mul(d, extendEnd));
  return [add(p, n), add(q, n), sub(q, n), sub(p, n)];
}

/** Hörnet mellan två segment (spetsigt upp till gränsen, annars avfasat), på båda sidor. */
function miterJoin(prev: Point, at: Point, next: Point, half: number): Point[][] {
  const d1 = unit(sub(at, prev)), d2 = unit(sub(next, at));
  const n1 = left(d1), n2 = left(d2);
  const dot = n1.x * n2.x + n1.y * n2.y;
  const out: Point[][] = [];
  for (const side of [1, -1]) {
    const p1 = add(at, mul(n1, side * half)), p2 = add(at, mul(n2, side * half));
    if (1 + dot < 1e-9) { out.push([at, p1, p2]); continue; }
    const miter = add(at, mul(add(n1, n2), (side * half) / (1 + dot)));
    out.push(len(sub(miter, at)) > MITER_LIMIT * half ? [at, p1, p2] : [at, p1, miter, p2]);
  }
  return out;
}

/** Bitarna för en kantig buffert längs linjen (rak ände förlängd en halv bredd). */
function angularPieces(points: readonly Point[], half: (segment: number) => number): Point[][] {
  const line = clean(points);
  if (line.length < 2) return line.length === 1 ? [squarePolygon(line[0]!, half(0))] : [];
  const out: Point[][] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const h = half(i);
    out.push(segmentRect(line[i]!, line[i + 1]!, h, i === 0 ? h : 0, i === line.length - 2 ? h : 0));
  }
  for (let i = 1; i < line.length - 1; i++) out.push(...miterJoin(line[i - 1]!, line[i]!, line[i + 1]!, Math.max(half(i - 1), half(i))));
  return out;
}

/** Bitarna för en rundad buffert (kapslar). */
function roundPieces(points: readonly Point[], half: (segment: number) => number): Point[][] {
  const line = clean(points);
  if (line.length === 0) return [];
  const out: Point[][] = [];
  for (let i = 0; i < line.length - 1; i++) out.push(segmentRect(line[i]!, line[i + 1]!, half(i)));
  line.forEach((p, i) => out.push(circlePolygon(p, Math.max(half(Math.max(0, i - 1)), half(Math.min(line.length - 2, i))), 32)));
  return out;
}

/** Bitarna ihop till en yta utan överlapp (jämn–udda). Koordinaterna avrundas så att unionen blir stabil. */
export function unionRegion(pieces: readonly (readonly Point[])[]): Region {
  const usable = pieces.filter(piece => piece.length >= 3);
  if (usable.length === 0) return [];
  for (const grid of [1e4, 1e3, 1e2]) {
    const snap = (v: number) => Math.round(v * grid) / grid;
    const polygons: Polygon[] = usable.map(piece => [piece.map(p => [snap(p.x), snap(p.y)] as [number, number])]);
    try {
      const result: MultiPolygon = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
      return result.flatMap(polygon => polygon.map(ring => ring.map(([x, y]) => ({ x, y }))));
    } catch {
      // Unionen kan misslyckas för nästan sammanfallande kanter; grövre avrundning brukar räcka.
    }
  }
  throw new Error("Träningsytan gick inte att räkna ut");
}

/** Kontrollföljden för banan: en lista per variant (alla grenar), eller den valda. */
export function controlSequences(document: CourseSettingDocument, course: string, variant: string | undefined): string[][] {
  const all = variations(document, course);
  if (variant) {
    const found = all.find(item => item.code === variant);
    return [enumerateCourseControls(document, course, found?.choices ?? null)];
  }
  return all.length > 0 ? all.map(item => enumerateCourseControls(document, course, item.choices)) : [enumerateCourseControls(document, course, null)];
}

/** Positionen för banans kontroll i följden: samma id, annars samma kontroll (andra grenar), annars `undefined`. */
function positionOf(document: CourseSettingDocument, sequence: readonly string[], ccId: string, from = 0): number | undefined {
  const exact = sequence.indexOf(ccId, from);
  if (exact >= 0) return exact;
  const control = document.courseControls[ccId]?.control;
  if (control === undefined) return undefined;
  const index = sequence.findIndex((id, i) => i >= from && document.courseControls[id]?.control === control);
  return index >= 0 ? index : undefined;
}

/** Avsnittets positioner i följden (inklusive), eller `undefined` när det inte finns i följden. */
export function sectionRange(document: CourseSettingDocument, sequence: readonly string[], section: Pick<TrainingSection, "from" | "to">):
  { start: number; end: number } | undefined {
  if (sequence.length === 0) return undefined;
  const start = section.from === null ? 0 : positionOf(document, sequence, section.from);
  if (start === undefined) return undefined;
  const end = section.to === null ? sequence.length - 1 : positionOf(document, sequence, section.to, start) ?? sequence.length - 1;
  return end >= start ? { start, end } : undefined;
}

/** Avsnittets sträckor som linjer (kontrollernas id och punkter med brytpunkter). */
export function sectionLegs(document: CourseSettingDocument, sequence: readonly string[], range: { start: number; end: number }):
  { from: string; to: string; points: Point[] }[] {
  const out: { from: string; to: string; points: Point[] }[] = [];
  for (let i = range.start; i < range.end; i++) {
    const from = document.courseControls[sequence[i]!]?.control, to = document.courseControls[sequence[i + 1]!]?.control;
    if (from === undefined || to === undefined || from === to) continue;
    out.push({ from, to, points: legPath(document, from, to) });
  }
  return out;
}

function corridorPieces(document: CourseSettingDocument, legs: ReturnType<typeof sectionLegs>, options: CorridorOptions): Point[][] {
  const halfOf = (from: string, to: string) => metersToMm(document, options.legWidths?.[legKey(from, to)] ?? options.widthMeters) / 2;
  if (options.shape === "SMOOTH") {
    const iterations = Math.round(Math.max(0, Math.min(1, options.smoothing)) * 4);
    return legs.flatMap(leg => roundPieces(chaikin(leg.points, iterations), () => halfOf(leg.from, leg.to)));
  }
  // Kantig: hela avsnittet som en linje, så att hörnen vid kontrollerna blir spetsiga.
  const line: Point[] = [];
  const halves: number[] = [];
  for (const leg of legs) {
    const points = line.length === 0 ? leg.points : leg.points.slice(1);
    for (let i = 0; i < points.length; i++) {
      if (line.length > 0) halves.push(halfOf(leg.from, leg.to));
      line.push(points[i]!);
    }
  }
  return angularPieces(line, segment => halves[Math.min(segment, halves.length - 1)] ?? 0);
}

function windowPieces(document: CourseSettingDocument, sequence: readonly string[], range: { start: number; end: number }, options: WindowOptions): Point[][] {
  const radius = metersToMm(document, options.radiusMeters);
  const seen = new Set<string>();
  const out: Point[][] = [];
  for (let i = range.start; i <= range.end; i++) {
    const control = document.controls[document.courseControls[sequence[i]!]?.control ?? ""];
    if (!control || seen.has(control.id)) continue;
    seen.add(control.id);
    out.push(options.shape === "SQUARE" ? squarePolygon(control.at, radius) : circlePolygon(control.at, radius));
  }
  return out;
}

export const DEFAULT_BAND_METERS = 300;

/** Bitarna för avsnittets yta i en kontrollföljd. */
export function sectionPieces(document: CourseSettingDocument, sequence: readonly string[], section: TrainingSection): Point[][] {
  const range = sectionRange(document, sequence, section);
  if (!range) return [];
  switch (section.form) {
    case "CORRIDOR": return corridorPieces(document, sectionLegs(document, sequence, range),
      section.corridor ?? { shape: "ANGULAR", widthMeters: 50, smoothing: 0 });
    case "WINDOW": return windowPieces(document, sequence, range, section.window ?? { shape: "CIRCLE", radiusMeters: 50 });
    case "BAND": case "NO_MAP": {
      const half = metersToMm(document, section.bandMeters ?? DEFAULT_BAND_METERS) / 2;
      const legs = sectionLegs(document, sequence, range);
      if (legs.length === 0) return windowPieces(document, sequence, range, { shape: "CIRCLE", radiusMeters: section.bandMeters ?? DEFAULT_BAND_METERS / 2 });
      return legs.flatMap(leg => roundPieces(leg.points, () => half));
    }
  }
}

/** Avsnittets yta för banan och varianten (alla grenar: unionen av varianternas ytor). */
export function sectionRegion(document: CourseSettingDocument, course: string, variant: string | undefined, section: TrainingSection): Region {
  return unionRegion(controlSequences(document, course, variant).flatMap(sequence => sectionPieces(document, sequence, section)));
}
