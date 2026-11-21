import {
  courseControlOrder, layoutOverprint, type ControlKind, type CourseSettingDocument, type OverprintPrimitive
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { courseTree, type TreeRow } from "./course-setting-forks";
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

/** Slagen som bara finns en gång på en bana: en som redan är med snäpper inte (paketet byter start och mål). */
const ONCE_PER_COURSE: ReadonlySet<ControlKind> = new Set(["START", "FINISH", "MAP_ISSUE"]);

/**
 * Kontrollerna som går att lägga in i banan: av samma slag som det som läggs till (alla slag med "Lägg in befintlig").
 * Ägaren 2026-11-21 (A1): också de som redan finns på banan (en kontroll i två grenar, eller i grundföljden och i en gren);
 * start, mål och kartutdelning bara när de inte redan är med. Kartutdelning och kartbyte hör till sina egna verktyg.
 */
export function snapCandidates(document: CourseSettingDocument, course: string, kind: ControlKind | "ANY"): string[] {
  if (course === ALL_CONTROLS) return [];
  const used = controlsInCourse(document, course);
  return Object.values(document.controls)
    .filter(control => (kind === "ANY" || control.kind === kind) && !(used.has(control.id) && ONCE_PER_COURSE.has(control.kind)))
    .map(control => control.id);
}

export interface Snap {
  readonly control: string;
  readonly at: Point;
  /** Kontrollen finns redan på banan (den läggs in en gång till). */
  readonly onCourse?: boolean | undefined;
}

/** Närmaste kandidat inom ringen (`radiusMm`) plus `toleranceMm`, eller undefined. */
export function snapAt(document: CourseSettingDocument, candidates: readonly string[], point: Point, radiusMm: number, toleranceMm: number,
  onCourse?: ReadonlySet<string>): Snap | undefined {
  let best: Snap | undefined, bestDistance = radiusMm + toleranceMm;
  for (const id of candidates) {
    const at = document.controls[id]?.at;
    if (!at) continue;
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= bestDistance) { best = { control: id, at, ...(onCourse?.has(id) ? { onCourse: true } : {}) }; bestDistance = distance; }
  }
  return best;
}

const GHOST_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "NUMBER"]);

/** Kontrollernas figurer (inte koderna) för kontroller som redan är med i banan: svagare spöken ovanpå banans egna. */
const ON_COURSE_FADE = 0.5;
const ON_COURSE_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE"]);

/**
 * Kontrollerna som spöken, som i Alla kontroller (ringar och koder), för att ritas svagt. `ref` är kontrollens id. Ägaren
 * 2026-11-21 (A1): kontroller som redan är med i banan (och går att lägga in igen) ritas svagare och utan kod, så att de
 * syns också där banan visar en annan variant. Med `candidates` bara de som snäpper. Ändras dokumentet ritas de om.
 */
export function ghostPrimitives(document: CourseSettingDocument, course: string, candidates?: readonly string[]): OverprintPrimitive[] {
  if (course === ALL_CONTROLS) return [];
  const used = controlsInCourse(document, course);
  const shown = candidates ? new Set(candidates) : undefined;
  let all: readonly OverprintPrimitive[];
  try { all = layoutOverprint(document, { course: ALL_CONTROLS }); } catch { return []; }
  return all.flatMap(primitive => {
    if (!GHOST_ROLES.has(primitive.role) || primitive.ref === undefined || !document.controls[primitive.ref]) return [];
    if (!used.has(primitive.ref)) return [primitive];
    if (!shown?.has(primitive.ref) || !ON_COURSE_ROLES.has(primitive.role) || primitive.kind === "image") return [];
    return [{ ...primitive, fade: ON_COURSE_FADE }];
  });
}

/**
 * Var kontrollen redan finns på banan: grenarnas bokstäver (innersta grenen), "" för banans grundföljd. Gaffelkontrollen
 * räknas till följden där gafflingen börjar.
 */
export function placesOnCourse(document: CourseSettingDocument, course: string, control: string, rows?: readonly TreeRow[]): string[] {
  if (course === ALL_CONTROLS) return [];
  let tree: readonly TreeRow[];
  try { tree = rows ?? courseTree(document, course); } catch { return []; }
  const out = new Set<string>();
  const walk = (list: readonly TreeRow[], letter: string) => {
    for (const row of list) {
      if (row.kind === "control") { if (row.control === control) out.add(letter); continue; }
      for (const branch of row.branches) walk(branch.rows, branch.letter);
    }
  };
  walk(tree, "");
  return [...out];
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
