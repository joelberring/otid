import type { SyncRow } from "@o-tid/contracts";
import { defaultRogainingPoints } from "@o-tid/domain";
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
 * ADR-0190: längd och stigning som skiljer (bara de som filen har; en bana utan uppgift i tävlingen jämförs inte när
 * tävlingens värde inte är känt).
 */
function measureChanges(local: CurrentCourse, course: CourseFileProjection["data"]["courses"][number]): SyncRow["changes"] {
  const changes: SyncRow["changes"] = [];
  const meters = (value: number | null | undefined) => value === null || value === undefined ? null : `${value} m`;
  if (local.lengthMeters !== undefined && course.lengthMeters !== undefined && course.lengthMeters !== local.lengthMeters) {
    changes.push({ field: "LENGTH", from: meters(local.lengthMeters), to: meters(course.lengthMeters) });
  }
  if (local.climbMeters !== undefined && course.climbMeters !== undefined && course.climbMeters !== local.climbMeters) {
    changes.push({ field: "CLIMB", from: meters(local.climbMeters), to: meters(course.climbMeters) });
  }
  return changes;
}

/**
 * Skillnaden mellan en banfil (IOF XML CourseData från OCAD, Purple Pen eller Condes) och
 * tävlingen (ADR-0170 beslut 4). Ren funktion.
 *
 * - Banor matchas på filens id, annars på namn (länkas tyst). Nya banor skapas alltid.
 * - Ändrad kontrollföljd eller ändrade varianter ger en ny banversion; klasserna på banan följer med.
 * - Klasser matchas på filens id, annars på namn (även klasser från Eventor och egna klasser).
 * - Banor som inte finns i filen tas aldrig bort; de visas bara.
 * - ADR-0190: ändrad längd eller stigning är en egen rad (räknar inte om några resultat). Banornas ordning i filen spelar
 *   ingen roll för banorna (de matchas på id och namn), bara för vilken bana en klass som nämns två gånger får.
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
    let variants = course.variants ?? [];
    if (!local) {
      courseTarget.set(course.externalId, { ref: { newCourse: course.externalId }, name: course.name });
      rows.push({ row: row({ key: `course-new:${course.externalId}`, kind: "NEW", subject: "COURSE", label: course.name, optional: false,
        changes: variants.length > 0 ? variantChanges([], variants) : [{ field: "CONTROLS", from: null, to: codes(course.controlCodes) }] }),
      action: { type: "CREATE_COURSE", externalId: course.externalId, name: course.name, controlCodes: course.controlCodes, variants,
        excludedVariants: course.excludedVariants } });
      continue;
    }
    used.add(local.id);
    courseTarget.set(course.externalId, { ref: { existing: local.id }, name: local.name });
    // ADR-0198: en banfil som inte kommer från banläggningen (inga bortval i filen) tar inte tillbaka bortvalda varianter;
    // bortvalen följer med (samma kod och kontroller). Från banläggningen gäller banläggningens bortval (inga = inga).
    const fromFile = projection.data.fromCourseSetting !== true;
    const excludedVariants = course.excludedVariants ?? (fromFile ? local.excludedVariants : undefined);
    if (fromFile && course.excludedVariants === undefined && local.excludedVariants?.length) {
      const kept = variants.filter(variant => !local.excludedVariants!.some(row => row.code === variant.code && sameCodes(row.controlCodes, variant.controlCodes)));
      if (kept.length > 0) variants = kept;
    }
    const changes = variants.length > 0 || local.variants.length > 0 ? variantChanges(local.variants, variants)
      : sameCodes(local.controlCodes, course.controlCodes) ? [] : [{ field: "CONTROLS" as const, from: codes(local.controlCodes), to: codes(course.controlCodes) }];
    const measures = measureChanges(local, course);
    if (changes.length === 0 && measures.length > 0) {
      rows.push({ row: row({ key: `course-measures:${local.id}`, kind: "CHANGED", subject: "COURSE", label: local.name, changes: measures }),
        action: { type: "SET_COURSE_MEASURES", courseId: local.id } });
      continue;
    }
    if (changes.length === 0) { unchanged += 1; continue; }
    changes.push(...measures.slice(0, Math.max(0, 20 - changes.length)));
    rows.push({ row: row({ key: `course:${local.id}`, kind: "CHANGED", subject: "COURSE", label: local.name, changes,
      readOut: readOutOnCourse(local.id) > 0, context: state.classes.filter(raceClass => raceClass.courseId === local.id)
        .map(raceClass => raceClass.name).join(", ") || null }),
    action: { type: "CHANGE_COURSE", courseId: local.id, controlCodes: variants.length > 0 ? [] : course.controlCodes, variants,
      excludedVariants } });
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
  // Rogaining: kontrollernas poäng ur banläggningen; ändrade poäng är egna rader (som andra ändringar i banorna).
  for (const control of projection.data.controlPoints ?? []) {
    const fallback = defaultRogainingPoints(control.code);
    const before = state.controlPoints?.get(control.code) ?? fallback;
    const after = control.points ?? fallback;
    if (before === after) { unchanged += 1; continue; }
    const usedBy = state.classes.filter(raceClass => state.courses.find(course => course.id === raceClass.courseId)?.controlCodes.includes(control.code)
      || state.courses.find(course => course.id === raceClass.courseId)?.variants.some(variant => variant.controlCodes.includes(control.code)));
    rows.push({ row: row({ key: `control-points:${control.code}`, kind: "CHANGED", subject: "CONTROL", label: String(control.code),
      changes: [{ field: "POINTS", from: String(before), to: String(after) }],
      readOut: usedBy.some(raceClass => (readOutByClass.get(raceClass.id) ?? 0) > 0) }),
    action: { type: "SET_CONTROL_POINTS", code: control.code, points: after === fallback ? null : after } });
  }
  return { rows, links, unchanged };
}
