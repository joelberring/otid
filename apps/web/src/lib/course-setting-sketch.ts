import {
  COURSE_SETTING_SKETCH_MAX_POINTS, COURSE_SETTING_SKETCH_MAX_SHAPES, type CourseSettingSketchShape
} from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";

/**
 * ADR-0181 beslut 8 (ägaren 2026-11-02: "fint att kunna rita med ett streck … en del stigar fel och beståndsgränser lite
 * felplacerade"): ritläget för en notis, utan React och utan antaganden om mus eller finger.
 *
 * - **Dra** ritar fritt (`startStroke`, `extendStroke`, `endStroke`); linjen förenklas när den släpps (Douglas–Peucker),
 *   så att en frihandslinje blir några tiotal punkter i stället för hundratals.
 * - **Klicka** lägger punkter en i taget i en egen linje eller yta (`addClickPoint`), som avslutas med `finishShape`
 *   (Enter, knappen eller när något annat börjar).
 * - Ett andra finger avbryter strecket som pågår (`cancelStroke`): två fingrar panorerar och zoomar.
 * - Slag (kartfel röd, snitsel orange, allmänt blå), form (linje eller yta) och betydelse ("är fel" streckad, "ska vara
 *   här" med pil) gäller det som ritas härnäst.
 * - Högst `COURSE_SETTING_SKETCH_MAX_POINTS` punkter och `COURSE_SETTING_SKETCH_MAX_SHAPES` delar (servern prövar samma).
 */
export type SketchStyle = CourseSettingSketchShape["style"];
export type SketchIntent = CourseSettingSketchShape["intent"];
export type SketchShapeKind = CourseSettingSketchShape["kind"];

export interface SketchDraft {
  readonly shapes: readonly CourseSettingSketchShape[];
  /** Det som pågår: ett frihandsstreck (dra) eller en linje/yta punkt för punkt (klick). */
  readonly current?: { readonly input: "STROKE" | "CLICKS"; readonly points: readonly Point[] } | undefined;
  readonly shape: SketchShapeKind;
  readonly style: SketchStyle;
  readonly intent: SketchIntent;
}

export const SKETCH_COLORS: Readonly<Record<SketchStyle, string>> = { MAP_ERROR: "rgb(220, 20, 30)", MARKING: "rgb(245, 130, 0)",
  GENERAL: "rgb(0, 100, 220)" };

export function createSketch(style: SketchStyle = "MAP_ERROR"): SketchDraft {
  return { shapes: [], shape: "LINE", style, intent: null };
}

const minimum = (kind: SketchShapeKind) => kind === "AREA" ? 3 : 2;
const round = (point: Point): Point => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });

export function sketchPointCount(draft: Pick<SketchDraft, "shapes" | "current">): number {
  return draft.shapes.reduce((sum, shape) => sum + shape.points.length, 0) + (draft.current?.points.length ?? 0);
}

/** Ritningen är full: inga fler punkter eller delar. */
export function sketchFull(draft: SketchDraft): boolean {
  return sketchPointCount(draft) >= COURSE_SETTING_SKETCH_MAX_POINTS || (draft.shapes.length >= COURSE_SETTING_SKETCH_MAX_SHAPES && !draft.current);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Douglas–Peucker: punkterna som behövs för att linjen ska avvika högst `tolerance` (mm). Ändpunkterna behålls. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true; keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1, worst = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const distance = distanceToSegment(points[i]!, points[first]!, points[last]!);
      if (distance > worst) { worst = distance; index = i; }
    }
    if (index >= 0) { keep[index] = true; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Det pågående som en del, om det räcker till en (linje minst två punkter, yta minst tre). */
function committed(draft: SketchDraft, toleranceMm: number): SketchDraft {
  const current = draft.current;
  if (!current) return draft;
  const points = (current.input === "STROKE" ? simplify(current.points, toleranceMm) : [...current.points]).map(round);
  // Ett streck som slutar där det började (inom toleransen) blir inte en yta av sig självt; formen avgör.
  const unique = points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 0);
  const next = { ...draft, current: undefined };
  if (unique.length < minimum(draft.shape) || draft.shapes.length >= COURSE_SETTING_SKETCH_MAX_SHAPES) return next;
  return { ...next, shapes: [...draft.shapes, { kind: draft.shape, style: draft.style, intent: draft.intent, points: unique }] };
}

/** Ett streck börjar (dra). Något som ritades punkt för punkt avslutas först. */
export function startStroke(draft: SketchDraft, at: Point, toleranceMm = 0.2): SketchDraft {
  const done = committed(draft, toleranceMm);
  if (sketchFull(done)) return done;
  return { ...done, current: { input: "STROKE", points: [at] } };
}

/** Strecket fortsätter: en punkt läggs till när den är minst `stepMm` från den förra (och så länge det finns plats). */
export function extendStroke(draft: SketchDraft, at: Point, stepMm: number): SketchDraft {
  const current = draft.current;
  if (current?.input !== "STROKE") return draft;
  const last = current.points[current.points.length - 1]!;
  if (Math.hypot(at.x - last.x, at.y - last.y) < stepMm) return draft;
  // Utrymme lämnas för förenklingen: råa punkter får vara fler än gränsen, men inte obegränsat många.
  if (current.points.length >= 4 * COURSE_SETTING_SKETCH_MAX_POINTS) return draft;
  return { ...draft, current: { ...current, points: [...current.points, at] } };
}

