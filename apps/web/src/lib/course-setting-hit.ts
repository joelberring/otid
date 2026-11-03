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
      readonly toCourseControl?: string | undefined }
  /** Steg 64: ett specialobjekt (ref = dess id). */
  | { readonly kind: "special"; readonly special: string };

/** Specialobjekt som är ytor: träffas också inuti (rastret har luckor). */
const AREA_SPECIALS = new Set(["out-of-bounds", "dangerous-area", "temporary-construction", "white-out"]);

export const ALL_CONTROLS = "ALL_CONTROLS";

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const share = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + share * dx), point.y - (from.y + share * dy));
}

/** Avståndet från punkten till figuren (0 inuti en ring, yta eller textruta). */
const CONTROL_SYMBOL_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE"]);

export function primitiveDistance(primitive: OverprintPrimitive, point: Point): number {
  switch (primitive.kind) {
    case "circle": {
      const outer = primitive.diameter / 2 + primitive.lineWidth / 2;
      return Math.max(0, Math.hypot(point.x - primitive.center.x, point.y - primitive.center.y) - outer);
    }
    case "polyline": {
      // Ägarens fel 2026-11-03: startens triangel (och kartbytets) är bara en kontur, så ett grepp mitt i starten träffade inte
      // och dragningen panorerade kartan (eller tog sträckan). Inuti en sluten kontrollsymbol räknas som träff, som i ringarna.
      if (primitive.closed && CONTROL_SYMBOL_ROLES.has(primitive.role) && primitive.points.length > 2 && inside(primitive.points, point)) return 0;
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
      const centerX = primitive.align === "left" ? primitive.at.x + halfWidth : primitive.at.x;
      const dx = Math.max(0, Math.abs(point.x - centerX) - halfWidth), dy = Math.max(0, Math.abs(point.y - primitive.at.y) - halfHeight);
      return Math.hypot(dx, dy);
    }
    case "image": return rectDistance(primitive.rect, point);
    case "description": {
      const { topLeft, layout } = primitive;
      return rectDistance({ minX: topLeft.x, maxX: topLeft.x + layout.widthMm, minY: topLeft.y - layout.heightMm, maxY: topLeft.y }, point);
    }
  }
}

function rectDistance(rect: { minX: number; minY: number; maxX: number; maxY: number }, point: Point): number {
  return Math.hypot(Math.max(0, rect.minX - point.x, point.x - rect.maxX), Math.max(0, rect.minY - point.y, point.y - rect.maxY));
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
      // Sträckans nyckel är kontrollernas id (`från-till`); ett id kan självt innehålla bindestreck.
      for (let index = ref.indexOf("-"); index > 0; index = ref.indexOf("-", index + 1)) {
        const from = ref.slice(0, index), to = ref.slice(index + 1);
        if (document.controls[from] && document.controls[to]) return { kind: "leg", from, to };
      }
      return undefined;
    }
    case "SPECIAL":
      return document.specialObjects.some(special => special.id === ref) ? { kind: "special", special: ref } : undefined;
    default:
      return undefined;
  }
}

/**
 * Nummer går före ringar (de ligger ovanpå), ringar före sträckor. Ett nummer vinner ändå inte över en ring som är
 * närmare: med fingrets större träffyta tog ett tryck mitt i ringen annars numret bredvid (steg 66, telefonen).
 */
export function hitTest(document: CourseSettingDocument, view: string, primitives: readonly OverprintPrimitive[], point: Point,
  toleranceMm: number): HitTarget | undefined {
  const best: Partial<Record<HitTarget["kind"], { target: HitTarget; distance: number }>> = {};
  for (const primitive of primitives) {
    const distance = primitiveDistance(primitive, point);
    if (distance > toleranceMm) continue;
    const target = resolveTarget(document, view, primitive);
    if (!target) continue;
    const current = best[target.kind];
    if (!current || distance < current.distance) best[target.kind] = { target, distance };
  }
  // Ytor bland specialobjekten träffas inuti också.
  const shown = new Set(primitives.filter(primitive => primitive.role === "SPECIAL").map(primitive => primitive.ref));
  for (const special of document.specialObjects) {
    if (!shown.has(special.id) || !AREA_SPECIALS.has(special.kind) || !inside(special.points, point)) continue;
    if (!best.special) best.special = { target: { kind: "special", special: special.id }, distance: 0 };
  }
  const { number, control, leg, special } = best;
  if (number && (!control || number.distance <= control.distance)) return number.target;
  // Kontroller och sträckor går före specialobjekten (som ofta ligger under dem).
  return (control ?? leg ?? special)?.target;
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
