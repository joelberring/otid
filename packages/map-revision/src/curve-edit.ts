import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import { objectParts, type VertexAddress } from "./edit";

/**
 * ADR-0219 (K3, ägaren 2026-11-08: "lätt att arbeta med objekten och linjerna ... väldigt många justeringar i minuten"):
 * kurvorna ändras direkt. En sträcka (rak eller kurva) kan få en ny punkt var som helst, böjas genom att dras i (den blir en
 * kurva som går genom punkten man drar) och punkternas styrpunkter kan dras; vid en mjuk punkt (styrpunkterna på en linje
 * genom punkten) följer den andra styrpunkten med i motsatt riktning så att kurvan förblir jämn. Punktens flaggor (hörn- och
 * streckpunkt, lucka) följer med när kommandon byts. Rena funktioner, kartans mm med y uppåt.
 *
 * En sträcka anges med punkten den börjar i (`part`, `index`); ytans stängande sträcka (från sista punkten till den första)
 * har `index` = sista punktens. Sträckan slutar i nästa kommando (`index + 1`), eller i ringens första punkt.
 */
export interface SegmentHit extends VertexAddress { readonly t: number; readonly at: Point; readonly distance: number }

type Cubic = readonly [Point, Point, Point, Point];
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const at = (command: PathCommand): Point => ({ x: command.x, y: command.y });
/** Punktens flaggor (hörn, streck, lucka) som följer med när kommandot byts. */
const flagsOf = (command: PathCommand) => ({ ...(command.corner ? { corner: true as const } : {}), ...(command.dash ? { dash: true as const } : {}),
  ...(command.gap !== undefined ? { gap: command.gap } : {}) });
/** Styrpunkterna ligger på en linje genom punkten (mjuk punkt), inom 6°. */
function smooth(vertex: Point, a: Point, b: Point): boolean {
  const ax = a.x - vertex.x, ay = a.y - vertex.y, bx = b.x - vertex.x, by = b.y - vertex.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  return la > 1e-9 && lb > 1e-9 && (ax * bx + ay * by) / (la * lb) < -Math.cos(6 * Math.PI / 180);
}

function cubicPoint([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
}

/** Sträckans ändar och (för en kurva) styrpunkter; undefined om den inte finns. */
function segment(object: MapObject, part: Path, index: number): { from: Point; to: Point; cubic?: Cubic; implicit: boolean } | undefined {
  const start = part[index];
  if (!start) return undefined;
  const next = part[index + 1];
  if (next) return next.type === "C" ? { from: at(start), to: at(next), cubic: [at(start), { x: next.x1, y: next.y1 }, { x: next.x2, y: next.y2 }, at(next)],
    implicit: false } : { from: at(start), to: at(next), implicit: false };
  // Ytans stängande raka sträcka (om ringen inte redan slutar i sin första punkt).
  if (object.kind !== "area" || part.length < 3) return undefined;
  const first = part[0]!;
  if (Math.abs(first.x - start.x) < 1e-9 && Math.abs(first.y - start.y) < 1e-9) return undefined;
  return { from: at(start), to: at(first), implicit: true };
}

/** Närmaste sträcka inom `tolerance` mm (raka och kurvor), med var på den (t) och punkten. */
export function nearestSegment(object: MapObject, point: Point, tolerance: number): SegmentHit | undefined {
  let best: SegmentHit | undefined;
  objectParts(object).forEach((part, partIndex) => {
    for (let index = 0; index < part.length; index += 1) {
      const found = segment(object, part, index);
      if (!found) continue;
      let t: number, on: Point;
      if (found.cubic) {
        // Grovt med 32 steg, sedan finare runt det bästa.
        let bestT = 0, bestD = Infinity;
        for (let i = 0; i <= 32; i += 1) { const p = cubicPoint(found.cubic, i / 32); const d = Math.hypot(p.x - point.x, p.y - point.y); if (d < bestD) { bestD = d; bestT = i / 32; } }
        for (let step = 1 / 64; step > 1e-4; step /= 2) {
          for (const candidate of [bestT - step, bestT + step]) {
            if (candidate < 0 || candidate > 1) continue;
            const p = cubicPoint(found.cubic, candidate); const d = Math.hypot(p.x - point.x, p.y - point.y);
            if (d < bestD) { bestD = d; bestT = candidate; }
          }
        }
        t = bestT; on = cubicPoint(found.cubic, t);
      } else {
        const dx = found.to.x - found.from.x, dy = found.to.y - found.from.y, length = dx * dx + dy * dy;
        t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - found.from.x) * dx + (point.y - found.from.y) * dy) / length));
        on = lerp(found.from, found.to, t);
      }
      const distance = Math.hypot(on.x - point.x, on.y - point.y);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { part: partIndex, index, t, at: on, distance };
    }
  });
  return best;
}

function withParts(object: MapObject, parts: readonly Path[]): MapObject {
  if (object.kind === "area") return { ...object, rings: parts };
  if (object.kind === "line") return { ...object, path: parts.flat() };
  return object;
}

/** Ytans stängande sträcka blir ett eget kommando (som slutar i första punkten), så att den kan bli en kurva. */
function explicitClosing(part: Path): PathCommand[] {
  const first = part[0]!;
  return [...part, { type: "L", x: first.x, y: first.y }];
}

