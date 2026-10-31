/**
 * Banpåtrycket som figurer i kartans mm. Figurernas form och mått, sträckornas ändar vid ringarna och de automatiska
 * avbrotten följer Purple Pens CourseFormatter.cs och CourseObject.cs (BSD, Peter Golde); numrens läge räknas fram här.
 */
import type { Point } from "@o-tid/map-file";
import { circleGapScale, appearanceOf, sizesFor, type Sizes } from "./appearance";
import {
  alongLine, angleDegrees, bezier, cutPath, distance, nearestOnPath, pathIntersections, pathLength, place, polar
} from "./geometry";
import { legKey, rawAttribute } from "./ppen-common";
import type {
  CircleGap, ControlPoint, Course, CourseSettingDocument, OverprintOptions, OverprintPrimitive, OverprintRole
} from "./types";
import { CourseSettingEditError } from "./types";
import { enumerateCourseControls, enumerateLegs, findCourse, variations } from "./walk";

type Gap = { startDegrees: number; endDegrees: number };

interface PointObject {
  readonly control: ControlPoint;
  readonly ref: string;
  /** Riktning ut från kontrollen (grader), mot nästa kontroll eller första brytpunkten. */
  readonly angleOut: number | undefined;
  readonly exchange: boolean;
  gaps: Gap[];
}

interface LegObject {
  readonly from: string;
  readonly to: string;
  readonly path: Point[];
  readonly flagged: { readonly from: number; readonly to: number }[];
  gaps: { start: number; length: number }[];
}

/** Ringens yttre radie (för avbrott och nummer). */
function apparentRadius(kind: ControlPoint["kind"], sizes: Sizes): number {
  switch (kind) {
    case "NORMAL": return sizes.control / 2 + sizes.line / 2;
    case "FINISH": return sizes.finishOuter / 2 + sizes.line / 2;
    case "START": case "MAP_EXCHANGE": return sizes.startRadius;
    case "CROSSING_POINT": return (sizes.sprint ? 1.82 : 1.72) * sizes.ratio;
    default: return 0;
  }
}

/** Var sträckan börjar och slutar vid kontrollen (CourseFormatter.GetLegRadius). */
function legRadius(kind: ControlPoint["kind"], sizes: Sizes): number {
  switch (kind) {
    case "NORMAL": return sizes.control / 2;
    case "FINISH": return sizes.finishOuter / 2;
    case "START": case "MAP_EXCHANGE": return sizes.startRadius;
    case "CROSSING_POINT": return sizes.crossingRadius;
    default: return 0;
  }
}

