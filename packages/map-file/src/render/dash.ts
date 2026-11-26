import type { DashSpec, Path, Point } from "../model";
import { markedLines } from "./along";
import { offsetPolyline, type Polyline } from "./geometry";

/**
 * Anpassad streckning längs linjer mellan hörn- och streckpunkter (styrpunkter), för både skärm och PDF.
 * Öppna ändar får `endLength`, medan inre styrpunkter får ett halvt streck (`mainLength / 2`) på vardera sidan som
 * sys ihop till ett helt streck utan hack i skarpa böjar. Antalet mellanrum avrundas och måtten skalas jämnt så att
 * mönstret går jämnt ut och styrpunkter aldrig hamnar i ett mellanrum.
 */

const EPSILON = 1e-6;

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;
}

/**
 * Streckintervallen `[start, slut]` (mm från delsträckans början) på en delsträcka med längden `length`.
 * `startInterior` / `endInterior` anger om respektive ände är en inre styrpunkt (halvt streck `mainLength / 2`)
 * i stället för en öppen linjeände (`endLength`).
 */
export function dashIntervals(
  length: number,
  spec: DashSpec,
  startInterior = false,
  endInterior = false,
  minGaps = 1
): [number, number][] {
  if (!(length > EPSILON)) return [];
  let mainLength = spec.mainLength;
  let mainGap = Math.max(0, spec.mainGap);
  let secondaryGap = Math.max(0, spec.secondaryGap ?? 0);
  if (mainGap <= 0 && secondaryGap > 0) {
    mainGap = secondaryGap;
    mainLength = Math.max(0, mainLength - secondaryGap);
    secondaryGap = 0;
  }
  if (!(mainLength > 0) || !(mainGap > 0)) return [[0, length]];
  const openEndLength = spec.endLength > 0 ? spec.endLength : mainLength;
  const startLen = startInterior ? mainLength / 2 : openEndLength;
  const endLen = endInterior ? mainLength / 2 : openEndLength;
  const minCount = Math.max(1, minGaps);
  if (minCount <= 1 && length <= (startLen + endLen) / 2 + EPSILON) return [[0, length]];
  if (minCount > 1 && length <= mainGap * minCount + EPSILON) return [[0, length]];

  // För n mellanrum: T(n) = startLen + endLen + (n − 1)·mainLength + n·mainGap.
  const gaps = Math.max(minCount, Math.round((length - startLen - endLen + mainLength) / (mainLength + mainGap)));
  const nominal = startLen + endLen + (gaps - 1) * mainLength + gaps * mainGap;
  if (!(nominal > 0)) return [[0, length]];
  const scale = length / nominal;
  const start = startLen * scale;
  const end = endLen * scale;
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

  const fullOpenEnd = openEndLength >= mainLength - EPSILON;
  pushDash(0, start, !startInterior && fullOpenEnd);
  let pos = start + gap;
  for (let k = 0; k < gaps - 1; k += 1) {
    pushDash(pos, pos + full, true);
    pos += full + gap;
  }
  pushDash(Math.max(0, length - end), length, !endInterior && fullOpenEnd);
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
      const basePoints = offset ? offsetPolyline(line.points, offset) : line.points;
      const last = basePoints.length - 1;
      if (last < 1) continue;

      const closed = basePoints.length >= 3 && samePoint(basePoints[0]!, basePoints[last]!);
      let points: Polyline = basePoints;
      let interiorStops: number[];

      if (closed) {
        const uniqueBreaks = [...new Set(
          line.breaks
            .filter(index => index >= 0 && index <= last)
            .map(index => (index === last ? 0 : index))
        )].sort((a, b) => a - b);

        if (uniqueBreaks.length > 0) {
          const firstBreak = uniqueBreaks[0]!;
          if (firstBreak > 0) {
            points = [...basePoints.slice(firstBreak, last), ...basePoints.slice(0, firstBreak), basePoints[firstBreak]!];
          }
          interiorStops = uniqueBreaks
            .slice(1)
            .map(index => (index - firstBreak + last) % last)
            .sort((a, b) => a - b);
        } else {
          interiorStops = [];
        }
      } else {
        interiorStops = line.breaks.filter(index => index > 0 && index < last).sort((a, b) => a - b);
      }

      const stops = [0, ...interiorStops, last];
      const lineDashes: Polyline[] = [];
      let prevEndedAtStop = false;

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
        const startInterior = closed || s > 1;
        const endInterior = closed || s < stops.length - 1;
        // En sluten slinga utan (eller med bara en) styrpunkt får minst två streck/mellanrum så att små knölar inte ser ut som heldragna höjdkurvor.
        const minGaps = closed && stops.length === 2 ? 2 : 1;
        const intervals = dashIntervals(total, spec, startInterior, endInterior, minGaps);
        let endedAtStop = false;

        for (let k = 0; k < intervals.length; k += 1) {
          const [d0, d1] = intervals[k]!;
          const dashed = slicePolyline(piece, cum, d0, d1);
          if (dashed.length < 2) continue;

          const prev = lineDashes[lineDashes.length - 1];
          if (k === 0 && d0 <= EPSILON && prevEndedAtStop && prev && samePoint(prev[prev.length - 1]!, dashed[0]!)) {
            prev.push(...dashed.slice(1));
          } else {
            lineDashes.push(dashed);
          }

          if (k === intervals.length - 1 && d1 >= total - EPSILON) {
            endedAtStop = true;
          }
        }
        prevEndedAtStop = endedAtStop;
      }

      if (closed && lineDashes.length >= 2 && prevEndedAtStop) {
        const first = lineDashes[0]!;
        const tail = lineDashes[lineDashes.length - 1]!;
        if (samePoint(tail[tail.length - 1]!, first[0]!)) {
          lineDashes[0] = [...tail, ...first.slice(1)];
          lineDashes.pop();
        }
      }

      result.push(...lineDashes);
    }
  }
  return result;
}
