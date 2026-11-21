/**
 * Ägaren 2026-11-21 (ADR-0175, översynen av gafflingarna A8): varningar för gafflingar som inte är klara. En ny gaffling
 * har tomma grenar, och då är varianterna samma kontroller tills grenarna fylls. Banläggningen tillåter det medan man
 * arbetar (tävlingens egen editor kräver det inte, `validateCourseForking`), men det ska synas i Varningar och före Överför.
 */
import { courseVariantList } from "./summary";
import type { CourseCheck, CourseSettingDocument } from "./types";
import { enumerateCourseControls, variantLetters } from "./walk";

export function forkChecks(document: CourseSettingDocument, courseId: string): CourseCheck[] {
  const course = document.courses.find(row => row.id === courseId);
  if (!course || course.kind === "SCORE") return [];
  const checks: CourseCheck[] = [];
  const letters = variantLetters(document, courseId);
  for (const id of enumerateCourseControls(document, courseId)) {
    const item = document.courseControls[id];
    const split = item?.split;
    // En gång per gaffling (vid första grenen) och bara gafflingar: en tom slinga är ett eget fall.
    if (!item || !split || split.kind !== "FORK" || split.branches[0] !== id) continue;
    for (const branch of split.branches) {
      if (document.courseControls[branch]?.next !== split.end) continue;
      checks.push({ kind: "EMPTY_BRANCH", course: courseId, branch, letter: letters.get(branch) ?? "?", control: item.control });
    }
  }
  const byControls = new Map<string, string[]>();
  for (const variant of courseVariantList(document, courseId)) {
    if (variant.code === "") continue;
    const key = variant.courseControls.map(id => document.courseControls[id]?.control ?? "?").join(" ");
    byControls.set(key, [...(byControls.get(key) ?? []), variant.code]);
  }
  for (const codes of byControls.values()) if (codes.length > 1) checks.push({ kind: "SAME_VARIANTS", course: courseId, codes });
  return checks;
}
