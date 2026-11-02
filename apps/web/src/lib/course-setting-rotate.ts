import {
  courseControlOrder, legPath, normalizeDegrees, type CourseSettingDocument, type CourseSettingEdit
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import type { Selection } from "./course-setting-editor";
import { ALL_CONTROLS } from "./course-setting-hit";

/**
 * ADR-0180 beslut 13: vrida passager. Som i Purple Pen (Controller.CanRotate, RotateMode) går bara obligatorisk passage
 * (kontrollslaget CROSSING_POINT) och valfri passage (specialobjektet) att vrida; vinkeln är grader moturs och handtaget
 * pekar i vinkelns riktning från mitten (RotateMode: atan2 från mitten till musen). Vridningen fäster i steg om 5° utom
 * med Skift (eller ett andra finger). Symbolen ")(" har löparens väg längs sin egen y-axel, så en passage som står rätt
 * mot sträckan har vinkeln = sträckans riktning − 90°.
 */
export const ROTATE_STEP_DEGREES = 5;
/** Handtagets avstånd från mitten i skärmpixlar och hur nära ett tryck måste vara (finger 22, mus 10). */
export const HANDLE_DISTANCE_PX = 38;
export const handleTolerancePx = (pointerType: string) => pointerType === "touch" ? 22 : 10;

export interface Rotatable {
  readonly kind: "control" | "special";
  readonly id: string;
  readonly at: Point;
  readonly orientation: number;
}

/** Det valda som går att vrida, annars undefined. */
export function rotatableOf(document: CourseSettingDocument, selection: Selection | undefined): Rotatable | undefined {
  if (selection?.kind === "control") {
    const control = document.controls[selection.control];
    return control?.kind === "CROSSING_POINT" ? { kind: "control", id: control.id, at: control.at, orientation: control.orientation ?? 0 } : undefined;
  }
  if (selection?.kind === "special") {
    const special = document.specialObjects.find(item => item.id === selection.special);
    return special?.kind === "optional-crossing-point" && special.points[0]
      ? { kind: "special", id: special.id, at: special.points[0], orientation: special.orientation ?? 0 } : undefined;
  }
  return undefined;
}

/** Handtagets läge i kartans mm vid kartans skala `pxPerMm`. */
export function handlePosition(target: Rotatable, pxPerMm: number): Point {
  const distance = HANDLE_DISTANCE_PX / pxPerMm, radians = target.orientation * Math.PI / 180;
  return { x: target.at.x + distance * Math.cos(radians), y: target.at.y + distance * Math.sin(radians) };
}

export function nearHandle(target: Rotatable, point: Point, pxPerMm: number, pointerType: string): boolean {
  const handle = handlePosition(target, pxPerMm);
  return Math.hypot(point.x - handle.x, point.y - handle.y) * pxPerMm <= handleTolerancePx(pointerType);
}

/** Vinkeln från mitten mot punkten: i steg om 5° eller fri (Skift, andra fingret). */
export function angleTowards(center: Point, point: Point, free: boolean): number {
  const degrees = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
  return normalizeDegrees(free ? degrees : Math.round(degrees / ROTATE_STEP_DEGREES) * ROTATE_STEP_DEGREES);
}

export function rotateEdit(target: Rotatable, orientation: number): CourseSettingEdit {
  return target.kind === "control" ? { type: "SET_CONTROL_ORIENTATION", control: target.id, orientation: normalizeDegrees(orientation) }
    : { type: "UPDATE_SPECIAL", special: target.id, changes: { orientation: normalizeDegrees(orientation) } };
}

const unit = (from: Point, to: Point) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 1e-9 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : undefined;
};
/** Passagens vinkel för en riktning (enhetsvektor): löparen går mellan bågarna. */
const alongDirection = (direction: { x: number; y: number }) => normalizeDegrees(Math.atan2(direction.y, direction.x) * 180 / Math.PI - 90);

/**
 * Vinkeln som ställer passagen (banans kontroll `courseControl`) rätt mot sträckan genom den: medelriktningen av sträckan
 * in (från förra kontrollen eller sista brytpunkten) och ut (mot nästa). undefined när passagen inte har någon sträcka.
 */
export function legOrientation(document: CourseSettingDocument, course: string, courseControl: string): number | undefined {
  if (course === ALL_CONTROLS || !document.courseControls[courseControl]) return undefined;
  const order = courseControlOrder(document, course);
  if (!order.includes(courseControl)) return undefined;
  const here = document.courseControls[courseControl];
  const at = document.controls[here.control]?.at;
  if (!at) return undefined;
  const previous = order.map(id => document.courseControls[id]!).find(item => item.next === courseControl);
  const directions: { x: number; y: number }[] = [];
  if (previous && document.controls[previous.control]) {
    const path = legPath(document, previous.control, here.control);
    const incoming = unit(path.at(-2)!, at);
    if (incoming) directions.push(incoming);
  }
  if (here.next !== undefined && document.courseControls[here.next] && document.controls[document.courseControls[here.next]!.control]) {
    const path = legPath(document, here.control, document.courseControls[here.next]!.control);
    const outgoing = unit(at, path[1]!);
    if (outgoing) directions.push(outgoing);
  }
  if (directions.length === 0) return undefined;
  const sum = directions.reduce((total, d) => ({ x: total.x + d.x, y: total.y + d.y }), { x: 0, y: 0 });
  // In och ut åt motsatt håll (en spetsig vändning): sträckan in avgör.
  return alongDirection(Math.hypot(sum.x, sum.y) > 1e-6 ? sum : directions[0]!);
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const share = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + share * dx), point.y - (from.y + share * dy));
}

/**
 * "Vrid efter sträckan" för en valfri passage, som inte ingår i banan: riktningen på närmaste sträckan inom `withinMm` i
 * vald bana (eller i alla banor i Alla kontroller).
 */
export function nearestLegOrientation(document: CourseSettingDocument, view: string, point: Point, withinMm: number): number | undefined {
  const courses = view === ALL_CONTROLS ? document.courses.map(course => course.id) : [view];
  let best: { distance: number; direction: { x: number; y: number } } | undefined;
  for (const course of courses) {
    let order: readonly string[];
    try { order = courseControlOrder(document, course); } catch { continue; }
    for (const id of order) {
      const item = document.courseControls[id]!;
      const next = item.next !== undefined ? document.courseControls[item.next] : undefined;
      if (!next || !document.controls[item.control] || !document.controls[next.control]) continue;
      const path = legPath(document, item.control, next.control);
      for (let index = 1; index < path.length; index += 1) {
        const distance = distanceToSegment(point, path[index - 1]!, path[index]!);
        const direction = unit(path[index - 1]!, path[index]!);
        if (direction && distance <= withinMm && (!best || distance < best.distance)) best = { distance, direction };
      }
    }
  }
  return best ? alongDirection(best.direction) : undefined;
}

/** Vinkeln "rätt mot sträckan" för det som ska vridas. */
export function orientationAlongLeg(document: CourseSettingDocument, view: string, target: Rotatable, selection: Selection | undefined,
  withinMm: number): number | undefined {
  if (target.kind === "control" && selection?.kind === "control" && selection.courseControl) {
    const value = legOrientation(document, view, selection.courseControl);
    if (value !== undefined) return value;
  }
  return nearestLegOrientation(document, view, target.at, withinMm);
}
