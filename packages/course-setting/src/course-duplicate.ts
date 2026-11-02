/**
 * Banläggningens UX (ADR-0180 beslut 12): duplicera en bana och vilka kontroller som inte används. Följer Purple Pens
 * ChangeEvent.DuplicateCourse och QueryEvent.ControlsUnusedInCourses (BSD, Peter Golde).
 */
import { nextId } from "./ppen-common";
import type { Course, CourseControl, CourseSettingDocument, EditResult } from "./types";
import { CourseSettingEditError } from "./types";
import { enumerateCourseControls, findCourse } from "./walk";

/**
 * Kopian får nya id för banan och banans kontroller (i den ordning de gås igenom, så att samarbetets uppspelning ger samma
 * id i samma ordning), samma kontroller, länkar, gafflingar, nummerlägen, tryckyta, skala och etikett. Den hamnar direkt
 * efter originalet i banlistan. Specialobjekt som bara syns på vissa banor och syns på originalet syns också på kopian.
 */
export function duplicateCourse(document: CourseSettingDocument, courseId: string, name: string): EditResult {
  const original = findCourse(document, courseId);
  if (name.trim() === "") throw new CourseSettingEditError("INVALID", "Banan behöver ett namn");
  const ids = enumerateCourseControls(document, courseId);
  const taken = Object.keys(document.courseControls);
  const map = new Map<string, string>();
  for (const id of ids) {
    const fresh = nextId(taken);
    taken.push(fresh);
    map.set(id, fresh);
  }
  const to = (id: string) => map.get(id) ?? id;
  const courseControls: Record<string, CourseControl> = { ...document.courseControls };
  for (const id of ids) {
    const old = document.courseControls[id]!;
    courseControls[to(id)] = { ...old, id: to(id), ...(old.next !== undefined ? { next: to(old.next) } : {}),
      ...(old.split ? { split: { ...old.split, branches: old.split.branches.map(to), end: to(old.split.end) } } : {}) };
  }
  const newId = nextId(document.courses.map(course => course.id));
  const copy: Course = { ...original, id: newId, name, order: original.order + 1, ...(original.first !== undefined ? { first: to(original.first) } : {}) };
  const courses = [...document.courses.map(course => course.order > original.order ? { ...course, order: course.order + 1 } : course), copy];
  const specialObjects = document.specialObjects.map(special =>
    special.courses.length > 0 && special.courses.includes(courseId) && !special.courses.includes(newId)
      ? { ...special, courses: [...special.courses, newId] } : special);
  return { document: { ...document, courseControls, courses, specialObjects }, created: newId };
}

/** Kontrollerna som inte ingår i någon bana (Purple Pens "oanvända kontroller"), i kodordning. */
export function unusedControls(document: CourseSettingDocument): string[] {
  const used = new Set<string>();
  for (const course of document.courses) {
    for (const id of enumerateCourseControls(document, course.id)) used.add(document.courseControls[id]!.control);
  }
  return sortControls(document, Object.keys(document.controls).filter(id => !used.has(id)));
}

/** Kontrollerna i banan som ingen annan bana använder: de blir oanvända om banan tas bort (Controller.DeleteCurrentCourse). */
export function controlsOnlyIn(document: CourseSettingDocument, courseId: string): string[] {
  const mine = new Set(enumerateCourseControls(document, courseId).map(id => document.courseControls[id]!.control));
  for (const course of document.courses) {
    if (course.id === courseId) continue;
    for (const id of enumerateCourseControls(document, course.id)) mine.delete(document.courseControls[id]!.control);
  }
  return sortControls(document, [...mine]);
}

const KIND_ORDER = { START: 0, MAP_ISSUE: 1, NORMAL: 2, CROSSING_POINT: 3, MAP_EXCHANGE: 4, FINISH: 5 } as const;

/** Start först, sedan vanliga kontroller efter kod (som tal när det går), passager och mål sist. */
function sortControls(document: CourseSettingDocument, ids: string[]): string[] {
  const key = (id: string) => document.controls[id]!;
  return ids.sort((a, b) => {
    const x = key(a), y = key(b);
    return KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || (Number(x.code) - Number(y.code)) || (x.code ?? "").localeCompare(y.code ?? "")
      || Number(a) - Number(b);
  });
}
