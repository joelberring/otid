import {
  courseControlOrder, layoutOverprint, type ControlKind, type CourseSettingDocument, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS } from "./course-setting-hit";

/**
 * ADR-0180 beslut 14: befintliga kontroller syns svagt och snäpper när man lägger till kontroller i en bana, som Purple
 * Pens AddControlMode (SetTemporaryControlView och HitTestPoint mot lagret med alla kontroller). Ett klick inom ringen,
 * eller inom fångavståndet i skärmpixlar från den, lägger in den befintliga kontrollen i stället för att skapa en ny.
 */

/** Fångavståndet utanför ringen i skärmpixlar: fingret behöver mer än musen. */
export const snapTolerancePx = (pointerType: string) => pointerType === "touch" ? 22 : 10;

/** Kontrollerna på banan (alla grenar). */
export function controlsInCourse(document: CourseSettingDocument, course: string): Set<string> {
  if (course === ALL_CONTROLS) return new Set(Object.keys(document.controls));
  try {
    return new Set(courseControlOrder(document, course).map(id => document.courseControls[id]!.control));
  } catch {
    return new Set();
  }
}

/**
 * Kontrollerna som går att lägga in i banan: av samma slag som det som läggs till (alla slag med "Lägg in befintlig") och
 * inte redan på banan. Kartutdelning och kartbyte hör till sina egna verktyg.
 */
export function snapCandidates(document: CourseSettingDocument, course: string, kind: ControlKind | "ANY"): string[] {
  if (course === ALL_CONTROLS) return [];
  const used = controlsInCourse(document, course);
  return Object.values(document.controls).filter(control => !used.has(control.id) && (kind === "ANY" || control.kind === kind))
    .map(control => control.id);
}

export interface Snap {
  readonly control: string;
  readonly at: Point;
}

/** Närmaste kandidat inom ringen (`radiusMm`) plus `toleranceMm`, eller undefined. */
export function snapAt(document: CourseSettingDocument, candidates: readonly string[], point: Point, radiusMm: number, toleranceMm: number): Snap | undefined {
  let best: Snap | undefined, bestDistance = radiusMm + toleranceMm;
  for (const id of candidates) {
    const at = document.controls[id]?.at;
    if (!at) continue;
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= bestDistance) { best = { control: id, at }; bestDistance = distance; }
  }
  return best;
}

const GHOST_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "NUMBER"]);

/**
 * Kontrollerna som inte är med i banan, som i Alla kontroller (ringar och koder), för att ritas svagt. `ref` är
 * kontrollens id. Ändras dokumentet ritas de om.
 */
export function ghostPrimitives(document: CourseSettingDocument, course: string): OverprintPrimitive[] {
  if (course === ALL_CONTROLS) return [];
  const used = controlsInCourse(document, course);
  let all: readonly OverprintPrimitive[];
  try { all = layoutOverprint(document, { course: ALL_CONTROLS }); } catch { return []; }
  return all.filter(primitive => GHOST_ROLES.has(primitive.role) && primitive.ref !== undefined && document.controls[primitive.ref]
    && !used.has(primitive.ref));
}

/** "Visa andra banor svagt": sträckor och ringar för alla andra banor (inte specialobjekten, som syns ändå). */
export function otherCoursesPrimitives(document: CourseSettingDocument, course: string): OverprintPrimitive[] {
  const out: OverprintPrimitive[] = [];
  for (const other of document.courses) {
    if (other.id === course) continue;
    try {
      for (const primitive of layoutOverprint(document, { course: other.id })) if (primitive.role !== "SPECIAL") out.push(primitive);
    } catch { /* en trasig bana ritas inte; kontrollerna visar felet */ }
  }
  return out;
}
