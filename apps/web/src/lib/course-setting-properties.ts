import type { Course, CourseChanges, CourseSettingDocument, CourseSettingEdit } from "@o-tid/course-setting";

/**
 * ADR-0190: banans egenskaper i editorn. Formuläret ger bara de fält som ändrats (en åtgärd, ett ångra-steg, och touches
 * bara för det som ändrades, så att två som ändrar olika fält samtidigt inte krockar). Ren logik utan React.
 */
export interface PropertiesForm {
  readonly kind: Course["kind"];
  /** Text i fältet; tom = ingen. */
  readonly climb: string;
  readonly length: string;
}

export const formOf = (course: Course): PropertiesForm => ({ kind: course.kind,
  climb: course.climbMeters === undefined ? "" : String(course.climbMeters),
  length: course.lengthOverrideMeters === undefined ? "" : String(course.lengthOverrideMeters) });

/** Hela meter (mellanslag och "m" tillåts); tom = null; annars undefined (fel). */
export function parseMeters(value: string, minimum: number, maximum: number): number | null | undefined {
  const text = value.replace(/\s/g, "").replace(/m$/i, "");
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const meters = Number(text);
  return meters >= minimum && meters <= maximum ? meters : undefined;
}

export type PropertiesResult = { readonly changes: CourseChanges | undefined } | { readonly error: "climb" | "length" };

/** Ändringarna mot banan (undefined = inget ändrat). */
export function propertyChanges(course: Course, form: PropertiesForm): PropertiesResult {
  const climb = parseMeters(form.climb, 0, 100_000);
  if (climb === undefined) return { error: "climb" };
  const length = parseMeters(form.length, 1, 1_000_000);
  if (length === undefined) return { error: "length" };
  const changes: { -readonly [K in keyof CourseChanges]: CourseChanges[K] } = {};
  if (form.kind !== course.kind) changes.kind = form.kind;
  if (climb !== (course.climbMeters ?? null)) changes.climbMeters = climb;
  if (length !== (course.lengthOverrideMeters ?? null)) changes.lengthOverrideMeters = length;
  return { changes: Object.keys(changes).length > 0 ? changes : undefined };
}

/** Banorna i listans ordning. */
export const orderedCourses = (document: CourseSettingDocument): Course[] =>
  [...document.courses].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "sv-SE"));

/** Flytta banan till plats `position` (1 = först) i listan; undefined = ingen ändring. */
export function moveCourseEdit(document: CourseSettingDocument, courseId: string, position: number): CourseSettingEdit | undefined {
  const courses = orderedCourses(document);
  const index = courses.findIndex(course => course.id === courseId);
  const target = Math.max(1, Math.min(position, courses.length));
  if (index < 0 || index + 1 === target) return undefined;
  return { type: "UPDATE_COURSE", course: courseId, changes: { order: target } };
}

/** Poängen i fältet: tomt eller 0 = inga (null), annars ett heltal 1–9999; undefined = fel. */
export function parsePoints(value: string): number | null | undefined {
  const text = value.trim();
  if (text === "" || text === "0") return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  return Number(text);
}

/** Poängbanans summa (vanliga kontroller med poäng) och antalet vanliga kontroller. */
export function scoreTotal(document: CourseSettingDocument, courseControls: readonly string[]): { points: number; controls: number } {
  let points = 0, controls = 0;
  for (const id of courseControls) {
    const item = document.courseControls[id];
    if (!item || document.controls[item.control]?.kind !== "NORMAL") continue;
    controls += 1;
    points += item.points ?? 0;
  }
  return { points, controls };
}
