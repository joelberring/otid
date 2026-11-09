import { mapPointToProjected, type MapGeoreference, type Point } from "@o-tid/map-file";
import { fitAffine, fitSimilarity } from "@o-tid/map-revision";
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

/** Bildens rader går nedåt och kartans y uppåt: den likformiga anpassas på (kolumn, −rad) och vänds tillbaka. */
function similarityFit(points: readonly ControlPoint[]): Affine | undefined {
  const t = fitSimilarity(points.map(point => ({ from: { x: point.pixel.x, y: -point.pixel.y }, to: point.map })));
  return t && { a: t.a, b: -t.b, c: t.c, d: t.d, e: -t.e, f: t.f };
}
const affineFit = (points: readonly ControlPoint[]) => fitAffine(points.map(point => ({ from: point.pixel, to: point.map })));

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