/** Avbrott i grader slås ihop när de överlappar (CircleGap.SimplifyGaps). */
export function simplifyGaps(gaps: readonly Gap[]): Gap[] {
  const intervals: [number, number][] = [];
  for (const gap of gaps) {
    let start = ((gap.startDegrees % 360) + 360) % 360;
    let end = start + Math.min(360, Math.max(0, gap.endDegrees - gap.startDegrees));
    if (end - start >= 360) return [{ startDegrees: 0, endDegrees: 360 }];
    if (end > 360) { intervals.push([start, 360]); start = 0; end -= 360; }
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  if (merged.length > 1 && merged[0]![0] === 0 && merged[merged.length - 1]![1] === 360) {
    const first = merged.shift()!;
    merged[merged.length - 1]![1] = 360 + first[1];
  }
  return merged.map(([startDegrees, endDegrees]) => ({ startDegrees, endDegrees }));
}

/** Ringavbrotten för skalan (QueryEvent.GetControlGaps, med EventDB.FixControlPointGaps för äldre filer). */
function fileGaps(document: CourseSettingDocument, control: ControlPoint, printScale: number): Gap[] {
  const gaps = control.circleGaps ?? [];
  if (gaps.length === 0) return [];
  const appearance = appearanceOf(document);
  const scale = circleGapScale(appearance, printScale, document.event.mapScale);
  const of = (s: number | null) => gaps.filter(gap => gap.scale === s);
  let found: CircleGap[] = of(scale);
  if (found.length === 0) found = of(null);
  if (found.length === 0 && !appearance.circleGapsScaled && appearance.itemScaling !== "None") {
    const largest = Math.max(...gaps.map(gap => gap.scale ?? 0));
    found = of(largest);
  }
  return found.map(({ startDegrees, endDegrees }) => ({ startDegrees, endDegrees }));
}

/** Avbrott där en annan figur ligger nära ringen (CourseFormatter.CutControlWithRespectTo). */
function autoCutCircle(object: PointObject, others: readonly PointObject[], sizes: Sizes): void {
  if (object.control.kind !== "NORMAL" && object.control.kind !== "FINISH") return;
  const r1 = apparentRadius(object.control.kind, sizes);
  for (const other of others) {
    if (other === object) continue;
    const r2 = apparentRadius(other.control.kind, sizes);
    const d = distance(object.control.at, other.control.at);
    if (!(d < (r1 + r2) * 0.9 && d > (r1 + r2) * 0.35)) continue;
    const cos = (r1 * r1 + d * d - r2 * r2) / (2 * r1 * d);
    if (Math.abs(cos) >= 1) continue;
    const half = Math.acos(cos) * 180 / Math.PI;
    const angle = angleDegrees(object.control.at, other.control.at);
    object.gaps.push({ startDegrees: angle - half, endDegrees: angle + half });
  }
}

const flaggedRole = (flagged: boolean): OverprintRole => (flagged ? "FLAGGING" : "LEG");

/** Figurerna för en kontroll. */
function pointPrimitives(object: PointObject, sizes: Sizes): OverprintPrimitive[] {
  const { control, ref } = object;
  const at = control.at;
  const line = sizes.line;
  const gaps = object.gaps.length > 0 ? simplifyGaps(object.gaps) : undefined;
  const circle = (role: OverprintRole, diameter: number): OverprintPrimitive => ({
    kind: "circle", role, color: "COURSE", center: at, diameter, lineWidth: line, ...(gaps ? { gaps } : {}), ref
  });
  const triangle = (role: OverprintRole, radius: number): OverprintPrimitive => {
    const a = control.orientation ?? object.angleOut ?? 90;
    return { kind: "polyline", role, color: "COURSE", points: [0, 120, 240].map(d => polar(at, radius, a + d)), width: line, closed: true, ref };
  };
  switch (control.kind) {
    case "NORMAL":
      return object.exchange ? [circle("MAP_EXCHANGE", sizes.control), triangle("MAP_EXCHANGE", sizes.control / 2)] : [circle("CONTROL", sizes.control)];
    case "FINISH":
      return [circle("FINISH", sizes.finishOuter), circle("FINISH", sizes.finishInner)];
    case "START":
      return [triangle("START", sizes.startRadius)];
    case "MAP_EXCHANGE":
      return [triangle("MAP_EXCHANGE", sizes.startRadius)];
    case "CROSSING_POINT": {
      // Två bågar ")(" (CrossingCourseObj); ISSprOM har större avstånd mellan dem.
      const shift = sizes.sprint ? 0.175 : 0;
      const scale = sizes.crossingRadius / 2.5;
      const left = [{ x: -0.85, y: -1.5 }, { x: -0.35, y: -0.65 }, { x: -0.35, y: 0.65 }, { x: -0.85, y: 1.5 }].map(p => ({ x: p.x - shift, y: p.y }));
      const arc = (points: Point[]) => bezier(points[0]!, points[1]!, points[2]!, points[3]!).map(p => place(p, at, control.orientation ?? 0, scale));
      return [
        { kind: "polyline", role: "CROSSING_POINT", color: "COURSE", points: arc(left), width: line, ref },
        { kind: "polyline", role: "CROSSING_POINT", color: "COURSE", points: arc(left.map(p => ({ x: -p.x, y: p.y }))), width: line, ref }
      ];
    }
    case "MAP_ISSUE": {
      const a = (object.angleOut ?? 90) + 90;
      const half = 1.25 * sizes.ratio;
      return [{ kind: "polyline", role: "START", color: "COURSE", points: [polar(at, half, a), polar(at, -half, a)], width: 0.6 * sizes.ratio, ref }];
    }
  }
}

/** Sträckans linje från ring till ring (CourseFormatter.GetLegPath); `null` om ringarna går ihop. */
function legGeometry(document: CourseSettingDocument, from: ControlPoint, to: ControlPoint, sizes: Sizes): { path: Point[]; radius: number } | null {
  const bends = document.legs[legKey(from.id, to.id)]?.bends ?? [];
  const r1 = legRadius(from.kind, sizes);
  const r2 = legRadius(to.kind, sizes);
  if (distance(from.at, to.at) <= r1 + r2) return null;
  const first = alongLine(from.at, bends[0] ?? to.at, r1);
  const last = alongLine(to.at, bends[bends.length - 1] ?? from.at, r2);
  return { path: [first, ...bends, last], radius: r1 };
}

/** Snitslade delar (QueryEvent.GetLegFlagging): hela, början eller slutet fram till brytpunkten. */
function flaggedParts(document: CourseSettingDocument, from: ControlPoint, to: ControlPoint, path: Point[]): { from: number; to: number }[] {
  const leg = document.legs[legKey(from.id, to.id)];
  let flagging = leg?.flagging ?? "NONE";
  const finishMarked = to.kind === "FINISH" && to.descriptions.some(box => box.box === "all" && box.ref === "14.1");
  if (finishMarked || to.kind === "MAP_EXCHANGE" || from.kind === "MAP_ISSUE") flagging = "ALL";
  const total = pathLength(path);
  if (flagging === "ALL") return [{ from: 0, to: total }];
  if ((flagging === "BEGINNING" || flagging === "END") && leg?.flaggingAt) {
    const at = Math.max(0, Math.min(total, nearestOnPath(leg.flaggingAt, path).along));
    return flagging === "BEGINNING" ? [{ from: 0, to: at }] : [{ from: at, to: total }];
  }
  return [];
}

function cutLegAt(leg: LegObject, along: number, radius: number): void {
  leg.gaps.push({ start: along - radius, length: 2 * radius });
}

/** Etiketten för banans kontroll enligt banans `labelKind`. */
function label(course: Course, ordinal: number | undefined, control: ControlPoint, points: number | undefined): string | undefined {
  const code = control.code ?? "";
  const score = points === undefined ? "" : String(points);
  switch (course.labelKind) {
    case "SEQUENCE": return ordinal === undefined ? undefined : String(ordinal);
    case "CODE": return code || undefined;
    case "SEQUENCE_AND_CODE": return ordinal === undefined ? undefined : `${ordinal}-${code}`;
    case "SCORE": return score || undefined;
    case "CODE_AND_SCORE": return score ? `${code}-${score}` : code || undefined;
    case "SEQUENCE_AND_SCORE": return ordinal === undefined ? undefined : score ? `${ordinal}-${score}` : String(ordinal);
  }
}

interface Box { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }

const textWidth = (text: string, height: number) => Math.max(1, text.length) * 0.62 * height;

function segmentHitsBox(a: Point, b: Point, box: Box, margin: number): boolean {
  const minX = box.cx - box.w / 2 - margin, maxX = box.cx + box.w / 2 + margin;
  const minY = box.cy - box.h / 2 - margin, maxY = box.cy + box.h / 2 + margin;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dy, a.y - minY], [dy, maxY - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

function circleHitsBox(center: Point, radius: number, box: Box): boolean {
  const x = Math.max(box.cx - box.w / 2, Math.min(center.x, box.cx + box.w / 2));
  const y = Math.max(box.cy - box.h / 2, Math.min(center.y, box.cy + box.h / 2));
  return Math.hypot(center.x - x, center.y - y) < radius;
}

const boxesOverlap = (a: Box, b: Box) => Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.h + b.h;

/** Läge för numret: närmast 30° från ringen där det inte täcker linjer, ringar eller andra nummer. */
function placeLabel(
  at: Point, radius: number, gap: number, text: string, height: number,
  lines: readonly Point[][], circles: readonly { center: Point; radius: number }[], placed: readonly Box[], lineWidth: number, fixedAngle?: number
): Box {
  const w = textWidth(text, height);
  const boxAt = (degrees: number): Box => {
    const a = degrees * Math.PI / 180;
    const extent = Math.abs(Math.cos(a)) * w / 2 + Math.abs(Math.sin(a)) * height / 2;
    const center = polar(at, radius + gap + extent, degrees);
    return { cx: center.x, cy: center.y, w, h: height };
  };
  if (fixedAngle !== undefined) return boxAt(fixedAngle);
  let best: { box: Box; cost: number } | undefined;
  for (let step = 0; step < 24; step++) {
    const offset = Math.ceil(step / 2) * 15 * (step % 2 === 0 ? 1 : -1);
    const degrees = 30 + offset;
    const box = boxAt(degrees);
    let cost = Math.abs(offset) / 1000;
    for (const lineChain of lines) for (let i = 1; i < lineChain.length; i++) if (segmentHitsBox(lineChain[i - 1]!, lineChain[i]!, box, lineWidth)) cost += 10;
    for (const circle of circles) if (circleHitsBox(circle.center, circle.radius, box)) cost += 10;
    for (const other of placed) if (boxesOverlap(box, other)) cost += 20;
    if (!best || cost < best.cost) best = { box, cost };
    if (cost === 0) break;
  }
  return best!.box;
}

function allControls(document: CourseSettingDocument, printScale: number): OverprintPrimitive[] {
  const sizes = sizesFor(document, printScale);
  const objects: PointObject[] = Object.values(document.controls).map(control => ({
    control, ref: control.id, angleOut: undefined, exchange: false, gaps: fileGaps(document, control, printScale)
  }));
  for (const object of objects) autoCutCircle(object, objects, sizes);
  const out: OverprintPrimitive[] = objects.flatMap(object => pointPrimitives(object, sizes));
  const circles = objects.map(object => ({ center: object.control.at, radius: apparentRadius(object.control.kind, sizes) }));
  const placed: Box[] = [];
  for (const object of objects) {
    const code = object.control.code;
    if (object.control.kind !== "NORMAL" || !code) continue;
    const angleText = rawAttribute(object.control.raw, "control", "all-controls-code-angle");
    const fixed = angleText === undefined ? undefined : Number(angleText);
    const box = placeLabel(object.control.at, apparentRadius("NORMAL", sizes), sizes.codeDistance, code, sizes.codeHeight, [],
      circles.filter(c => c.center !== object.control.at), placed, sizes.line, Number.isFinite(fixed) ? fixed : undefined);
    placed.push(box);
    out.push({ kind: "text", role: "NUMBER", color: "COURSE", at: { x: box.cx, y: box.cy }, text: code, heightMm: sizes.codeHeight, align: "center", ref: object.ref });
  }
  return out;
}

/** Banpåtrycket för en bana (eller alla kontroller). */
export function layout(document: CourseSettingDocument, options: OverprintOptions): OverprintPrimitive[] {
  if (options.course === "ALL_CONTROLS") {
    const allScale = Number(rawAttribute(document.event.raw, "all-controls", "print-scale"));
    return allControls(document, options.printScale ?? (allScale > 0 ? allScale : document.event.mapScale));
  }
  const course = findCourse(document, options.course);
  const printScale = options.printScale ?? course.printScale ?? document.event.mapScale;
  const sizes = sizesFor(document, printScale);
  let choices: readonly string[] | null = null;
  if (options.variant !== undefined) {
    const all = variations(document, course.id);
    const found = all.find(v => v.code === options.variant);
    if (!found && !(all.length === 0 && options.variant === "")) throw new CourseSettingEditError("NOT_FOUND", `Varianten ${options.variant} finns inte`);
    choices = found?.choices ?? null;
  }
  const ccIds = enumerateCourseControls(document, course.id, choices);
  const legPairs = enumerateLegs(document, course.id, choices);
  const controlOf = (ccId: string) => document.controls[document.courseControls[ccId]!.control]!;

  // En figur per kontroll (gaffelkontrollen finns på flera av banans kontroller).
  const objects = new Map<string, PointObject>();
  for (const ccId of ccIds) {
    const control = controlOf(ccId);
    if (objects.has(control.id)) continue;
    const next = document.courseControls[ccId]!.next;
    let angleOut: number | undefined;
    if (next !== undefined) {
      const target = document.legs[legKey(control.id, controlOf(next).id)]?.bends[0] ?? controlOf(next).at;
      if (distance(control.at, target) > 0) angleOut = angleDegrees(control.at, target);
    }
    const exchange = rawAttribute(document.courseControls[ccId]!.raw, "course-control", "map-exchange")?.toLowerCase() === "true";
    objects.set(control.id, { control, ref: ccId, angleOut, exchange, gaps: fileGaps(document, control, printScale) });
  }
  const points = [...objects.values()];

  const legs: LegObject[] = [];
  const seen = new Set<string>();
  for (const [a, b] of legPairs) {
    const from = controlOf(a);
    const to = controlOf(b);
    const key = legKey(from.id, to.id);
    if (seen.has(key) || from.id === to.id) continue;
    seen.add(key);
    const geometry = legGeometry(document, from, to, sizes);
    if (!geometry) continue;
    const fileLegGaps = (document.legs[key]?.gaps ?? []).map(g => ({ start: g.start - geometry.radius, length: g.length }));
    legs.push({ from: from.id, to: to.id, path: geometry.path, flagged: flaggedParts(document, from, to, geometry.path), gaps: fileLegGaps });
  }

  // Automatiska avbrott (CourseFormatter.AutoCutLegs): en senare sträcka bryts där den korsar en tidigare, och där
  // den går nära en annan kontroll.
  if (sizes.autoLegGap > 0) {
    legs.forEach((leg, index) => {
      for (let earlier = 0; earlier < index; earlier++) {
        for (const hit of pathIntersections(leg.path, legs[earlier]!.path)) cutLegAt(leg, hit.along, sizes.autoLegGap / 2);
      }
      for (const object of points) {
        const r = apparentRadius(object.control.kind, sizes);
        if (r === 0) continue;
        const radiusOther = r + sizes.line * 2;
        const near = nearestOnPath(object.control.at, leg.path);
        if (near.distance < radiusOther && distance(near.point, leg.path[0]!) > 0.5 * sizes.ratio && distance(near.point, leg.path[leg.path.length - 1]!) > 0.5 * sizes.ratio) {
          cutLegAt(leg, near.along, Math.sqrt(radiusOther * radiusOther - near.distance * near.distance) + sizes.autoLegGap / 2);
        }
      }
    });
  }
  for (const object of points) autoCutCircle(object, points, sizes);

  const out: OverprintPrimitive[] = [];
  const legLines: Point[][] = [];
  for (const leg of legs) {
    const ref = legKey(leg.from, leg.to);
    const total = pathLength(leg.path);
    // Delas i snitslade och vanliga delar, sedan i avbrotten.
    const bounds = [...new Set([0, total, ...leg.flagged.flatMap(part => [part.from, part.to])])].sort((x, y) => x - y);
    for (let i = 1; i < bounds.length; i++) {
      const start = bounds[i - 1]!;
      const end = bounds[i]!;
      if (end - start <= 0) continue;
      const flagged = leg.flagged.some(part => part.from <= start && part.to >= end);
      const outside = [{ start: 0, length: start }, { start: end, length: total - end }];
      for (const piece of cutPath(leg.path, [...leg.gaps, ...outside])) {
        legLines.push(piece);
        out.push({
          kind: "polyline", role: flaggedRole(flagged), color: "COURSE", points: piece, width: sizes.line,
          ...(flagged ? { dash: [2.0 * sizes.ratio, 0.5 * sizes.ratio] } : {}), ref
        });
      }
    }
  }
  for (const object of points) out.push(...pointPrimitives(object, sizes));

  // Numren: samma kontroll två gånger får "3/7".
  const ordinals = new Map<string, number[]>();
  const firstOrdinal = Number(rawAttribute(course.raw, "first", "control-number") ?? "1");
  const numberingPaths = choices ? [choices] : variations(document, course.id).map(v => v.choices);
  const paths = numberingPaths.length > 0 ? numberingPaths : [null];
  for (const path of paths) {
    let ordinal = Number.isInteger(firstOrdinal) ? firstOrdinal : 1;
    for (const ccId of enumerateCourseControls(document, course.id, path)) {
      if (controlOf(ccId).kind !== "NORMAL") continue;
      const control = controlOf(ccId).id;
      const list = ordinals.get(control) ?? [];
      if (!list.includes(ordinal)) list.push(ordinal);
      ordinals.set(control, list);
      ordinal++;
    }
  }
  const circles = points.map(object => ({ center: object.control.at, radius: apparentRadius(object.control.kind, sizes) }));
  const placed: Box[] = [];
  for (const object of points) {
    if (object.control.kind !== "NORMAL") continue;
    const cc = document.courseControls[object.ref]!;
    const numbers = course.kind === "SCORE" ? undefined : ordinals.get(object.control.id);
    const text = course.labelKind === "SEQUENCE" && numbers && numbers.length > 1
      ? numbers.join("/")
      : label(course, numbers?.[0], object.control, cc.points);
    if (!text) continue;
    let at: Point;
    if (cc.numberAt) {
      at = cc.numberAt;
      placed.push({ cx: at.x, cy: at.y, w: textWidth(text, sizes.numberHeight), h: sizes.numberHeight });
    } else {
      const box = placeLabel(object.control.at, apparentRadius("NORMAL", sizes), sizes.numberDistance, text, sizes.numberHeight, legLines,
        circles.filter(c => c.center !== object.control.at), placed, sizes.line);
      placed.push(box);
      at = { x: box.cx, y: box.cy };
    }
    out.push({ kind: "text", role: "NUMBER", color: "COURSE", at, text, heightMm: sizes.numberHeight, align: "center", ref: object.ref });
  }
  return out;
}
