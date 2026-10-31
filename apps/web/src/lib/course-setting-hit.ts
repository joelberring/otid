import type { CourseSettingDocument, OverprintPrimitive } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";

/**
 * Steg 62: träff-test i banläggningens karta mot banpåtryckets figurer (`layoutOverprint`), i kartans mm. Figuren pekar
 * med `ref` på det den ritar; här blir det en kontroll (med banans kontroll när en bana visas), ett kontrollnummer eller en
 * sträcka. Ringar räknas som träffade även inuti, så att en kontroll går att ta tag i var som helst i ringen.
 */
export type HitTarget =
  | { readonly kind: "control"; readonly control: string; readonly courseControl?: string | undefined }
  | { readonly kind: "number"; readonly control: string; readonly courseControl?: string | undefined }
  | { readonly kind: "leg"; readonly from: string; readonly to: string; readonly fromCourseControl?: string | undefined;
      readonly toCourseControl?: string | undefined };

export const ALL_CONTROLS = "ALL_CONTROLS";

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const share = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + share * dx), point.y - (from.y + share * dy));
}

/** Avståndet från punkten till figuren (0 inuti en ring, yta eller textruta). */
export function primitiveDistance(primitive: OverprintPrimitive, point: Point): number {
  switch (primitive.kind) {
    case "circle": {
      const outer = primitive.diameter / 2 + primitive.lineWidth / 2;
      return Math.max(0, Math.hypot(point.x - primitive.center.x, point.y - primitive.center.y) - outer);
    }
    case "polyline": {
      const points = primitive.closed && primitive.points.length > 2 ? [...primitive.points, primitive.points[0]!] : primitive.points;
      let best = Infinity;
      for (let index = 1; index < points.length; index += 1) best = Math.min(best, distanceToSegment(point, points[index - 1]!, points[index]!));
      if (points.length === 1) best = Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y);
      return Math.max(0, best - primitive.width / 2);
    }
    case "polygon": {
      const ring = primitive.rings[0] ?? [];
      if (inside(ring, point)) return 0;
      let best = Infinity;
      for (let index = 0; index < ring.length; index += 1) best = Math.min(best, distanceToSegment(point, ring[index]!, ring[(index + 1) % ring.length]!));
      return best;
    }
    case "text": {
      const halfWidth = primitive.heightMm * 0.32 * Math.max(1, primitive.text.length), halfHeight = primitive.heightMm / 2;
      const dx = Math.max(0, Math.abs(point.x - primitive.at.x) - halfWidth), dy = Math.max(0, Math.abs(point.y - primitive.at.y) - halfHeight);
      return Math.hypot(dx, dy);
    }
  }
}

function inside(ring: readonly Point[], point: Point): boolean {
  let result = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/**
 * Vad `ref` pekar på. I en bana pekar kontrollens figurer på banans kontroll (annars kontrollen), i "Alla kontroller" på
 * kontrollen. En sträcka är `från-till` med banans kontroller eller kontrollerna.
 */
export function resolveTarget(document: CourseSettingDocument, view: string, primitive: OverprintPrimitive): HitTarget | undefined {
  const ref = primitive.ref;
  if (!ref) return undefined;
  const point = (id: string): { control: string; courseControl?: string } | undefined => {
    const courseControl = view !== ALL_CONTROLS ? document.courseControls[id] : undefined;
    if (courseControl) return { control: courseControl.control, courseControl: id };
    if (document.controls[id]) return { control: id };
    const fallback = document.courseControls[id];
    return fallback ? { control: fallback.control, courseControl: id } : undefined;
  };
  switch (primitive.role) {
    case "START": case "CONTROL": case "FINISH": case "CROSSING_POINT": case "MAP_EXCHANGE": {
      const target = point(ref);
      return target ? { kind: "control", ...target } : undefined;
    }
    case "NUMBER": {
      const target = point(ref);
      return target ? { kind: "number", ...target } : undefined;
    }
    case "LEG": case "FLAGGING": {
      if (document.legs[ref]) return { kind: "leg", from: document.legs[ref].from, to: document.legs[ref].to };
      const [fromId, toId] = ref.split("-");
      if (!fromId || !toId) return undefined;
      const from = point(fromId), to = point(toId);
      return from && to ? { kind: "leg", from: from.control, to: to.control, fromCourseControl: from.courseControl, toCourseControl: to.courseControl }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Nummer går före ringar (de ligger ovanpå), ringar före sträckor. */
const PRIORITY: Record<HitTarget["kind"], number> = { number: 0, control: 1, leg: 2 };

/** Det som ligger närmast punkten inom `toleranceMm`, eller undefined. */
export function hitTest(document: CourseSettingDocument, view: string, primitives: readonly OverprintPrimitive[], point: Point,
  toleranceMm: number): HitTarget | undefined {
  let best: { target: HitTarget; distance: number } | undefined;
  for (const primitive of primitives) {
    const distance = primitiveDistance(primitive, point);
    if (distance > toleranceMm) continue;
    const target = resolveTarget(document, view, primitive);
    if (!target) continue;
    if (!best || PRIORITY[target.kind] < PRIORITY[best.target.kind] ||
      (PRIORITY[target.kind] === PRIORITY[best.target.kind] && distance < best.distance)) best = { target, distance };
  }
  return best?.target;
}

/** Var en ny brytpunkt hör hemma bland de befintliga: indexet där linjen genom den blir kortast. */
export function bendInsertIndex(from: Point, to: Point, bends: readonly Point[], point: Point): number {
  const path = [from, ...bends, to];
  let bestIndex = 0, best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    const distance = distanceToSegment(point, path[index - 1]!, path[index]!);
    if (distance < best) { best = distance; bestIndex = index - 1; }
  }
  return bestIndex;
}

/** Närmaste brytpunkt inom toleransen (för att dra eller ta bort den). */
export function nearestBend(bends: readonly Point[], point: Point, toleranceMm: number): number | undefined {
  let bestIndex: number | undefined, best = toleranceMm;
  for (const [index, bend] of bends.entries()) {
    const distance = Math.hypot(bend.x - point.x, bend.y - point.y);
    if (distance <= best) { best = distance; bestIndex = index; }
  }
  return bestIndex;
}
