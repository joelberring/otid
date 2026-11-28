import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import { objectParts } from "./edit";
import { objectBox } from "./hit";
import { simplifyIndices } from "./generalize";

/**
 * Ägaren 2026-11-09 ("en höjdkurva med för många punkter"): formen på ett markerat objekt i ett grepp, som i Mapper och
 * OCAD. Förenkla (även kurvor: de plattas ut först), gör mjuk (raka sträckor blir kurvor genom samma punkter, Catmull–Rom),
 * gör rak (kurvorna blir raka mellan samma punkter) och runda former (cirkel som linje eller yta). Hörnpunkter (`corner`)
 * förblir hörn när en linje görs mjuk. Rena funktioner, kartans mm med y uppåt.
 */

/** Kurvornas utplattning: punkter per kurva. */
const CURVE_STEPS = 8;
/** Bézierkonstanten för en kvarts cirkel. */
const KAPPA = 0.5522847498;

const flagsOf = (command: PathCommand) => ({ ...(command.corner ? { corner: true as const } : {}), ...(command.dash ? { dash: true as const } : {}),
  ...(command.gap !== undefined ? { gap: command.gap } : {}) });
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function withParts(object: MapObject, parts: readonly Path[]): MapObject {
  if (object.kind === "area") return { ...object, rings: parts };
  if (object.kind === "line") return { ...object, path: parts.flat() };
  return object;
}

/** Delens punkter med kurvorna utplattade, samt flaggorna på originalets ankarpunkter. */
function flattenWithFlags(part: Path): { points: Point[]; flags: (ReturnType<typeof flagsOf> | undefined)[]; pinned: Set<number> } {
  const points: Point[] = [];
  const flags: (ReturnType<typeof flagsOf> | undefined)[] = [];
  const pinned = new Set<number>();
  for (const command of part) {
    const previous = points[points.length - 1];
    if (command.type === "C" && previous) {
      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS, u = 1 - t;
        points.push({ x: u * u * u * previous.x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          y: u * u * u * previous.y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y });
        if (step === CURVE_STEPS) {
          const f = flagsOf(command);
          flags.push(f);
          if (command.corner || command.dash || command.gap !== undefined) pinned.add(points.length - 1);
        } else {
          flags.push(undefined);
        }
      }
    } else {
      points.push({ x: command.x, y: command.y });
      flags.push(flagsOf(command));
      if (command.corner || command.dash || command.gap !== undefined) pinned.add(points.length - 1);
    }
  }
  return { points, flags, pinned };
}

/** Delens punkter med kurvorna utplattade. */
const flatten = (part: Path): Point[] => flattenWithFlags(part).points;

/** Antalet punkter (kurvornas ändpunkter räknas, inte styrpunkterna). */
export function vertexCount(object: MapObject): number {
  return objectParts(object).reduce((sum, part) => sum + part.length, 0);
}

/**
 * Objektet med färre punkter (Douglas–Peucker, `tolerance` i kartans mm). Kurvor plattas ut först och blir raka sträckor
 * (gör det mjukt efteråt vid behov). Hörn- och streckpunkter (styrpunkter) behålls. En ring behåller minst tre punkter,
 * en linje sina ändar. Undefined om antalet punkter inte minskar.
 */
