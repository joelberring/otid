/**
 * Banans egenskaper i editorn (ADR-0190): namn, klasser, utskriftsskala, stigning, fast längd, etikett, banslag (vanlig
 * eller poängbana), ordningen i banlistan och poängen per kontroll. Som Purple Pens ChangeEvent.ChangeCourseProperties,
 * ChangeCourseControlPoints och banlistans ordning (BSD, Peter Golde).
 *
 * - Stigning och fast längd tas bort med `null` (frånvaro i modellen, som i .ppen).
 * - Poängbana: inga gafflingar (som Purple Pen); etiketten "Nummer" blir "Kod" (det Purple Pen ger en ny poängbana), och
 *   tillbaka till vanlig bana tappar etiketten poängen ("Kod och poäng" → "Kod"). Poängen på banans kontroller står kvar.
 * - Ordningen är platsen i listan (1 = först); de andra banorna numreras om 1, 2, 3 … i sin ordning.
 */
import { fromRaw, toRaw } from "./ppen-common";
import type { Course, CourseChanges, CourseSettingDocument } from "./types";
import { CourseSettingEditError } from "./types";
import { isExcludedVariant } from "./summary";
import { enumerateCourseControls, findCourse, variations } from "./walk";
import { el } from "./xml";

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);

function without<T extends object, K extends keyof T>(object: T, key: K): T {
  const copy = { ...object };
  delete copy[key];
  return copy;
}

/** Banorna i listans ordning (ordning, sedan namn som Purple Pens SortedCourseIds). */
export function sortedCourses(courses: readonly Course[]): Course[] {
  return [...courses].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "sv-SE") || Number(a.id) - Number(b.id));
}

/** Ordningen 1, 2, 3 … i listans ordning, med `moved` på plats `position` (1 = först). */
export function reorder(courses: readonly Course[], moved: Course, position: number): Course[] {
  const others = sortedCourses(courses.filter(course => course.id !== moved.id));
  others.splice(Math.max(0, Math.min(position - 1, others.length)), 0, moved);
  const order = new Map(others.map((course, index) => [course.id, index + 1]));
  return courses.map(course => {
    const value = order.get(course.id)!;
    const current = course.id === moved.id ? moved : course;
    return current.order === value ? current : { ...current, order: value };
  });
}

/** Etiketten när banslaget byts. */
function labelForKind(label: Course["labelKind"], kind: Course["kind"]): Course["labelKind"] {
  if (kind === "SCORE") return label === "SEQUENCE" ? "CODE" : label;
  if (label === "SCORE" || label === "SEQUENCE_AND_SCORE") return "SEQUENCE";
  if (label === "CODE_AND_SCORE") return "CODE";
  return label;
}

/**
 * Nummer på en poängbana står i beskrivningens kolumn A, så poängen kan inte stå där; som Purple Pens dialog (AddCourse)
 * flyttas den då till kolumn B (`<options score-column>`).
 */
function scoreColumnOutsideA(course: Course): Course {
  const raws = course.raw ?? [];
  const index = raws.findIndex(raw => raw.xml.startsWith("<options"));
  const options = index >= 0 ? fromRaw(raws[index]!) : el("options");
  const column = (options.attrs.find(([name]) => name === "score-column")?.[1] ?? "").trim().toUpperCase();
  if (column === "B" || column === "H" || column === "NONE") return course;
  const next = toRaw(el("options", [...options.attrs.filter(([name]) => name !== "score-column"), ["score-column", "B"]], options.children));
  return { ...course, raw: index >= 0 ? raws.map((raw, i) => (i === index ? next : raw)) : [...raws, next] };
}

const hasSplit = (document: CourseSettingDocument, courseId: string) =>
  enumerateCourseControls(document, courseId).some(id => document.courseControls[id]?.split !== undefined);

const MAX_EXCLUDED = 5000;

