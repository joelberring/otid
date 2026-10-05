import type { SyncRow } from "@o-tid/contracts";
import {
  normalized, PLACEHOLDER_COURSE, row, sameCodes, type CourseFileAction, type CourseFileProjection, type CourseRef, type CurrentCourse,
  type CurrentState, type PlannedRow, type SourceDiff
} from "./source-sync-model";

type Variants = readonly { readonly code: string; readonly controlCodes: readonly number[] }[];
const codes = (values: readonly number[]) => values.join(" ");

/** Ändrade varianter som läsbara rader: "AC: 31 32 33" → "AC: 31 39 33". */
function variantChanges(current: Variants, next: Variants): SyncRow["changes"] {
  const changes: SyncRow["changes"] = [];
  for (const variant of next) {
    const before = current.find(row => row.code === variant.code);
    if (!before || !sameCodes(before.controlCodes, variant.controlCodes)) {
      changes.push({ field: "VARIANTS", from: before ? `${variant.code}: ${codes(before.controlCodes)}` : null,
        to: `${variant.code}: ${codes(variant.controlCodes)}` });
    }
  }
  for (const variant of current) {
    if (!next.some(row => row.code === variant.code)) changes.push({ field: "VARIANTS", from: `${variant.code}: ${codes(variant.controlCodes)}`, to: null });
  }
  return changes.slice(0, 20);
}

/**
 * Skillnaden mellan en banfil (IOF XML CourseData från OCAD, Purple Pen eller Condes) och
 * tävlingen (ADR-0170 beslut 4). Ren funktion.
 *
 * - Banor matchas på filens id, annars på namn (länkas tyst). Nya banor skapas alltid.
 * - Ändrad kontrollföljd eller ändrade varianter ger en ny banversion; klasserna på banan följer med.
 * - Klasser matchas på filens id, annars på namn (även klasser från Eventor och egna klasser).
 * - Banor som inte finns i filen tas aldrig bort; de visas bara.
 */
export function diffCourseFile(projection: CourseFileProjection, state: CurrentState,
  readOutByClass: ReadonlyMap<string, number>): SourceDiff<CourseFileAction> {
  const rows: PlannedRow<CourseFileAction>[] = [];
  const links: { id: string; externalId: string }[] = [];
  let unchanged = 0;
  const { courses, assignments } = projection.data;
  const candidates = state.courses.filter(course => course.externalSource !== PLACEHOLDER_COURSE.externalSource);
  const linked = new Map(candidates.filter(course => course.externalSource === "iof").map(course => [course.externalId!, course]));
  const used = new Set<string>();
  const courseTarget = new Map<string, { ref: CourseRef; name: string }>();
  const readOutOnCourse = (courseId: string) => state.classes.filter(raceClass => raceClass.courseId === courseId)
    .reduce((sum, raceClass) => sum + (readOutByClass.get(raceClass.id) ?? 0), 0);

  for (const course of courses) {
    let local: CurrentCourse | undefined = linked.get(course.externalId);
    if (!local) {
      const byName = candidates.filter(row => row.externalSource !== "iof" && !used.has(row.id) && normalized(row.name) === normalized(course.name));
      if (byName.length === 1) { local = byName[0]!; links.push({ id: local.id, externalId: course.externalId }); }
    }
    const variants = course.variants ?? [];
    if (!local) {
      courseTarget.set(course.externalId, { ref: { newCourse: course.externalId }, name: course.name });
      rows.push({ row: row({ key: `course-new:${course.externalId}`, kind: "NEW", subject: "COURSE", label: course.name, optional: false,
        changes: variants.length > 0 ? variantChanges([], variants) : [{ field: "CONTROLS", from: null, to: codes(course.controlCodes) }] }),
      action: { type: "CREATE_COURSE", externalId: course.externalId, name: course.name, controlCodes: course.controlCodes, variants } });
      continue;
    }
    used.add(local.id);
    courseTarget.set(course.externalId, { ref: { existing: local.id }, name: local.name });
    const changes = variants.length > 0 || local.variants.length > 0 ? variantChanges(local.variants, variants)
      : sameCodes(local.controlCodes, course.controlCodes) ? [] : [{ field: "CONTROLS" as const, from: codes(local.controlCodes), to: codes(course.controlCodes) }];
    if (changes.length === 0) { unchanged += 1; continue; }
    rows.push({ row: row({ key: `course:${local.id}`, kind: "CHANGED", subject: "COURSE", label: local.name, changes,
      readOut: readOutOnCourse(local.id) > 0, context: state.classes.filter(raceClass => raceClass.courseId === local.id)
        .map(raceClass => raceClass.name).join(", ") || null }),
    action: { type: "CHANGE_COURSE", courseId: local.id, controlCodes: variants.length > 0 ? [] : course.controlCodes, variants } });
  }
  for (const course of candidates) {
    if (course.externalSource === "iof" && !used.has(course.id) && !courses.some(row => row.externalId === course.externalId)) {
      rows.push({ row: row({ key: `course-missing:${course.id}`, kind: "CONFLICT", subject: "COURSE", label: course.name, optional: false,
        note: "NOT_IN_FILE" }), action: { type: "NONE" } });
    }
  }

  const courseName = (ref: CourseRef) => "existing" in ref ? state.courses.find(course => course.id === ref.existing)!.name
    : courses.find(course => course.externalId === ref.newCourse)!.name;
  const usedClasses = new Set<string>();
  for (const assignment of assignments) {
    const target = courseTarget.get(assignment.courseExternalId);
    if (!target) continue;
    const local = state.classes.find(raceClass => raceClass.externalSource === "iof" && raceClass.externalId === assignment.classExternalId) ??
      state.classes.find(raceClass => !usedClasses.has(raceClass.id) && normalized(raceClass.name) === normalized(assignment.className));
    if (!local) {
      rows.push({ row: row({ key: `class-new:${assignment.classExternalId}`, kind: "NEW", subject: "CLASS", label: assignment.className,
        changes: [{ field: "COURSE", from: null, to: target.name }] }),
      action: { type: "CREATE_CLASS", externalId: assignment.classExternalId, name: assignment.className, courseRef: target.ref } });
      continue;
    }
    usedClasses.add(local.id);
    if ("existing" in target.ref && target.ref.existing === local.courseId) { unchanged += 1; continue; }
    rows.push({ row: row({ key: `class-course:${local.id}`, kind: "CHANGED", subject: "CLASS", label: local.name,
      changes: [{ field: "COURSE", from: state.courses.find(course => course.id === local.courseId)?.name ?? null, to: courseName(target.ref) }],
      readOut: (readOutByClass.get(local.id) ?? 0) > 0 }),
    action: { type: "CHANGE_CLASS_COURSE", classId: local.id, courseRef: target.ref } });
  }
  return { rows, links, unchanged };
}