/**
 * En ny punkt på sträckan vid `t` (0–1). En kurva delas i två kurvor som tillsammans är samma kurva (de Casteljau). Ger den nya
 * punktens adress.
 */
export function insertOnSegment(object: MapObject, address: VertexAddress, t: number): { object: MapObject; address: VertexAddress } | undefined {
  const parts = objectParts(object);
  let part = parts[address.part];
  if (!part) return undefined;
  const found = segment(object, part, address.index);
  if (!found || t <= 0 || t >= 1) return undefined;
  if (found.implicit) part = explicitClosing(part);
  const next = [...part];
  const end = next[address.index + 1]!;
  if (found.cubic) {
    const [p0, p1, p2, p3] = found.cubic;
    const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t), d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
    next.splice(address.index + 1, 1, { type: "C", x1: a.x, y1: a.y, x2: d.x, y2: d.y, x: m.x, y: m.y },
      { type: "C", x1: e.x, y1: e.y, x2: c.x, y2: c.y, x: p3.x, y: p3.y, ...flagsOf(end) });
  } else {
    const m = lerp(found.from, found.to, t);
    next.splice(address.index + 1, 0, { type: "L", x: m.x, y: m.y });
  }
  parts[address.part] = next;
  return { object: withParts(object, parts), address: { part: address.part, index: address.index + 1 } };
}

/**
 * Sträckan böjd så att dess punkt vid `t` flyttas med `delta` (mm). En rak sträcka blir först en kurva med styrpunkterna på
 * tredjedelarna; styrpunkterna flyttas så att kurvan går genom den nya punkten (minsta flytt av de två).
 */
export function bendSegment(object: MapObject, address: VertexAddress, t: number, delta: Point): MapObject {
  const parts = objectParts(object);
  let part = parts[address.part];
  if (!part) return object;
  const found = segment(object, part, address.index);
  if (!found) return object;
  if (found.implicit) part = explicitClosing(part);
  const [, p1, p2, p3]: Cubic = found.cubic ?? [found.from, lerp(found.from, found.to, 1 / 3), lerp(found.from, found.to, 2 / 3), found.to];
  const clamped = Math.min(0.95, Math.max(0.05, t));
  const b1 = 3 * (1 - clamped) ** 2 * clamped, b2 = 3 * (1 - clamped) * clamped ** 2, norm = b1 * b1 + b2 * b2;
  const c1 = { x: p1.x + delta.x * b1 / norm, y: p1.y + delta.y * b1 / norm };
  const c2 = { x: p2.x + delta.x * b2 / norm, y: p2.y + delta.y * b2 / norm };
  const next = [...part];
  const end = next[address.index + 1]!;
  next[address.index + 1] = { type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p3.x, y: p3.y, ...flagsOf(end) };
  parts[address.part] = next;
  return withParts(object, parts);
}

/** Punktens styrpunkter: in (kurvan som slutar i punkten) och ut (kurvan som börjar i den). */
export interface Handles { readonly at: Point; readonly in?: Point | undefined; readonly out?: Point | undefined }

export function vertexHandles(object: MapObject, address: VertexAddress): Handles | undefined {
  const part = objectParts(object)[address.part];
  const command = part?.[address.index];
  if (!part || !command) return undefined;
  const after = part[address.index + 1];
  return { at: at(command), in: command.type === "C" ? { x: command.x2, y: command.y2 } : undefined,
    out: after?.type === "C" ? { x: after.x1, y: after.y1 } : undefined };
}

/**
 * Styrpunkten (`in` eller `out`) flyttad till `to`. Vid en mjuk punkt följer den andra styrpunkten med i motsatt riktning
 * (samma längd som förut), så att kurvan förblir jämn genom punkten; vid ett hörn (styrpunkterna inte på en linje) flyttas
 * bara den ena.
 */
export function moveHandle(object: MapObject, address: VertexAddress, which: "in" | "out", to: Point): MapObject {
  const parts = objectParts(object);
  const part = parts[address.part];
  const command = part?.[address.index];
  if (!part || !command) return object;
  const next = [...part];
  const after = next[address.index + 1];
  const vertex = at(command);
  const opposite = (other: Point) => {
    const length = Math.hypot(other.x - vertex.x, other.y - vertex.y);
    const dx = vertex.x - to.x, dy = vertex.y - to.y, d = Math.hypot(dx, dy);
    return d === 0 ? other : { x: vertex.x + dx / d * length, y: vertex.y + dy / d * length };
  };
  if (which === "in") {
    if (command.type !== "C") return object;
    next[address.index] = { ...command, x2: to.x, y2: to.y };
    if (after?.type === "C" && smooth(vertex, { x: command.x2, y: command.y2 }, { x: after.x1, y: after.y1 })) {
      const o = opposite({ x: after.x1, y: after.y1 });
      next[address.index + 1] = { ...after, x1: o.x, y1: o.y };
    }
  } else {
    if (after?.type !== "C") return object;
    next[address.index + 1] = { ...after, x1: to.x, y1: to.y };
    if (command.type === "C" && smooth(vertex, { x: command.x2, y: command.y2 }, { x: after.x1, y: after.y1 })) {
      const o = opposite({ x: command.x2, y: command.y2 });
      next[address.index] = { ...command, x2: o.x, y2: o.y };
    }
  }
  parts[address.part] = next;
  return withParts(object, parts);
}
