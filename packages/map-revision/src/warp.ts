import type { MapObject, PathCommand, Point } from "@o-tid/map-file";
import { objectBox } from "./hit";

/**
 * ADR-0219 K6b: rätta en äldre karta med passpunkter. Varje passpunkt är där något ligger på kartan nu och där det ska ligga
 * (t.ex. på ett ortofoto eller laserns skuggning). Tre sätt:
 *
 * - **likformig** (två punkter eller fler): flytt, vridning och en skala,
 * - **affin** (tre eller fler): också olika skala på ledderna och snedhet,
 * - **gummiduk** (tre eller fler): en tunn platta (thin-plate spline) som går exakt genom punkterna och böjer kartan mjukt
 *   mellan dem; långt från punkterna blir den affin.
 *
 * Avvikelserna är för likformig och affin hur långt varje punkt hamnar från målet; för gummiduken hur mycket den böjer kartan i
 * punkten utöver den affina delen (punkterna själva hamnar exakt).
 */
export type WarpKind = "similarity" | "affine" | "rubber";
export interface WarpPair { readonly from: Point; readonly to: Point }
export interface Affine2 { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }
export interface Warp {
  readonly kind: WarpKind;
  readonly apply: (point: Point) => Point;
  readonly residuals: readonly number[];
  readonly rms: number;
}

const applyAffine = (t: Affine2, p: Point): Point => ({ x: t.a * p.x + t.b * p.y + t.c, y: t.d * p.x + t.e * p.y + t.f });

/** Ett linjärt system med Gauss elimination och radbyte; undefined om det saknar entydig lösning. */
function solve(matrix: number[][], vector: number[]): number[] | undefined {
  const n = vector.length;
  const m = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(m[row]![column]!) > Math.abs(m[pivot]![column]!)) pivot = row;
    if (Math.abs(m[pivot]![column]!) < 1e-12) return undefined;
    [m[column], m[pivot]] = [m[pivot]!, m[column]!];
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = m[row]![column]! / m[column]![column]!;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) m[row]![k]! -= factor * m[column]![k]!;
    }
  }
  return m.map((row, index) => row[n]! / row[index]!);
}

/** Affin transform med minsta kvadrat (tre punkter eller fler, inte på en linje). */
export function fitAffine(pairs: readonly WarpPair[]): Affine2 | undefined {
  if (pairs.length < 3) return undefined;
  // Centrerat för noggrannhetens skull.
  const cx = pairs.reduce((s, p) => s + p.from.x, 0) / pairs.length, cy = pairs.reduce((s, p) => s + p.from.y, 0) / pairs.length;
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rx = [0, 0, 0], ry = [0, 0, 0];
  for (const pair of pairs) {
    const row = [pair.from.x - cx, pair.from.y - cy, 1];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) normal[i]![j]! += row[i]! * row[j]!;
      rx[i]! += row[i]! * pair.to.x; ry[i]! += row[i]! * pair.to.y;
    }
  }
  const x = solve(normal.map(row => [...row]), rx), y = solve(normal.map(row => [...row]), ry);
  if (!x || !y) return undefined;
  return { a: x[0]!, b: x[1]!, c: x[2]! - x[0]! * cx - x[1]! * cy, d: y[0]!, e: y[1]!, f: y[2]! - y[0]! * cx - y[1]! * cy };
}

/** Likformig transform (flytt, vridning, skala) med minsta kvadrat; två punkter eller fler. Utan spegling. */
export function fitSimilarity(pairs: readonly WarpPair[]): Affine2 | undefined {
  if (pairs.length < 2) return undefined;
  const n = pairs.length;
  const fx = pairs.reduce((s, p) => s + p.from.x, 0) / n, fy = pairs.reduce((s, p) => s + p.from.y, 0) / n;
  const tx = pairs.reduce((s, p) => s + p.to.x, 0) / n, ty = pairs.reduce((s, p) => s + p.to.y, 0) / n;
  let sp = 0, sq = 0, norm = 0;
  for (const pair of pairs) {
    const u = pair.from.x - fx, v = pair.from.y - fy, x = pair.to.x - tx, y = pair.to.y - ty;
    sp += u * x + v * y; sq += u * y - v * x; norm += u * u + v * v;
  }
  if (norm < 1e-12) return undefined;
  const p = sp / norm, q = sq / norm;
  if (Math.hypot(p, q) < 1e-12) return undefined;
  return { a: p, b: -q, c: tx - (p * fx - q * fy), d: q, e: p, f: ty - (q * fx + p * fy) };
}

const kernel = (r2: number) => r2 === 0 ? 0 : r2 * Math.log(r2);