export function simplifyShape(object: MapObject, tolerance: number): MapObject | undefined {
  if (tolerance <= 0 || (object.kind !== "line" && object.kind !== "area")) return undefined;
  const before = vertexCount(object);
  const parts = objectParts(object).map(part => {
    const { points, flags, pinned } = flattenWithFlags(part);
    const build = (indices: readonly number[], closedEnd?: number): PathCommand[] => {
      const out: PathCommand[] = indices.map((origIdx, idx) => ({
        type: idx === 0 ? "M" : "L", x: points[origIdx]!.x, y: points[origIdx]!.y, ...(flags[origIdx] ?? {})
      }));
      if (closedEnd !== undefined) out.push({ type: "L", x: points[indices[0]!]!.x, y: points[indices[0]!]!.y, ...(flags[closedEnd] ?? {}) });
      return out;
    };
    if (object.kind !== "area") return build(simplifyIndices(points, tolerance, pinned));
    const closed = points.length > 1 && same(points[0]!, points[points.length - 1]!);
    const ring = closed ? points.slice(0, -1) : points;
    if (ring.length < 4) return [...part];
    // Ringen delas vid punkten längst från den första (en ring har ingen början).
    let far = 0, best = -1;
    ring.forEach((point, index) => { const d = Math.hypot(point.x - ring[0]!.x, point.y - ring[0]!.y); if (d > best) { best = d; far = index; } });
    const pinOne = pinned.size ? new Set([...pinned].filter(i => i > 0 && i < far)) : undefined;
    const pinTwo = pinned.size ? new Set([...pinned].filter(i => i > far && i < ring.length).map(i => i - far)) : undefined;
    const one = simplifyIndices(ring.slice(0, far + 1), tolerance, pinOne);
    const two = simplifyIndices([...ring.slice(far), ring[0]!], tolerance, pinTwo).slice(1, -1).map(i => i + far);
    const result = [...one, ...two];
    if (result.length < 3) return [...part];
    return build(result, closed ? points.length - 1 : undefined);
  });
  const next = withParts(object, parts);
  return vertexCount(next) < before ? next : undefined;
}

/** Högsta styrhandtagets längd som andel av sträckans längd på mjuka böjar (klampning mot öglor och överslängar). */
const MAX_HANDLE_SHARE = 0.42;
/** Antal delsteg per kurva vid kontroll av självkorsning i `smoothShape` och `lineSelfCrosses`. */
const CROSS_CURVE_STEPS = 12;

/**
 * Styrhandtagets högsta andel av kordan efter yttervinkeln (grader) i punkten: full (0,42) under 45°,
 * mjukt nedtrappad till 0,12 vid 105° och 0 från 120° så skarpa sicksackkurvor inte slår öglor.
 */
function handleShareForAngle(deg: number): number {
  if (deg <= 45) return MAX_HANDLE_SHARE;
  if (deg <= 105) return MAX_HANDLE_SHARE - ((deg - 45) / 60) * (MAX_HANDLE_SHARE - 0.12);
  if (deg < 120) return 0.12 * (120 - deg) / 15;
  return 0;
}

function clampHandle(x: number, y: number, chord: number, maxShare = MAX_HANDLE_SHARE): Point {
  if (chord <= 1e-12 || maxShare <= 0) return { x: 0, y: 0 };
  const length = Math.hypot(x, y), limit = maxShare * chord;
  if (length <= limit || length === 0) return { x, y };
  const scale = limit / length;
  return { x: x * scale, y: y * scale };
}

interface SmoothCurve {
  readonly from: Point;
  readonly to: Point;
  readonly c1: Point;
  readonly c2: Point;
  scale: number;
}

function sampleSmoothCurve(seg: SmoothCurve, steps: number): Point[] {
  if (seg.scale <= 0) return [seg.from, seg.to];
  const x1 = seg.from.x + seg.c1.x * seg.scale, y1 = seg.from.y + seg.c1.y * seg.scale;
  const x2 = seg.to.x - seg.c2.x * seg.scale, y2 = seg.to.y - seg.c2.y * seg.scale;
  const pts: Point[] = [seg.from];
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps, u = 1 - t;
    pts.push({
      x: u * u * u * seg.from.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * seg.to.x,
      y: u * u * u * seg.from.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * seg.to.y
    });
  }
  pts.push(seg.to);
  return pts;
}

function segmentPairCrosses(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) return false;
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  return crosses(a, b, c, d);
}

/**
 * Hittar alla kurvsegment i delen som korsar sig själva eller ett annat segment efter utplattning.
 * Använder styrpolygonens omslutande låda + svep i x för att undvika onödig utplattning på vanliga kurvor.
 */