/** ADR-0198: de bortvalda varianterna (ersätts helt). Formen kontrolleras; minst en av banans varianter måste användas. */
function withExcludedVariants(document: CourseSettingDocument, course: Course, value: CourseChanges["excludedVariants"]): Course {
  if (value === undefined || value === null || value.length === 0) return without(course, "excludedVariants");
  const list: readonly unknown[] = Array.isArray(value) ? value : [];
  if (list.length === 0 || list.length > MAX_EXCLUDED) throw invalid("Ogiltiga bortvalda varianter");
  const rows = list.map(item => {
    const row = item as { code?: unknown; controls?: unknown } | null;
    const controls: readonly unknown[] = Array.isArray(row?.controls) ? row.controls as unknown[] : [];
    if (typeof row?.code !== "string" || row.code.length === 0 || row.code.length > 64 || !Array.isArray(row.controls) || controls.length > 1000 ||
      !controls.every(code => typeof code === "string" && code.length <= 32)) throw invalid("Ogiltig bortvald variant");
    return { code: row.code, controls: controls as string[] };
  });
  if (course.kind === "SCORE") throw invalid("En poängbana har inga varianter");
  const next = { ...course, excludedVariants: rows };
  const changed = { ...document, courses: document.courses.map(existing => existing.id === course.id ? next : existing) };
  const all = variations(changed, course.id);
  if (all.length > 0 && all.every(variation => {
    const controls = enumerateCourseControls(changed, course.id, variation.choices).flatMap(id => {
      const control = changed.controls[changed.courseControls[id]?.control ?? ""];
      return control?.kind === "NORMAL" && control.code !== undefined ? [control.code] : [];
    });
    return isExcludedVariant(next, { code: variation.code, controlCodes: controls });
  })) throw invalid("Minst en variant måste användas");
  return next;
}

/** `UPDATE_COURSE`: ändrar banan; `order` flyttar den i listan. */
export function updateCourse(document: CourseSettingDocument, courseId: string, changes: CourseChanges): CourseSettingDocument {
  let course = findCourse(document, courseId);
  const optional = <K extends "secondaryTitle" | "printScale" | "climbMeters" | "lengthOverrideMeters">(key: K, valid: (value: NonNullable<Course[K]>) => boolean) => {
    if (!(key in changes)) return;
    const value = changes[key];
    if (value === undefined || value === null) { course = without(course, key); return; }
    if (!valid(value as NonNullable<Course[K]>)) throw invalid(`Ogiltigt värde för ${key}`);
    course = { ...course, [key]: value };
  };
  if ("name" in changes) {
    if (typeof changes.name !== "string" || changes.name.trim() === "") throw invalid("Banan behöver ett namn");
    course = { ...course, name: changes.name };
  }
  optional("secondaryTitle", () => true);
  optional("printScale", scale => Number.isFinite(scale) && scale > 0);
  optional("climbMeters", climb => Number.isFinite(climb) && climb >= 0 && climb <= 100_000);
  optional("lengthOverrideMeters", length => Number.isFinite(length) && length > 0 && length <= 1_000_000);
  if ("kind" in changes && changes.kind !== course.kind) {
    if (changes.kind !== "NORMAL" && changes.kind !== "SCORE") throw invalid("Banan är vanlig eller poängbana");
    if (changes.kind === "SCORE" && hasSplit(document, courseId)) {
      throw invalid("En poängbana kan inte ha gafflingar. Ta bort gafflingarna först.");
    }
    course = { ...course, kind: changes.kind, labelKind: labelForKind(course.labelKind, changes.kind) };
  }
  if ("excludedVariants" in changes) course = withExcludedVariants(document, course, changes.excludedVariants);
  if ("labelKind" in changes) {
    const label = changes.labelKind;
    if (label === undefined) throw invalid("labelKind måste ha ett värde");
    if (course.kind !== "SCORE" && label.includes("SCORE")) throw invalid("Poäng visas bara på poängbanor");
    course = { ...course, labelKind: label };
  }
  if (course.kind === "SCORE" && course.labelKind.startsWith("SEQUENCE") && (changes.labelKind !== undefined || changes.kind !== undefined)) {
    course = scoreColumnOutsideA(course);
  }
  if ("order" in changes) {
    const target = changes.order;
    if (target === undefined || !Number.isInteger(target) || target < 1) throw invalid("Ogiltig ordning");
    return { ...document, courses: reorder(document.courses, course, target) };
  }
  return { ...document, courses: document.courses.map(existing => existing.id === courseId ? course : existing) };
}

/** `SET_POINTS`: poängen för en kontroll på en poängbana (0 eller null = inga). */
export function setPoints(document: CourseSettingDocument, courseId: string, courseControlId: string, points: number | null): CourseSettingDocument {
  const course = findCourse(document, courseId);
  if (course.kind !== "SCORE") throw invalid("Poäng finns bara på poängbanor");
  const item = document.courseControls[courseControlId];
  if (!item || !enumerateCourseControls(document, courseId).includes(courseControlId)) {
    throw new CourseSettingEditError("NOT_FOUND", `Banans kontroll ${courseControlId} finns inte på banan`);
  }
  if (document.controls[item.control]?.kind !== "NORMAL") throw invalid("Bara vanliga kontroller har poäng");
  if (points !== null && !(Number.isInteger(points) && points >= 0 && points <= 9999)) throw invalid("Poängen är ett heltal 0–9999");
  const updated = points === null || points === 0 ? without(item, "points") : { ...item, points };
  if (updated.points === item.points) return document;
  return { ...document, courseControls: { ...document.courseControls, [courseControlId]: updated } };
}