/** Tunn platta genom punkterna: affin del och vikter per punkt. */
function fitRubber(pairs: readonly WarpPair[]): ((point: Point) => Point) | undefined {
  const n = pairs.length;
  if (n < 3) return undefined;
  const size = n + 3;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < n; i += 1) {
    const pi = pairs[i]!.from;
    for (let j = 0; j < n; j += 1) {
      const pj = pairs[j]!.from;
      matrix[i]![j] = kernel((pi.x - pj.x) ** 2 + (pi.y - pj.y) ** 2);
    }
    matrix[i]![n] = 1; matrix[i]![n + 1] = pi.x; matrix[i]![n + 2] = pi.y;
    matrix[n]![i] = 1; matrix[n + 1]![i] = pi.x; matrix[n + 2]![i] = pi.y;
  }
  const bx = [...pairs.map(pair => pair.to.x), 0, 0, 0], by = [...pairs.map(pair => pair.to.y), 0, 0, 0];
  const wx = solve(matrix.map(row => [...row]), bx), wy = solve(matrix.map(row => [...row]), by);
  if (!wx || !wy) return undefined;
  return point => {
    let x = wx[n]! + wx[n + 1]! * point.x + wx[n + 2]! * point.y, y = wy[n]! + wy[n + 1]! * point.x + wy[n + 2]! * point.y;
    for (let i = 0; i < n; i += 1) {
      const from = pairs[i]!.from, k = kernel((point.x - from.x) ** 2 + (point.y - from.y) ** 2);
      x += wx[i]! * k; y += wy[i]! * k;
    }
    return { x, y };
  };
}

/** Den transform som passar punkterna; undefined när det inte går (för få punkter, på en linje). */
export function fitWarp(pairs: readonly WarpPair[], kind: WarpKind): Warp | undefined {
  let apply: ((point: Point) => Point) | undefined;
  let residualOf: (pair: WarpPair, apply: (point: Point) => Point) => number = (pair, map) => {
    const at = map(pair.from);
    return Math.hypot(at.x - pair.to.x, at.y - pair.to.y);
  };
  if (kind === "similarity") { const t = fitSimilarity(pairs); apply = t && (point => applyAffine(t, point)); }
  else if (kind === "affine") { const t = fitAffine(pairs); apply = t && (point => applyAffine(t, point)); }
  else {
    const affine = fitAffine(pairs);
    apply = affine && fitRubber(pairs);
    if (affine) residualOf = pair => { const at = applyAffine(affine, pair.from); return Math.hypot(at.x - pair.to.x, at.y - pair.to.y); };
  }
  if (!apply) return undefined;
  const map = apply;
  const residuals = pairs.map(pair => residualOf(pair, map));
  const rms = residuals.length ? Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length) : 0;
  return { kind, apply: map, residuals, rms };
}

/** Vinkeländringen (grader moturs) i en punkt: hur en kort sträcka åt öster vrids. */
function turnAt(apply: (point: Point) => Point, at: Point): number {
  const a = apply(at), b = apply({ x: at.x + 1, y: at.y });
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

const warpPath = (path: readonly PathCommand[], apply: (point: Point) => Point): PathCommand[] => path.map(command => {
  const { x, y } = apply(command);
  if (command.type !== "C") return { ...command, x, y };
  const one = apply({ x: command.x1, y: command.y1 }), two = apply({ x: command.x2, y: command.y2 });
  return { ...command, x1: one.x, y1: one.y, x2: two.x, y2: two.y, x, y };
});
const normalAngle = (angle: number) => { const value = ((angle % 360) + 360) % 360; return value > 180 ? value - 360 : value; };

/** Objektet flyttat med transformen (punkternas och texternas vinkel, och ytornas mönster, vrids med kartan där de ligger). */
export function warpObject(object: MapObject, apply: (point: Point) => Point): MapObject {
  if (object.kind === "point" || object.kind === "text") {
    return { ...object, at: apply(object.at), angle: normalAngle(object.angle + turnAt(apply, object.at)) };
  }
  if (object.kind === "line") return { ...object, path: warpPath(object.path, apply) };
  const box = objectBox(object);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return { ...object, rings: object.rings.map(ring => warpPath(ring, apply)), angle: object.angle ? normalAngle(object.angle + turnAt(apply, center)) : object.angle };
}

export interface WarpChange<K extends string = string> { readonly key: K; readonly at: Point; readonly object: MapObject; readonly moved: number }
export interface WarpOptions { readonly pairs: readonly WarpPair[]; readonly kind: WarpKind;
  /** Bara objekt vars utbredning skär rutan (kartans mm). */
  readonly within?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined }

/** Objekten som flyttas (mer än 0,001 mm någonstans), med hur långt deras mitt flyttas. */
export function warpObjects<K extends string>(objects: readonly { readonly key: K; readonly object: MapObject }[], options: WarpOptions)
  : { changes: WarpChange<K>[]; warp: Warp | undefined } {
  const warp = fitWarp(options.pairs, options.kind);
  if (!warp) return { changes: [], warp };
  const changes: WarpChange<K>[] = [];
  for (const { key, object } of objects) {
    const box = objectBox(object);
    const within = options.within;
    if (within && (box.maxX < within.minX || box.minX > within.maxX || box.maxY < within.minY || box.minY > within.maxY)) continue;
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const moved = warpObject(object, warp.apply);
    const after = warp.apply(center);
    const distance = Math.hypot(after.x - center.x, after.y - center.y);
    const movedBox = objectBox(moved);
    const changed = distance > 0.001 || Math.abs(movedBox.minX - box.minX) > 0.001 || Math.abs(movedBox.maxY - box.maxY) > 0.001;
    if (changed) changes.push({ key, at: center, object: moved, moved: distance });
  }
  return { changes, warp };
}
