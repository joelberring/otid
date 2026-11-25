import type { DashSpec, Path, Point } from "../model";
import { markedLines } from "./along";
import { offsetPolyline, type Polyline } from "./geometry";

/**
 * Anpassad streckning längs linjer mellan hörn- och streckpunkter (styrpunkter), för både skärm och PDF.
 * Varje delsträcka mellan start, styrpunkter och slut börjar och slutar med ett streck (`endLength`), med antal
 * mellanrum avrundat och måtten jämt skalade så att mönstret går jämnt ut och styrpunkter aldrig hamnar i ett mellanrum.
 */

const EPSILON = 1e-6;

/** Streckintervallen `[start, slut]` (mm från delsträckans början) på en delsträcka med längden `length`. */
export function dashIntervals(length: number, spec: DashSpec): [number, number][] {
  if (!(length > EPSILON)) return [];
  let mainLength = spec.mainLength;
  let mainGap = Math.max(0, spec.mainGap);
  let secondaryGap = Math.max(0, spec.secondaryGap ?? 0);
  if (mainGap <= 0 && secondaryGap > 0) {
    mainGap = secondaryGap;
    mainLength = Math.max(0, mainLength - secondaryGap);
    secondaryGap = 0;
  }
  const endLength = spec.endLength > 0 ? spec.endLength : mainLength;
  if (!(mainLength > 0) || !(mainGap > 0)) return [[0, length]];
  if (length <= 2 * endLength + EPSILON) return [[0, length]];

  // För n mellanrum: T(n) = 2·endLength + (n − 1)·mainLength + n·mainGap.
  const gaps = Math.max(1, Math.round((length - 2 * endLength + mainLength) / (mainLength + mainGap)));
  const nominal = 2 * endLength + (gaps - 1) * mainLength + gaps * mainGap;
  if (!(nominal > 0)) return [[0, length]];
  const scale = length / nominal;
  const end = endLength * scale;
  const full = mainLength * scale;
  const gap = mainGap * scale;
  const sec = secondaryGap > 0 && secondaryGap < mainLength ? secondaryGap * scale : 0;

  const out: [number, number][] = [];
  const pushDash = (from: number, to: number, allowSecondary: boolean) => {
    if (to - from <= EPSILON) return;
    if (allowSecondary && sec > EPSILON && to - from > sec + EPSILON) {
      const mid = (from + to) / 2;
      out.push([from, mid - sec / 2], [mid + sec / 2, to]);
    } else {
      out.push([from, to]);
    }
  };

  pushDash(0, end, false);
  let pos = end + gap;
  for (let k = 0; k < gaps - 1; k += 1) {
    pushDash(pos, pos + full, true);
    pos += full + gap;
  }
  pushDash(Math.max(0, length - end), length, false);
  return out;
}

/** Klipper ut polylinjen mellan avstånden `from` och `to` längs `points` (med kumulativa längder `cum`). */
function slicePolyline(points: Polyline, cum: readonly number[], from: number, to: number): Polyline {
  const out: Point[] = [];
  const add = (point: Point) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > EPSILON) out.push(point);
  };
  const at = (distance: number, segment: number): Point => {
    const segLen = cum[segment + 1]! - cum[segment]!;
    const t = segLen > 0 ? Math.min(1, Math.max(0, (distance - cum[segment]!) / segLen)) : 0;
    const a = points[segment]!, b = points[segment + 1]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  let seg = 0;
  while (seg < cum.length - 2 && cum[seg + 1]! < from - EPSILON) seg += 1;
  add(at(from, seg));
  while (seg < cum.length - 2 && cum[seg + 1]! < to - EPSILON) {
    seg += 1;
    add(points[seg]!);
  }
  add(at(to, seg));
  return out;
}

/** Streckens färdiga polylinjer för `paths` (efter `withoutGaps`), delade i varje hörn- och streckpunkt. */
export function dashPolylines(paths: readonly Path[], spec: DashSpec, offset?: number): Polyline[] {
  const result: Polyline[] = [];
  for (const path of paths) {
    for (const line of markedLines(path)) {
      const points = offset ? offsetPolyline(line.points, offset) : line.points;
      const last = points.length - 1;
      if (last < 1) continue;
      const stops = [0, ...line.breaks.filter(index => index > 0 && index < last).sort((a, b) => a - b), last];
      for (let s = 1; s < stops.length; s += 1) {
        const start = stops[s - 1] ?? 0;
        const end = stops[s] ?? last;
        const piece = points.slice(start, end + 1);
        if (piece.length < 2) continue;
        const cum: number[] = [0];
        for (let i = 1; i < piece.length; i += 1) {
          cum.push(cum[i - 1]! + Math.hypot(piece[i]!.x - piece[i - 1]!.x, piece[i]!.y - piece[i - 1]!.y));
        }
        const total = cum[cum.length - 1]!;
        for (const [d0, d1] of dashIntervals(total, spec)) {
          const dashed = slicePolyline(piece, cum, d0, d1);
          if (dashed.length >= 2) result.push(dashed);
        }
      }
    }
  }
  return result;
}