function crossingCurveIndices(curves: readonly SmoothCurve[], closed: boolean): Set<number> {
  const count = curves.length;
  const offending = new Set<number>();
  if (count === 0) return offending;
  const boxes = curves.map((seg, index) => {
    const x1 = seg.from.x + seg.c1.x * seg.scale, y1 = seg.from.y + seg.c1.y * seg.scale;
    const x2 = seg.to.x - seg.c2.x * seg.scale, y2 = seg.to.y - seg.c2.y * seg.scale;
    return {
      index,
      minX: Math.min(seg.from.x, seg.to.x, x1, x2),
      maxX: Math.max(seg.from.x, seg.to.x, x1, x2),
      minY: Math.min(seg.from.y, seg.to.y, y1, y2),
      maxY: Math.max(seg.from.y, seg.to.y, y1, y2)
    };
  });
  const flat: (Point[] | undefined)[] = Array.from({ length: count });
  const pointsOf = (index: number): Point[] => (flat[index] ??= sampleSmoothCurve(curves[index]!, CROSS_CURVE_STEPS));
  for (let i = 0; i < count; i += 1) {
    const seg = curves[i]!;
    if (seg.scale <= 0) continue;
    const dx = seg.to.x - seg.from.x, dy = seg.to.y - seg.from.y;
    if (seg.c1.x * dx + seg.c1.y * dy >= 0 && seg.c2.x * dx + seg.c2.y * dy >= 0) continue;
    const pts = pointsOf(i);
    for (let s = 0; s < pts.length - 1; s += 1) {
      for (let t = s + 2; t < pts.length - 1; t += 1) {
        if (segmentPairCrosses(pts[s]!, pts[s + 1]!, pts[t]!, pts[t + 1]!)) {
          offending.add(i);
          break;
        }
      }
      if (offending.has(i)) break;
    }
  }
  const order = [...boxes].sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < order.length; i += 1) {
    const a = order[i]!;
    for (let j = i + 1; j < order.length && order[j]!.minX <= a.maxX; j += 1) {
      const b = order[j]!;
      if (a.maxY < b.minY || b.maxY < a.minY) continue;
      const lo = Math.min(a.index, b.index), hi = Math.max(a.index, b.index);
      const ptsLo = pointsOf(lo), ptsHi = pointsOf(hi);
      const nLo = ptsLo.length - 1, nHi = ptsHi.length - 1;
      const adjForward = hi === lo + 1;
      const adjWrap = closed && lo === 0 && hi === count - 1;
      let hit = false;
      for (let s = 0; s < nLo && !hit; s += 1) {
        for (let t = 0; t < nHi; t += 1) {
          if (adjForward && s === nLo - 1 && t === 0) continue;
          if (adjWrap && s === 0 && t === nHi - 1) continue;
          if (segmentPairCrosses(ptsLo[s]!, ptsLo[s + 1]!, ptsHi[t]!, ptsHi[t + 1]!)) {
            offending.add(lo);
            offending.add(hi);
            hit = true;
            break;
          }
        }
      }
    }
  }
  return offending;
}

/**
 * Objektet mjukt: varje sträcka blir en kurva genom samma punkter (centripetal Catmull–Rom, α = 0,5, med vinkeldämpad
 * kordklampning och självkorsningsskydd så ojämna punktavstånd och skarpa vändningar inte ger öglor eller korsningar).
 * Hörnpunkter och linjens ändar får ingen tangent från andra sidan. Undefined om objektet saknar sträckor.
 */
