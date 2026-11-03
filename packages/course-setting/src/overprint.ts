/**
 * Banpåtrycket som figurer i kartans mm. Figurernas form och mått, sträckornas ändar vid ringarna och de automatiska
 * avbrotten följer Purple Pens CourseFormatter.cs och CourseObject.cs (BSD, Peter Golde); numrens läge räknas fram här.
 */
import type { Point } from "@o-tid/map-file";
import { circleGapScale, appearanceOf, sizesFor, type Sizes } from "./appearance";
import { simplifyGaps } from "./arcs";
import { scoreOrdinals } from "./description-format";
import { obstacleCost, type NumberObstacles } from "./number-obstacles";
import { detailGapKey, detailGapsForView, gapsAtScale, overlapGaps, type OverlapFigure } from "./circle-cutting";
import {
  alongLine, angleDegrees, bezier, cutPath, distance, nearestOnPath, pathIntersections, pathLength, place, polar
} from "./geometry";
import { legKey, rawAttribute } from "./ppen-common";
import type {
  ControlPoint, Course, CourseSettingDocument, OverprintOptions, OverprintPrimitive, OverprintRole
} from "./types";
import { CourseSettingEditError } from "./types";
import { inPaintOrder, specialPrimitives, specialVisible } from "./specials";
import { enumerateCourseControls, enumerateLegs, findCourse, variations } from "./walk";
import { withTraining } from "./training-overprint";
import { courseParts, partShowsFinish } from "./course-parts";

type Gap = { startDegrees: number; endDegrees: number };

/**
 * Textens em-höjd per siffhöjd (NormalCourseAppearance: em 5,57 ger IOF:s 4 mm höga siffror, koderna em 4,18 för 3 mm).
 * Storlekarna i `Sizes` är siffrornas höjd; figurens `heightMm` är em-höjden (steg 64).
 */
const NUMBER_EM_PER_DIGIT = 5.57 / 4;
const CODE_EM_PER_DIGIT = 4.18 / 3;

