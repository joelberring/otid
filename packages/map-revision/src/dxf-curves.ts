import { nestRings } from "./ring-nesting";

/**
 * ADR-0219 K6b-tillägget 2026-11-23 (ägaren: «hus kommer fel» i Stockholms baskarta som DXF): bågar, buktiga polylinjer,
 * B-splines och HATCH-ytor i DXF. Stadens byggnader och sjöar är HATCH (en fyllning med gränsvägar), inte slutna polylinjer.
 * Bågar och splines delas adaptivt efter kordavvikelse (sagitta): noggrant på stora radier, glest på små hörnradier.
 */
type Position = readonly [number, number];
type DxfPairs = readonly (readonly [number, string])[];

/** Största tillåtna kordavvikelse (sagitta) vid båg- och splinedelning (i källans enhet, normalt meter). */
export const ARC_SAGITTA = 0.02;
const MAX_ARC_STEP = Math.PI / 4;
const MAX_ARC_STEPS = 512;
const MAX_SPLINE_POINTS = 512;
const DEG = Math.PI / 180;

/** Antal segment för en båge med svepet `sweep` (radianer) och radien `radius` under kordfelet `sagitta`. */
export function arcSteps(sweep: number, radius: number, sagitta = ARC_SAGITTA): number {
  const absSweep = Math.abs(sweep);
  if (absSweep === 0) return 1;
  let step = MAX_ARC_STEP;
  if (radius > 0 && sagitta > 0) {
    const cosHalf = 1 - sagitta / radius;
    if (cosHalf > Math.cos(MAX_ARC_STEP / 2)) {
      step = 2 * Math.acos(Math.min(1, cosHalf));
    }
  }
  return Math.max(1, Math.min(MAX_ARC_STEPS, Math.ceil(absSweep / step)));
}

/** Punkterna på en cirkelbåge från vinkeln `start` med svepet `sweep` (radianer, positivt moturs), båda ändarna med. */
function arcPoints(cx: number, cy: number, radius: number, start: number, sweep: number): Position[] {
  const steps = arcSteps(sweep, radius);
  const points: Position[] = [];
  for (let at = 0; at <= steps; at += 1) {
    const angle = start + sweep * at / steps;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** Svepet (grader) från `start` till `end` moturs; lika vinklar på olika varv är en hel cirkel. */
const sweepOf = (start: number, end: number) => {
  const sweep = ((end - start) % 360 + 360) % 360;
  return sweep === 0 && end !== start ? 360 : sweep;
};

/** ARC: medelpunkt, radie och vinklarna i grader (alltid moturs). */
export function arcEntity(body: DxfPairs): Position[] | undefined {
  const value = (code: number) => { const found = body.find(([at]) => at === code); return found ? Number(found[1]) : undefined; };
  const cx = value(10), cy = value(20), radius = value(40), start = value(50) ?? 0, end = value(51) ?? 360;
  if (cx === undefined || cy === undefined || !radius || ![cx, cy, radius, start, end].every(Number.isFinite)) return undefined;
  return arcPoints(cx, cy, radius, start * DEG, sweepOf(start, end) * DEG);
}

/**
 * Hörnen med buktighet (DXF:s bulge, tan av en fjärdedel av bågens vinkel, positiv moturs) som punkter: varje buktig sträcka
 * blir en utplattad båge. `closed`: sträckan från sista hörnet tillbaka till det första räknas också.
 */
export function bulgedPoints(vertices: readonly { readonly at: Position; readonly bulge: number }[], closed: boolean): Position[] {
  if (!vertices.some(vertex => vertex.bulge !== 0)) return vertices.map(vertex => vertex.at);
  const points: Position[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < count; index += 1) {
    const { at: a, bulge } = vertices[index]!, b = vertices[(index + 1) % vertices.length]!.at;
    points.push(a);
    const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
    if (bulge === 0 || chord === 0 || !Number.isFinite(bulge)) continue;
    // Medelpunkten ligger på kordans mittnormal, h från mitten (till vänster om a→b när bågen går moturs).
    const h = chord * (1 - bulge * bulge) / (4 * bulge);
    const cx = (a[0] + b[0]) / 2 - h * dy / chord, cy = (a[1] + b[1]) / 2 + h * dx / chord;
    const arc = arcPoints(cx, cy, Math.hypot(a[0] - cx, a[1] - cy), Math.atan2(a[1] - cy, a[0] - cx), 4 * Math.atan(bulge));
    for (let k = 1; k + 1 < arc.length; k += 1) points.push(arc[k]!);
  }
  if (!closed) points.push(vertices[vertices.length - 1]!.at);
  return points;
}

/** Klampad likformig knutvektor när knutar saknas eller har fel längd. */
function clampedUniformKnots(count: number, degree: number): number[] {
  const knots: number[] = [];
  const spans = count - degree;
  for (let i = 0; i <= degree; i += 1) knots.push(0);
  for (let i = 1; i < spans; i += 1) knots.push(i / spans);
  for (let i = 0; i <= degree; i += 1) knots.push(1);
  return knots;
}

function validKnots(knots: readonly number[], count: number, degree: number): boolean {
  if (knots.length !== count + degree + 1) return false;
  for (let i = 1; i < knots.length; i += 1) {
    if (!Number.isFinite(knots[i]!) || knots[i]! < knots[i - 1]!) return false;
  }
  return Number.isFinite(knots[0]!) && knots[count]! > knots[degree]!;
}

/** De Boors algoritm (inkl. rationell NURBS med vikter) i ett givet knutintervall `span` (U[span] <= t <= U[span + 1]). */
function deBoor(control: readonly Position[], weights: readonly number[] | undefined, knots: readonly number[], degree: number, span: number, t: number): Position {
  const hx = new Float64Array(degree + 1), hy = new Float64Array(degree + 1), hw = new Float64Array(degree + 1);
  for (let j = 0; j <= degree; j += 1) {
    const idx = span - degree + j;
    const w = weights ? (weights[idx] ?? 1) : 1;
    const pt = control[idx]!;
    hx[j] = pt[0] * w;
    hy[j] = pt[1] * w;
    hw[j] = w;
  }
  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const denom = knots[i + degree + 1 - r]! - knots[i]!;
      const alpha = denom === 0 ? 0 : (t - knots[i]!) / denom;
      const inv = 1 - alpha;
      hx[j] = inv * hx[j - 1]! + alpha * hx[j]!;
      hy[j] = inv * hy[j - 1]! + alpha * hy[j]!;
      hw[j] = inv * hw[j - 1]! + alpha * hw[j]!;
    }
  }
  const w = hw[degree]!;
  return w !== 0 ? [hx[degree]! / w, hy[degree]! / w] : [hx[degree]!, hy[degree]!];
}