export function smoothShape(object: MapObject): MapObject | undefined {
  if (object.kind !== "line" && object.kind !== "area") return undefined;
  let changed = false;
  const parts = objectParts(object).map(part => {
    const ring = object.kind === "area";
    const closed = ring || (part.length > 2 && same(part[0]!, part[part.length - 1]!));
    // Punkterna utan den upprepade första punkten i en sluten del.
    const anchors = closed && part.length > 1 && same(part[0]!, part[part.length - 1]!) ? part.slice(0, -1) : [...part];
    const n = anchors.length;
    if (n < 2 || (closed && n < 3)) return [...part];
    const p = (i: number): Point => {
      const index = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
      return { x: anchors[index]!.x, y: anchors[index]!.y };
    };
    // Yttervinkel per punkt för dämpning av styrhandtag i skarpa böjar.
    const shares: number[] = Array.from({ length: n }, (_, i) => {
      if (anchors[i]!.corner) return 0;
      if (!closed && (i === 0 || i === n - 1)) return MAX_HANDLE_SHARE;
      const prev = p(i - 1), curr = p(i), next = p(i + 1);
      const v0x = curr.x - prev.x, v0y = curr.y - prev.y, d0 = Math.hypot(v0x, v0y);
      const v1x = next.x - curr.x, v1y = next.y - curr.y, d1 = Math.hypot(v1x, v1y);
      if (d0 <= 1e-12 || d1 <= 1e-12) return 0;
      const cos = Math.max(-1, Math.min(1, (v0x * v1x + v0y * v1y) / (d0 * d1)));
      return handleShareForAngle(Math.acos(cos) * (180 / Math.PI));
    });
    // Centripetal derivata Q'(t_i) med knutsteg h = √|P_{k+1} − P_k| (α = 0,5); samma riktning in och ut (G¹-kontinuitet).
    const derivatives: Point[] = Array.from({ length: n }, (_, i) => {
      if (anchors[i]!.corner) return { x: 0, y: 0 };
      if (!closed && (i === 0 || i === n - 1)) {
        const a = p(i === 0 ? 0 : n - 2), b = p(i === 0 ? 1 : n - 1);
        const h = Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
        return h <= 1e-12 ? { x: 0, y: 0 } : { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
      }
      const prev = p(i - 1), curr = p(i), next = p(i + 1);
      const h0 = Math.sqrt(Math.hypot(curr.x - prev.x, curr.y - prev.y));
      const h1 = Math.sqrt(Math.hypot(next.x - curr.x, next.y - curr.y));
      if (h0 <= 1e-12 && h1 <= 1e-12) return { x: 0, y: 0 };
      if (h0 <= 1e-12) return { x: (next.x - curr.x) / (2 * h1), y: (next.y - curr.y) / (2 * h1) };
      if (h1 <= 1e-12) return { x: (curr.x - prev.x) / (2 * h0), y: (curr.y - prev.y) / (2 * h0) };
      const sum = h0 + h1, w0 = h1 / sum, w1 = h0 / sum;
      return {
        x: w0 * (curr.x - prev.x) / h0 + w1 * (next.x - curr.x) / h1,
        y: w0 * (curr.y - prev.y) / h0 + w1 * (next.y - curr.y) / h1
      };
    });
    const segments = closed ? n : n - 1;
    const curves: SmoothCurve[] = Array.from({ length: segments }, (_, i) => {
      const from = p(i), to = p(i + 1), chord = Math.hypot(to.x - from.x, to.y - from.y), h = Math.sqrt(chord);
      const m0 = derivatives[i]!, m1 = derivatives[(i + 1) % n]!;
      const c1 = clampHandle(m0.x * h / 3, m0.y * h / 3, chord, shares[i]);
      const c2 = clampHandle(m1.x * h / 3, m1.y * h / 3, chord, shares[(i + 1) % n]);
      return { from, to, c1, c2, scale: 1 };
    });
    // Skydd mot Bézier-självkorsningar: halvera handtagen på korsande segment (fall tillbaka på rak L om det ändå korsar).
    for (let round = 0; round < 6; round += 1) {
      const offending = crossingCurveIndices(curves, closed);
      if (offending.size === 0) break;
      let reduced = false;
      for (const index of offending) {
        const seg = curves[index]!;
        if (seg.scale <= 0) continue;
        seg.scale = seg.scale <= 0.0625 ? 0 : seg.scale * 0.5;
        reduced = true;
      }
      if (!reduced) break;
    }
    const out: PathCommand[] = [{ type: "M", x: anchors[0]!.x, y: anchors[0]!.y, ...flagsOf(anchors[0]!) }];
    for (let i = 0; i < segments; i += 1) {
      const seg = curves[i]!, target = anchors[(i + 1) % n]!;
      const targetFlags = i + 1 < n ? flagsOf(target) : {};
      if (seg.scale <= 0) {
        out.push({ type: "L", x: seg.to.x, y: seg.to.y, ...targetFlags });
      } else {
        out.push({
          type: "C",
          x1: seg.from.x + seg.c1.x * seg.scale, y1: seg.from.y + seg.c1.y * seg.scale,
          x2: seg.to.x - seg.c2.x * seg.scale, y2: seg.to.y - seg.c2.y * seg.scale,
          x: seg.to.x, y: seg.to.y, ...targetFlags
        });
      }
      changed = true;
    }
    return out;
  });
  return changed ? withParts(object, parts) : undefined;
}

/** Objektet rakt: kurvorna blir raka sträckor mellan samma punkter. Undefined om det inte har några kurvor. */
export function straightenShape(object: MapObject): MapObject | undefined {
  if (object.kind !== "line" && object.kind !== "area") return undefined;
  const parts = objectParts(object);
  if (!parts.some(part => part.some(command => command.type === "C"))) return undefined;
  return withParts(object, parts.map(part => part.map(command => command.type === "C"
    ? { type: "L" as const, x: command.x, y: command.y, ...flagsOf(command) } : command)));
}

/** En cirkel (fyra kurvor) som sluten linje eller yta med symbolen; undefined om radien är för liten. */
export function circleShape(kind: "line" | "area", symbol: string, center: Point, radius: number): MapObject | undefined {
  if (!(radius > 0.05)) return undefined;
  const k = radius * KAPPA, { x, y } = center;
  const path: PathCommand[] = [
    { type: "M", x: x + radius, y },
    { type: "C", x1: x + radius, y1: y + k, x2: x + k, y2: y + radius, x, y: y + radius },
    { type: "C", x1: x - k, y1: y + radius, x2: x - radius, y2: y + k, x: x - radius, y },
    { type: "C", x1: x - radius, y1: y - k, x2: x - k, y2: y - radius, x, y: y - radius },
    { type: "C", x1: x + k, y1: y - radius, x2: x + radius, y2: y - k, x: x + radius, y }
  ];
  return kind === "area" ? { kind: "area", symbol, rings: [path], angle: 0 } : { kind: "line", symbol, path };
}

/** Förenkla stegvis (ägaren 2026-11-23): varje steg prövar en tolerans så mycket större än förra. */
export const SIMPLIFY_GROWTH = 1.6;
/** Det största steget (kartans mm), och högst så stor del av objektets diagonal: mer ändrar formen för mycket. */
export const SIMPLIFY_MAX_MM = 0.8;
const SIMPLIFY_MAX_SHARE = 0.1;
/** En yta får inte krympa eller växa mer än så av sin yta i ett steg. */
const SIMPLIFY_AREA_CHANGE = 0.35;

export interface SimplifyStep { readonly object: MapObject; readonly tolerance: number }

const ringArea = (ring: readonly Point[]) => Math.abs(ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);

/** Ytans storlek (kartans mm²): den yttre ringen minus hålen. */
function areaOf(object: MapObject): number {
  if (object.kind !== "area") return 0;
  return objectParts(object).map(part => ringArea(flatten(part))).reduce((sum, area, index) => index === 0 ? area : sum - area, 0);
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Utplattning med valfritt antal steg per kurva (utan flaggor). */
function flattenSteps(part: Path, steps: number): Point[] {
  const points: Point[] = [];
  for (const command of part) {
    const previous = points[points.length - 1];
    if (command.type === "C" && previous) {
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps, u = 1 - t;
        points.push({
          x: u * u * u * previous.x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          y: u * u * u * previous.y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y
        });
      }
    } else {
      points.push({ x: command.x, y: command.y });
    }
  }
  return points;
}

/** Om linjens delar (med kurvorna utplattade) korsar sig själva eller varandra. Svep i x, så att täta kurvor går fort. */
export function lineSelfCrosses(object: MapObject): boolean {
  if (object.kind !== "line") return false;
  const segments: { a: Point; b: Point; minX: number; maxX: number; part: number; index: number; count: number; closed: boolean }[] = [];
  objectParts(object).forEach((part, partIndex) => {
    const points = flattenSteps(part, CROSS_CURVE_STEPS);
    const count = points.length - 1;
    const closed = count > 1 && same(points[0]!, points[count]!);
    for (let index = 0; index < count; index += 1) {
      const a = points[index]!, b = points[index + 1]!;
      segments.push({ a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), part: partIndex, index, count, closed });
    }
  });
  segments.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    for (let j = i + 1; j < segments.length && segments[j]!.minX <= s.maxX; j += 1) {
      const t = segments[j]!;
      if (Math.max(s.a.y, s.b.y) < Math.min(t.a.y, t.b.y) || Math.max(t.a.y, t.b.y) < Math.min(s.a.y, s.b.y)) continue;
      if (s.part === t.part) {
        const diff = Math.abs(s.index - t.index);
        if (diff === 1 || (s.closed && diff === s.count - 1)) continue;
      }
      if (crosses(s.a, s.b, t.a, t.b)) return true;
    }
  }
  return false;
}