interface PointObject {
  readonly control: ControlPoint;
  readonly ref: string;
  /** Riktning ut från kontrollen (grader), mot nästa kontroll eller första brytpunkten. */
  readonly angleOut: number | undefined;
  readonly exchange: boolean;
  gaps: Gap[];
  /** Målets inre ring när den klipps för sig (överlappsklippen); annars samma som `gaps`. */
  innerGaps?: Gap[];
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

/**
 * Var sträckan börjar och slutar vid kontrollen: utanför figurens yttre kant med mellanrummet `legCircleGap` (ADR-0211
 * beslut 2, ISOM 2017-2 705). Purple Pen (CourseFormatter.GetLegRadius) slutar i ringens linje; med mellanrummet 0 blir det
 * likadant utom att linjen slutar vid ringens ytterkant.
 */
function legRadius(kind: ControlPoint["kind"], sizes: Sizes): number {
  const gap = sizes.legCircleGap;
  switch (kind) {
    case "NORMAL": return sizes.control / 2 + sizes.line / 2 + gap;
    case "FINISH": return sizes.finishOuter / 2 + sizes.line / 2 + gap;
    case "START": case "MAP_EXCHANGE": return sizes.startRadius + gap;
    case "CROSSING_POINT": return sizes.crossingRadius + gap;
    default: return 0;
  }
}

/** Ringavbrotten för skalan (QueryEvent.GetControlGaps, med EventDB.FixControlPointGaps för äldre filer). */
function fileGaps(document: CourseSettingDocument, control: ControlPoint, printScale: number): Gap[] {
  const scale = circleGapScale(appearanceOf(document), printScale, document.event.mapScale);
  return gapsAtScale(document, control, scale).map(({ startDegrees, endDegrees }) => ({ startDegrees, endDegrees }));
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

/** Ringens radie till linjens mitt (för överlapps- och detaljklippen). */
function ringRadius(kind: ControlPoint["kind"], sizes: Sizes): number {
  return kind === "NORMAL" ? sizes.control / 2 : kind === "FINISH" ? sizes.finishOuter / 2 : 0;
}

/**
 * Ringklippen för kartbilden (ADR-0180 beslut 10). Utan `circleCutting.overlap` Purple Pens automatiska avbrott; med det
 * tas bågen inne i en annan ring bort. Med `circleCutting.details` läggs detaljgapen till, utom där en sträcka går ut.
 */
function cutCircles(document: CourseSettingDocument, objects: readonly PointObject[], sizes: Sizes, legs: readonly LegObject[],
  options: OverprintOptions): void {
  const cutting = document.event.circleCutting;
  const before = objects.map(object => object.gaps.length);
  if (!cutting?.overlap) {
    for (const object of objects) autoCutCircle(object, objects, sizes);
  } else {
    const figures: OverlapFigure[] = objects.map((object, index) => {
      const { kind } = object.control;
      const rings = kind === "NORMAL" ? [sizes.control / 2] : kind === "FINISH" ? [sizes.finishOuter / 2, sizes.finishInner / 2] : [];
      const lines = kind === "START" || kind === "MAP_EXCHANGE" || kind === "CROSSING_POINT"
        ? pointPrimitives(object, sizes).flatMap(p => p.kind === "polyline" ? [{ points: p.points, closed: p.closed === true }] : [])
        : undefined;
      return { at: object.control.at, rings, lineWidth: sizes.line, rank: (kind === "FINISH" ? 0 : 1_000_000) + index, ...(lines ? { lines } : {}) };
    });
    overlapGaps(figures).forEach((rings, index) => {
      const object = objects[index]!;
      if (rings.length === 0) return;
      object.innerGaps = [...object.gaps, ...(rings[1] ?? [])];
      object.gaps.push(...rings[0]!);
    });
  }
  const detail = cutting?.details ? options.detailGaps : undefined;
  if (!detail) return;
  objects.forEach((object, index) => {
    const { id, kind, at } = object.control;
    const radius = ringRadius(kind, sizes);
    if (radius === 0) return;
    // Gapen räknades för just den här ringens storlek (en kontroll kan synas i flera skalor, och målet har två ringar).
    const of = (r: number) => detail[detailGapKey(id, r)] ?? detail[id] ?? [];
    const legDegrees = legs.flatMap(leg => {
      if (leg.from === id) return [angleDegrees(at, leg.path[0]!)];
      if (leg.to === id) return [angleDegrees(at, leg.path[leg.path.length - 1]!)];
      return [];
    });
    const fileGaps = object.gaps.slice(0, before[index]);
    const outerCuts = object.gaps.slice(before[index]);
    const outer = detailGapsForView(of(radius), outerCuts, legDegrees, radius, sizes.line);
    if (kind === "FINISH") {
      const inner = sizes.finishInner / 2;
      const innerCuts = object.innerGaps ? object.innerGaps.slice(before[index]) : outerCuts;
      object.innerGaps = [...fileGaps, ...innerCuts, ...detailGapsForView(of(inner), innerCuts, legDegrees, inner, sizes.line)];
    }
    object.gaps.push(...outer);
  });
}

const flaggedRole = (flagged: boolean): OverprintRole => (flagged ? "FLAGGING" : "LEG");

/** Figurerna för en kontroll. */
function pointPrimitives(object: PointObject, sizes: Sizes): OverprintPrimitive[] {
  const { control, ref } = object;
  const at = control.at;
  const line = sizes.line;
  const simplified = (list: readonly Gap[]) => list.length > 0 ? simplifyGaps(list) : undefined;
  const outerGaps = simplified(object.gaps);
  const innerGaps = object.innerGaps ? simplified(object.innerGaps) : outerGaps;
  const circle = (role: OverprintRole, diameter: number, gaps: Gap[] | undefined): OverprintPrimitive => ({
    kind: "circle", role, color: "COURSE", center: at, diameter, lineWidth: line, ...(gaps ? { gaps } : {}), ref
  });
  const triangle = (role: OverprintRole, radius: number): OverprintPrimitive => {
    // Spetsen mot nästa kontroll; en angiven orientering vrider figuren moturs från spetsen uppåt, som passagen.
    const a = control.orientation !== undefined ? control.orientation + 90 : object.angleOut ?? 90;
    return { kind: "polyline", role, color: "COURSE", points: [0, 120, 240].map(d => polar(at, radius, a + d)), width: line, closed: true, ref };
  };
  switch (control.kind) {
    case "NORMAL":
      return object.exchange ? [circle("MAP_EXCHANGE", sizes.control, outerGaps), triangle("MAP_EXCHANGE", sizes.control / 2)] : [circle("CONTROL", sizes.control, outerGaps)];
    case "FINISH":
      return [circle("FINISH", sizes.finishOuter, outerGaps), circle("FINISH", sizes.finishInner, innerGaps)];
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
        // Undre lila som hos Purple Pen (CrossingCourseObj).
        { kind: "polyline", role: "CROSSING_POINT", color: "COURSE_LOWER", points: arc(left), width: line, ref },
        { kind: "polyline", role: "CROSSING_POINT", color: "COURSE_LOWER", points: arc(left.map(p => ({ x: -p.x, y: p.y }))), width: line, ref }
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

/**
 * Texten vid kontrollen enligt banans `labelKind`, som Purple Pen (CourseFormatter.GetControlLabelText): "3", "31",
 * "3-31", poäng "30", "31(30)" och "3(30)". En kontroll som besöks flera gånger får alla nummer ("3/7", "3/7-31").
 * Poäng som saknas eller är 0 visas inte. `undefined` = ingen text.
 */
export function controlLabelText(labelKind: Course["labelKind"], parts: { readonly ordinals?: readonly number[] | undefined;
  readonly code?: string | undefined; readonly points?: number | undefined }): string | undefined {
  const sequence = parts.ordinals && parts.ordinals.length > 0 ? parts.ordinals.join("/") : undefined;
  const code = parts.code ?? "";
  const score = parts.points !== undefined && parts.points > 0 ? String(parts.points) : "";
  switch (labelKind) {
    case "SEQUENCE": return sequence;
    case "CODE": return code || undefined;
    case "SEQUENCE_AND_CODE": return sequence === undefined ? undefined : `${sequence}-${code}`;
    case "SCORE": return score || undefined;
    case "CODE_AND_SCORE": return `${code}${score ? `(${score})` : ""}` || undefined;
    case "SEQUENCE_AND_SCORE": return sequence === undefined ? undefined : `${sequence}${score ? `(${score})` : ""}`;
  }
}

interface Box { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }

// Siffrornas bredd i Arial/Roboto är 0,556 em, alltså 0,78 av siffhöjden; "-", "/" och parenteserna är smalare, så
// "12-145" och "31(30)" räknas något för breda (hellre lite för stort mellanrum än krock).
const textWidth = (text: string, height: number) => Math.max(1, text.length) * 0.78 * height;
// Parenteserna går under baslinjen och över siffrorna.
const textHeight = (text: string, height: number) => (/[()]/.test(text) ? 1.3 * height : height);

/** Rutan som texten täcker när mitten ligger i `at`. */
function labelBox(at: Point, text: string, height: number): Box {
  return { cx: at.x, cy: at.y, w: textWidth(text, height), h: textHeight(text, height) };
}

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
  lines: readonly Point[][], circles: readonly { center: Point; radius: number }[], placed: readonly Box[], lineWidth: number, fixedAngle?: number,
  obstacles?: NumberObstacles
): Box {
  const w = textWidth(text, height);
  const h = textHeight(text, height);
  const boxAt = (degrees: number): Box => {
    const a = degrees * Math.PI / 180;
    // Rutans närmaste kant (i riktningen) hamnar `gap` utanför ringen, hur bred texten än är.
    const extent = Math.abs(Math.cos(a)) * w / 2 + Math.abs(Math.sin(a)) * h / 2;
    const center = polar(at, radius + gap + extent, degrees);
    return { cx: center.x, cy: center.y, w, h };
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
    // Kartans hinder (ADR-0211 beslut 4): hus och mörka ytor, svarta linjer.
    cost += obstacleCost(box, obstacles);
    if (!best || cost < best.cost) best = { box, cost };
    if (cost === 0) break;
  }
  return best!.box;
}

function allControls(document: CourseSettingDocument, printScale: number, options: OverprintOptions): OverprintPrimitive[] {
  const sizes = sizesFor(document, printScale);
  const objects: PointObject[] = Object.values(document.controls).map(control => ({
    control, ref: control.id, angleOut: undefined, exchange: false, gaps: fileGaps(document, control, printScale)
  }));
  cutCircles(document, objects, sizes, [], options);
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
    out.push({ kind: "text", role: "NUMBER", color: "COURSE", at: { x: box.cx, y: box.cy }, text: code, heightMm: sizes.codeHeight * CODE_EM_PER_DIGIT, align: "center", ref: object.ref });
  }
  return out;
}

/** Utskriftsskalan för banan (eller Alla kontroller): vald, banans eller kartans. */
export function printScaleOf(document: CourseSettingDocument, course: string, printScale?: number): number {
  if (printScale !== undefined) return printScale;
  if (course === "ALL_CONTROLS") return document.event.allControlsPrintScale ?? document.event.mapScale;
  return findCourse(document, course).printScale ?? document.event.mapScale;
}

/**
 * Banpåtrycket för en bana (eller alla kontroller) med specialobjekten som syns där (steg 64), i målningsordning. Som i
 * Purple Pen kommer specialobjekten före banans figurer inom samma färg.
 */
export function layout(document: CourseSettingDocument, options: OverprintOptions): OverprintPrimitive[] {
  const printScale = printScaleOf(document, options.course, options.printScale);
  const course = options.course === "ALL_CONTROLS" ? allControls(document, printScale, options) : layoutCourse(document, options, printScale);
  const context = { document, course: options.course, variant: options.variant, printScale, sizes: sizesFor(document, printScale) };
  // Kontrollbeskrivningen hör till papperet (`paper-layout.ts`), inte kartan: Purple Pens `descriptions` ritas inte här.
  const specials = document.specialObjects.filter(special => special.kind !== "descriptions" && specialVisible(special, options.course, options.part))
    .flatMap(special => specialPrimitives(context, special));
  // Träningsläget (ADR-0192 beslut 7): sista säkra, markeringar, kepsens etiketter, linjen och avsnittet.
  return withTraining(document, options, inPaintOrder([...specials, ...course]), printScale);
}

/** Överlappets andel av banans färg vid ett kartbyte (ADR-0203). */
export const OVERLAP_FADE = 0.35;

function layoutCourse(document: CourseSettingDocument, options: OverprintOptions, printScale: number): OverprintPrimitive[] {
  const course = findCourse(document, options.course);
  const sizes = sizesFor(document, printScale);
  let choices: readonly string[] | null = null;
  if (options.variant !== undefined) {
    const all = variations(document, course.id);
    const found = all.find(v => v.code === options.variant);
    if (!found && !(all.length === 0 && options.variant === "")) throw new CourseSettingEditError("NOT_FOUND", `Varianten ${options.variant} finns inte`);
    choices = found?.choices ?? null;
  }
  const controlOf = (ccId: string) => document.controls[document.courseControls[ccId]!.control]!;
  // Kartbyten (ADR-0203): en del av banan, som Purple Pens CourseView för en del.
  const parts = options.part !== undefined ? courseParts(document, course.id, options.variant) : [];
  const part = options.part !== undefined && parts.length > 1 ? Math.min(Math.max(0, options.part), parts.length - 1) : undefined;
  const partList = part !== undefined ? parts[part]! : undefined;
  let ccIds = partList ? [...partList] : enumerateCourseControls(document, course.id, choices);
  const legPairs: [string, string][] = partList
    ? (course.kind === "SCORE" ? [] : partList.slice(1).map((ccId, index) => [partList[index]!, ccId] as [string, string]))
    : enumerateLegs(document, course.id, choices);
  // Målet också på en del som inte är den sista (Purple Pens part-options show-finish).
  if (partList && part! < parts.length - 1 && partShowsFinish(document, course.id, part!)) {
    const last = parts[parts.length - 1]!;
    const finish = last[last.length - 1];
    if (finish && controlOf(finish).kind === "FINISH") ccIds = [...ccIds, finish];
  }
  // Kartbytet sist i en del (inte den sista) ritas inte om det är ett eget kartbyte; först i en del är det delens start.
  const partEnd = partList && part! < parts.length - 1 ? partList[partList.length - 1] : undefined;
  const partStart = partList && part! > 0 ? partList[0] : undefined;
  if (partEnd && controlOf(partEnd).kind === "MAP_EXCHANGE") ccIds = ccIds.filter(ccId => ccId !== partEnd);

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
    const exchange = partList ? ccId === partStart : rawAttribute(document.courseControls[ccId]!.raw, "course-control", "map-exchange")?.toLowerCase() === "true";
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
  cutCircles(document, points, sizes, legs, options);

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
  // Överlappet (ADR-0203): föregående dels sista sträcka (eller hela delen) tonad, utan nummer.
  if (part !== undefined && part > 0 && (options.overlap ?? "LAST_LEG") !== "NONE") {
    const previous = parts[part - 1]!;
    const shown = options.overlap === "PREVIOUS_PART" ? previous : previous.slice(-2);
    for (let i = 1; i < shown.length; i++) {
      const from = controlOf(shown[i - 1]!), to = controlOf(shown[i]!);
      if (from.id === to.id) continue;
      const geometry = legGeometry(document, from, to, sizes);
      if (geometry) out.push({ kind: "polyline", role: "OVERLAP", color: "COURSE", points: geometry.path, width: sizes.line, fade: OVERLAP_FADE,
        ref: legKey(from.id, to.id) });
    }
    for (const ccId of shown.slice(0, -1)) {
      const control = controlOf(ccId);
      if (objects.has(control.id)) continue;
      for (const figure of pointPrimitives({ control, ref: ccId, angleOut: undefined, exchange: false, gaps: [] }, sizes)) {
        out.push({ ...figure, role: "OVERLAP", fade: OVERLAP_FADE } as OverprintPrimitive);
      }
    }
  }

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
  // Poängbanan: numren i beskrivningens ordning, efter poäng och kod (CourseView.CreateScoreCourseView).
  const scoreNumbers = course.kind === "SCORE" ? scoreOrdinals(document, course) : undefined;
  const circles = points.map(object => ({ center: object.control.at, radius: apparentRadius(object.control.kind, sizes) }));
  const labels = points.flatMap(object => {
    if (object.control.kind !== "NORMAL") return [];
    const cc = document.courseControls[object.ref]!;
    const numbers = scoreNumbers ? scoreNumbers.get(object.control.id) : ordinals.get(object.control.id);
    const text = controlLabelText(course.labelKind, { ordinals: numbers, code: object.control.code, points: cc.points });
    return text ? [{ object, cc, text }] : [];
  });
  // Som Purple Pen läggs de flyttade numren först, så att de automatiska undviker dem.
  const placed: Box[] = labels.flatMap(({ cc, text }) => cc.numberAt ? [labelBox(cc.numberAt, text, sizes.numberHeight)] : []);
  for (const { object, cc, text } of labels) {
    let at: Point;
    if (cc.numberAt) {
      at = cc.numberAt;
    } else {
      const box = placeLabel(object.control.at, apparentRadius("NORMAL", sizes), sizes.numberDistance, text, sizes.numberHeight, legLines,
        circles.filter(c => c.center !== object.control.at), placed, sizes.line, undefined, options.numberObstacles?.[object.control.id]);
      placed.push(box);
      at = { x: box.cx, y: box.cy };
    }
    out.push({ kind: "text", role: "NUMBER", color: "COURSE", at, text, heightMm: sizes.numberHeight * NUMBER_EM_PER_DIGIT, align: "center", ref: object.ref });
  }
  return out;
}