function pointToSegmentDistSq(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], lenSq = dx * dx + dy * dy;
  if (lenSq === 0) { const rx = p[0] - a[0], ry = p[1] - a[1]; return rx * rx + ry * ry; }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const rx = p[0] - (a[0] + t * dx), ry = p[1] - (a[1] + t * dy);
  return rx * rx + ry * ry;
}

/**
 * Evaluerar en B-spline / NURBS med De Boors algoritm och adaptiv plattning under kordavvikelsen `sagitta`.
 * Ger styrpunkterna rakt av om grad < 2 eller färre än 2 styrpunkter.
 */
export function evaluateBSpline(control: readonly Position[], rawDegree: number, rawKnots: readonly number[], rawWeights?: readonly number[], sagitta = ARC_SAGITTA): Position[] {
  const n = control.length;
  if (n < 2) return control.slice();
  const degree = Math.max(1, Math.min(Math.floor(rawDegree) || 3, n - 1));
  if (degree === 1) return control.slice();
  const knots = validKnots(rawKnots, n, degree) ? rawKnots : clampedUniformKnots(n, degree);
  const weights = rawWeights && rawWeights.length === n && rawWeights.some(w => w !== 1) ? rawWeights : undefined;
  const tolSq = sagitta * sagitta;
  const out: Position[] = [];
  const push = (pt: Position) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-9) out.push(pt);
  };
  const subdivide = (span: number, t0: number, p0: Position, t1: number, p1: Position, depth: number) => {
    const tm = (t0 + t1) / 2;
    const pm = deBoor(control, weights, knots, degree, span, tm);
    if (out.length < MAX_SPLINE_POINTS && depth < 6 && (depth < 1 || pointToSegmentDistSq(pm, p0, p1) > tolSq)) {
      subdivide(span, t0, p0, tm, pm, depth + 1);
      subdivide(span, tm, pm, t1, p1, depth + 1);
      return;
    }
    push(pm);
    push(p1);
  };
  for (let span = degree; span < n; span += 1) {
    const t0 = knots[span]!, t1 = knots[span + 1]!;
    if (!(t1 > t0)) continue;
    const p0 = deBoor(control, weights, knots, degree, span, t0);
    const p1 = deBoor(control, weights, knots, degree, span, t1);
    push(p0);
    subdivide(span, t0, p0, t1, p1, 0);
  }
  return out.length >= 2 ? out : control.slice();
}