/** Om ytans ringar (med kurvorna utplattade) korsar sig själva eller varandra. Svep i x, så att täta ytor går fort. */
export function areaSelfCrosses(object: MapObject): boolean {
  if (object.kind !== "area") return false;
  const segments: { a: Point; b: Point; minX: number; maxX: number; ring: number; index: number; count: number }[] = [];
  objectParts(object).forEach((part, ring) => {
    const points = flatten(part);
    const count = points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = points[index]!, b = points[index + 1]!;
      segments.push({ a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), ring, index, count });
    }
  });
  segments.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    for (let j = i + 1; j < segments.length && segments[j]!.minX <= s.maxX; j += 1) {
      const t = segments[j]!;
      if (Math.max(s.a.y, s.b.y) < Math.min(t.a.y, t.b.y) || Math.max(t.a.y, t.b.y) < Math.min(s.a.y, s.b.y)) continue;
      // Grannar i samma ring delar en punkt.
      if (s.ring === t.ring && (Math.abs(s.index - t.index) === 1 || Math.abs(s.index - t.index) === s.count - 1)) continue;
      if (crosses(s.a, s.b, t.a, t.b)) return true;
    }
  }
  return false;
}

/**
 * Ett steg enklare (ägaren 2026-11-23: «går att göra en gång sen blir det inte mer förenklingar»): den minsta toleransen från
 * `from` och uppåt (×1,6 per försök, högst `SIMPLIFY_MAX_MM` och en tiondel av objektets diagonal) som ger färre punkter i
 * objektets nuvarande form. Kurvor behålls: ett objekt med kurvor görs mjukt genom de punkter som är kvar (rakt om den mjuka
 * formen inte håller). En yta får inte korsa sig själv, inte ändra storlek mer än en tredjedel och inte bli mindre än
 * `minArea` (normens minsta yta, kartans mm²). Undefined när inget steg går.
 */