/** Strecket släpps: förenklat (med `toleranceMm`) och begränsat till det som får plats. */
export function endStroke(draft: SketchDraft, toleranceMm: number): SketchDraft {
  if (draft.current?.input !== "STROKE") return draft;
  const room = COURSE_SETTING_SKETCH_MAX_POINTS - sketchPointCount({ shapes: draft.shapes });
  let tolerance = toleranceMm, points = simplify(draft.current.points, tolerance);
  // Får det inte plats: förenkla mer (dubbla toleransen) tills det gör det.
  for (let round = 0; points.length > room && round < 12; round += 1) { tolerance *= 2; points = simplify(draft.current.points, tolerance); }
  if (points.length > room) return { ...draft, current: undefined };
  return committed({ ...draft, current: { input: "STROKE", points } }, 0);
}

/** Ett andra finger: strecket som pågår kastas (kartan panoreras i stället). */
export function cancelStroke(draft: SketchDraft): SketchDraft {
  return draft.current?.input === "STROKE" ? { ...draft, current: undefined } : draft;
}

/** Ett klick: nästa punkt i linjen eller ytan som ritas punkt för punkt. */
export function addClickPoint(draft: SketchDraft, at: Point): SketchDraft {
  if (sketchPointCount(draft) >= COURSE_SETTING_SKETCH_MAX_POINTS) return draft;
  if (draft.current?.input === "CLICKS") return { ...draft, current: { input: "CLICKS", points: [...draft.current.points, round(at)] } };
  const done = committed(draft, 0);
  if (done.shapes.length >= COURSE_SETTING_SKETCH_MAX_SHAPES) return done;
  return { ...done, current: { input: "CLICKS", points: [round(at)] } };
}

/** Avslutar linjen eller ytan som ritas punkt för punkt. */
export function finishShape(draft: SketchDraft): SketchDraft {
  return committed(draft, 0);
}

/** Ångra: den senaste punkten (punkt för punkt), annars den senaste delen. */
export function undoSketch(draft: SketchDraft): SketchDraft {
  const current = draft.current;
  if (current && current.points.length > 1 && current.input === "CLICKS") return { ...draft, current: { ...current, points: current.points.slice(0, -1) } };
  if (current) return { ...draft, current: undefined };
  return { ...draft, shapes: draft.shapes.slice(0, -1) };
}

/** Slag, form eller betydelse för det som ritas härnäst (det pågående får samma, eftersom det inte är klart). */
export function setSketchOptions(draft: SketchDraft, options: Partial<Pick<SketchDraft, "shape" | "style" | "intent">>): SketchDraft {
  return { ...draft, ...options };
}

/** Ritningen att spara (det pågående med om det räcker till en del), eller undefined om den är tom. */
export function sketchShapes(draft: SketchDraft): readonly CourseSettingSketchShape[] | undefined {
  const done = committed(draft, 0);
  return done.shapes.length > 0 ? done.shapes : undefined;
}

/** Ritningen som den ska visas medan den ritas: delarna och det pågående (med nuvarande slag och form). */
export function sketchPreview(draft: SketchDraft): readonly CourseSettingSketchShape[] {
  const current = draft.current;
  if (!current || current.points.length === 0) return draft.shapes;
  return [...draft.shapes, { kind: current.points.length >= 3 ? draft.shape : "LINE", style: draft.style, intent: draft.intent,
    points: current.points.length === 1 ? [current.points[0]!, current.points[0]!] : [...current.points] }];
}

function insidePolygon(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Avståndet (mm) från punkten till ritningen: 0 inne i en yta. */
export function distanceToSketch(shapes: readonly CourseSettingSketchShape[], point: Point): number {
  let best = Infinity;
  for (const shape of shapes) {
    if (shape.kind === "AREA" && insidePolygon(point, shape.points)) return 0;
    const points = shape.kind === "AREA" ? [...shape.points, shape.points[0]!] : shape.points;
    for (let i = 1; i < points.length; i += 1) best = Math.min(best, distanceToSegment(point, points[i - 1]!, points[i]!));
    if (points.length === 1) best = Math.min(best, Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y));
  }
  return best;
}

/** Den närmaste ritningen inom `toleranceMm` (ett klick på kartan väljer notisen). */
export function hitSketch<T extends { readonly id: string; readonly shapes: readonly CourseSettingSketchShape[] }>(items: readonly T[], point: Point,
  toleranceMm: number): T | undefined {
  let best: T | undefined, bestDistance = Infinity;
  for (const item of items) {
    const distance = distanceToSketch(item.shapes, point);
    if (distance <= toleranceMm && distance < bestDistance) { best = item; bestDistance = distance; }
  }
  return best;
}

/** Rutan runt ritningen (mm). */
export function sketchBounds(shapes: readonly { readonly points: readonly Point[] }[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const points = shapes.flatMap(shape => shape.points);
  if (points.length === 0) return undefined;
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)) };
}
