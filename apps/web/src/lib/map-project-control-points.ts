import { mapPointToProjected, type MapGeoreference, type Point } from "@o-tid/map-file";
import type { Affine } from "./map-project-layers";
import type { Bounds } from "./course-setting-viewport";

/**
 * ADR-0219 K6b: passpunkter för ett underlag (en skannad karta, en gammal flygbild). Varje passpunkt är en pixel i bilden och
 * platsen där den ska ligga på kartan (kartans mm). Med två punkter blir transformen likformig (flytt, vridning och en skala),
 * med tre eller fler affin (också olika skala på ledderna och snedhet), räknad med minsta kvadrat. Restavvikelserna visar hur
 * väl punkterna passar; en punkt med stor avvikelse är troligen fel klickad.
 */
export interface ControlPoint { readonly pixel: Point; readonly map: Point }
export type FitKind = "similarity" | "affine";
export interface Fit {
  readonly kind: FitKind;
  /** Bildens pixlar → kartans mm. */
  readonly toMap: Affine;
  /** Avvikelse per punkt i kartans mm, och kvadratiskt medel. */
  readonly residuals: readonly number[];
  readonly rms: number;
}

const apply = (t: Affine, p: Point): Point => ({ x: t.a * p.x + t.b * p.y + t.c, y: t.d * p.x + t.e * p.y + t.f });

/** Ett 3×3-system (Cramers regel); undefined om det saknar lösning (punkterna på en linje). */
function solve3(m: readonly (readonly number[])[], v: readonly number[]): [number, number, number] | undefined {
  const det = (a: readonly (readonly number[])[]) => a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!)
    - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return undefined;
  const column = (index: number) => m.map((row, r) => row.map((value, c) => c === index ? v[r]! : value));
  return [det(column(0)) / d, det(column(1)) / d, det(column(2)) / d];
}

function affineFit(points: readonly ControlPoint[]): Affine | undefined {
  // Normalekvationerna för x' = a·u + b·v + c (och lika för y'), med pixlarna centrerade för noggrannhetens skull.
  const cu = points.reduce((sum, p) => sum + p.pixel.x, 0) / points.length, cv = points.reduce((sum, p) => sum + p.pixel.y, 0) / points.length;
  let uu = 0, uv = 0, vv = 0, u1 = 0, v1 = 0;
  const xr = [0, 0, 0], yr = [0, 0, 0];
  for (const p of points) {
    const u = p.pixel.x - cu, v = p.pixel.y - cv;
    uu += u * u; uv += u * v; vv += v * v; u1 += u; v1 += v;
    xr[0]! += u * p.map.x; xr[1]! += v * p.map.x; xr[2]! += p.map.x;
    yr[0]! += u * p.map.y; yr[1]! += v * p.map.y; yr[2]! += p.map.y;
  }
  const m = [[uu, uv, u1], [uv, vv, v1], [u1, v1, points.length]];
  const x = solve3(m, xr), y = solve3(m, yr);
  if (!x || !y) return undefined;
  return { a: x[0], b: x[1], c: x[2] - x[0] * cu - x[1] * cv, d: y[0], e: y[1], f: y[2] - y[0] * cu - y[1] * cv };
}

function similarityFit(points: readonly ControlPoint[]): Affine | undefined {
  // Bildens rader går nedåt och kartans y uppåt: anpassa (kolumn, −rad) → (x, y) med x = p·u − q·v + c, y = q·u + p·v + d.
  const n = points.length;
  const mu = { x: points.reduce((s, p) => s + p.pixel.x, 0) / n, y: -points.reduce((s, p) => s + p.pixel.y, 0) / n };
  const mx = { x: points.reduce((s, p) => s + p.map.x, 0) / n, y: points.reduce((s, p) => s + p.map.y, 0) / n };
  let sxx = 0, sxy = 0, norm = 0;
  for (const p of points) {
    const u = p.pixel.x - mu.x, v = -p.pixel.y - mu.y, x = p.map.x - mx.x, y = p.map.y - mx.y;
    sxx += u * x + v * y; sxy += u * y - v * x; norm += u * u + v * v;
  }
  if (norm < 1e-12) return undefined;
  const p = sxx / norm, q = sxy / norm;
  if (Math.hypot(p, q) < 1e-12) return undefined;
  const c = mx.x - (p * mu.x - q * mu.y), d = mx.y - (q * mu.x + p * mu.y);
  // Tillbaka till kolumn och rad: x = p·kolumn + q·rad + c, y = q·kolumn − p·rad + d.
  return { a: p, b: q, c, d: q, e: -p, f: d };
}

/** Den transform som passar punkterna bäst. Likformig med två punkter (eller när den väljs), annars affin; undefined när det inte går. */
export function fitControlPoints(points: readonly ControlPoint[], kind: FitKind = points.length >= 3 ? "affine" : "similarity"): Fit | undefined {
  const minimum = kind === "affine" ? 3 : 2;
  if (points.length < minimum) return undefined;
  const toMap = kind === "affine" ? affineFit(points) : similarityFit(points);
  if (!toMap || Math.abs(toMap.a * toMap.e - toMap.b * toMap.d) < 1e-18) return undefined;
  const residuals = points.map(point => { const at = apply(toMap, point.pixel); return Math.hypot(at.x - point.map.x, at.y - point.map.y); });
  const rms = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  return { kind, toMap, residuals, rms };
}

/** Pixeln under en punkt på kartan (kartans mm) med bildens nuvarande placering. */
export function pixelAt(toMap: Affine, point: Point): Point {
  const det = toMap.a * toMap.e - toMap.b * toMap.d;
  const x = point.x - toMap.c, y = point.y - toMap.f;
  return { x: (toMap.e * x - toMap.b * y) / det, y: (toMap.a * y - toMap.d * x) / det };
}

/**
 * Världsfilen i kartans koordinatsystem (pixelns mitt → kartans EPSG) för en placering i kartans mm, räknad ur tre hörn som
 * `layerToMap` gör åt andra hållet.
 */
export function worldFromMap(toMap: Affine, width: number, height: number, georeference: MapGeoreference): Affine {
  const at = (column: number, row: number) => mapPointToProjected(georeference, apply(toMap, { x: column, y: row }));
  const w = Math.max(1, width - 1), h = Math.max(1, height - 1);
  const p0 = at(0, 0), p1 = at(w, 0), p2 = at(0, h);
  return { a: (p1.easting - p0.easting) / w, b: (p2.easting - p0.easting) / h, c: p0.easting,
    d: (p1.northing - p0.northing) / w, e: (p2.northing - p0.northing) / h, f: p0.northing };
}

/** En bild utan georeferens läggs först mitt i området (kartans mm), så stor som möjligt med 10 % marginal; sedan passpunkter. */
export function placeInBounds(width: number, height: number, bounds: Bounds): Affine {
  const spanX = bounds.maxX - bounds.minX, spanY = bounds.maxY - bounds.minY;
  const size = 0.9 * Math.min(spanX / width, spanY / height);
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  // Pixelns mitt: kolumn 0 ligger en halv pixel in från vänsterkanten, rad 0 en halv pixel ned från överkanten.
  return { a: size, b: 0, c: cx - size * (width - 1) / 2, d: 0, e: -size, f: cy + size * (height - 1) / 2 };
}

/** Avvikelsen i meter i terrängen (kartans mm gånger skalan). */
export const residualMeters = (mm: number, scale: number) => mm * scale / 1000;