export function simplifyStep(object: MapObject, from: number, options: { readonly minArea?: number | undefined } = {}): SimplifyStep | undefined {
  if (object.kind !== "line" && object.kind !== "area") return undefined;
  const box = objectBox(object), max = Math.min(SIMPLIFY_MAX_MM, SIMPLIFY_MAX_SHARE * Math.hypot(box.maxX - box.minX, box.maxY - box.minY));
  const curved = objectParts(object).some(part => part.some(command => command.type === "C"));
  const before = areaOf(object);
  const smallest = options.minArea === undefined ? 0 : Math.min(options.minArea, before);
  const holds = (candidate: MapObject) => {
    if (candidate.kind !== "area") return true;
    const area = areaOf(candidate);
    return area >= smallest && Math.abs(area - before) <= SIMPLIFY_AREA_CHANGE * before && !areaSelfCrosses(candidate);
  };
  for (let tolerance = from; tolerance <= max * (1 + 1e-9); tolerance *= SIMPLIFY_GROWTH) {
    const straight = simplifyShape(object, tolerance);
    if (!straight) continue;
    const smooth = curved ? smoothShape(straight) : undefined;
    if (smooth && holds(smooth)) return { object: smooth, tolerance };
    if (holds(straight)) return { object: straight, tolerance };
  }
  return undefined;
}