/** DXF `SPLINE`: anpassningspunkterna (11/21) när de finns, annars De Boor-evaluerad B-spline ur knutar (40), styrpunkter (10/20) och vikter (41). */
export function splineEntity(body: DxfPairs): Position[] {
  const fit: Position[] = [], control: Position[] = [], knots: number[] = [], weights: number[] = [];
  let degree = 3;
  let fx: number | undefined, cx: number | undefined;
  for (let i = 0; i < body.length; i += 1) {
    const [code, raw] = body[i]!;
    if (code === 71) { const d = Number(raw); if (Number.isInteger(d) && d >= 1) degree = d; }
    else if (code === 40) { const k = Number(raw); if (Number.isFinite(k)) knots.push(k); }
    else if (code === 41) { const w = Number(raw); if (Number.isFinite(w) && w > 0) weights.push(w); }
    else if (code === 11) fx = Number(raw);
    else if (code === 21 && fx !== undefined) { const fy = Number(raw); if (Number.isFinite(fx) && Number.isFinite(fy)) fit.push([fx, fy]); fx = undefined; }
    else if (code === 10) cx = Number(raw);
    else if (code === 20 && cx !== undefined) { const cy = Number(raw); if (Number.isFinite(cx) && Number.isFinite(cy)) control.push([cx, cy]); cx = undefined; }
  }
  if (fit.length >= 2) return fit;
  return evaluateBSpline(control, degree, knots, weights.length === control.length ? weights : undefined);
}

/** En läsare över parens koder i tur och ordning (HATCH:s gränsvägar har en bestämd ordning, och 10/20 betyder olika saker). */
class Reader {
  at = 0;
  constructor(readonly pairs: DxfPairs) {}
  peek(): number | undefined { return this.pairs[this.at]?.[0]; }
  /** Värdet för koden om den kommer härnäst (och flytta förbi den), annars inget. */
  take(code: number): number | undefined {
    const pair = this.pairs[this.at];
    if (!pair || pair[0] !== code) return undefined;
    this.at += 1;
    return Number(pair[1]);
  }
  point(xCode: number, yCode: number): Position | undefined {
    const x = this.take(xCode), y = this.take(yCode);
    return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
  }
}

/** En polylinjeväg (vägtyp med bit 2): 72 buktighet, 73 sluten, 93 antal hörn och hörnen 10/20 (42). */
function polylinePath(read: Reader): Position[] {
  const hasBulge = read.take(72) === 1;
  read.take(73);
  const count = read.take(93) ?? 0;
  const vertices: { at: Position; bulge: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = read.point(10, 20);
    const bulge = hasBulge ? read.take(42) ?? 0 : 0;
    if (at) vertices.push({ at, bulge });
    else break;
  }
  return bulgedPoints(vertices, true);
}

/** Bågens punkter för en kantväg (cirkelbåge eller ellipsbåge); medurs bågar har vinklarna som 360 − vinkeln. */
function edgeArc(start: number, end: number, ccw: boolean, radius: number, at: (angle: number) => Position): Position[] {
  const sweep = sweepOf(start, end) * DEG;
  const from = ccw ? start * DEG : -start * DEG;
  const steps = arcSteps(sweep, radius);
  const points: Position[] = [];
  for (let step = 0; step <= steps; step += 1) points.push(at(from + (ccw ? 1 : -1) * sweep * step / steps));
  return points;
}

/** En kantväg: 93 antal kanter och kanterna efter typ (1 linje, 2 cirkelbåge, 3 ellipsbåge, 4 spline). */
function edgePath(read: Reader): Position[] {
  const count = read.take(93) ?? 0;
  const points: Position[] = [];
  const add = (part: readonly Position[]) => {
    for (const point of part) {
      const last = points[points.length - 1];
      if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > 1e-9) points.push(point);
    }
  };
  for (let index = 0; index < count; index += 1) {
    const type = read.take(72);
    if (type === 1) {
      const a = read.point(10, 20), b = read.point(11, 21);
      if (a && b) add([a, b]);
    } else if (type === 2) {
      const center = read.point(10, 20), radius = read.take(40) ?? 0, start = read.take(50) ?? 0, end = read.take(51) ?? 360;
      const ccw = (read.take(73) ?? 1) !== 0;
      if (center && radius > 0) add(edgeArc(start, end, ccw, radius, angle => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]));
    } else if (type === 3) {
      const center = read.point(10, 20), major = read.point(11, 21), ratio = read.take(40) ?? 1, start = read.take(50) ?? 0, end = read.take(51) ?? 360;
      const ccw = (read.take(73) ?? 1) !== 0;
      if (center && major) {
        const majorLen = Math.hypot(major[0], major[1]);
        const effectiveRadius = Math.max(majorLen, majorLen * Math.abs(ratio));
        add(edgeArc(start, end, ccw, effectiveRadius, angle => [
          center[0] + major[0] * Math.cos(angle) - major[1] * ratio * Math.sin(angle),
          center[1] + major[1] * Math.cos(angle) + major[0] * ratio * Math.sin(angle)]));
      }
    } else if (type === 4) add(splineEdge(read));
    else break;
  }
  return points;
}

/** Splinekant: grad, flaggor, knutar, styrpunkter och (R2010+) anpassningspunkter; anpassningspunkter när de finns, annars De Boor-kurva. */
function splineEdge(read: Reader): Position[] {
  const degree = read.take(94) ?? 3;
  const rational = read.take(73) === 1;
  read.take(74);
  const knotCount = read.take(95) ?? 0, controls = read.take(96) ?? 0;
  const knots: number[] = [];
  for (let index = 0; index < knotCount && read.peek() === 40; index += 1) {
    const k = read.take(40);
    if (k !== undefined && Number.isFinite(k)) knots.push(k);
  }
  const control: Position[] = [], weights: number[] = [];
  for (let index = 0; index < controls; index += 1) {
    const at = read.point(10, 20);
    const weight = rational ? read.take(42) ?? 1 : 1;
    if (at) { control.push(at); weights.push(weight > 0 && Number.isFinite(weight) ? weight : 1); }
    else break;
  }
  const fit: Position[] = [];
  // 97 är antalet anpassningspunkter bara om punkterna följer (eller ett nytt 97, vägens källobjekt); annars är det vägens 97.
  const next = read.pairs[read.at + 1]?.[0];
  if (read.peek() === 97 && (next === 11 || next === 97 || next === 12)) {
    const count = read.take(97) ?? 0;
    for (let index = 0; index < count; index += 1) { const at = read.point(11, 21); if (at) fit.push(at); else break; }
    read.point(12, 22); read.point(13, 23);
  }
  return fit.length >= 2 ? fit : evaluateBSpline(control, degree, knots, rational ? weights : undefined);
}

/**
 * HATCH: gränsvägarna (91 antal, för varje väg 92 vägtyp, sedan polylinje eller kanter och 97 källobjekt med 330) som ytor.
 * Vägarna läggs i varandra som fyllningens udda-jämna regel: en väg inuti en annan är ett hål, en väg inuti ett hål en egen
 * yta. Flaggorna för yttre väg (1, 16) behövs därför inte (Stockholms baskarta sätter dem inte). Ger ringarna per yta, tomt
 * om ingen väg har minst tre punkter.
 */
export function hatchAreas(body: DxfPairs): Position[][][] {
  const start = body.findIndex(([code]) => code === 91);
  if (start < 0) return [];
  const read = new Reader(body);
  read.at = start;
  const paths = read.take(91) ?? 0;
  const rings: Position[][] = [];
  for (let index = 0; index < paths; index += 1) {
    const type = read.take(92);
    if (type === undefined) break;
    const ring = (type & 2) === 2 ? polylinePath(read) : edgePath(read);
    const sources = read.take(97) ?? 0;
    for (let source = 0; source < sources && read.peek() === 330; source += 1) read.at += 1;
    const first = ring[0], last = ring[ring.length - 1];
    const open = first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
    if (open.length >= 3) rings.push(open);
  }
  if (rings.length <= 1) return rings.length ? [rings] : [];
  return nestRings(rings.map(ring => ring.map(([x, y]) => ({ x, y })))).map(area => area.map(ring => ring.map(({ x, y }) => [x, y] as const)));
}
