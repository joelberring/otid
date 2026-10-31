/** Varianter, längder och nästa lediga kod. */
import type { CourseSettingDocument, CourseSummary, CourseVariant } from "./types";
import { CourseSettingEditError } from "./types";
import { enumerateCourseControls, findCourse, measuredLengthMeters, variations } from "./walk";

function variant(document: CourseSettingDocument, courseId: string, code: string, choices: readonly string[] | null): CourseVariant {
  const courseControls = enumerateCourseControls(document, courseId, choices);
  const controlCodes: string[] = [];
  for (const id of courseControls) {
    const control = document.controls[document.courseControls[id]!.control];
    if (control?.kind === "NORMAL" && control.code !== undefined) controlCodes.push(control.code);
  }
  return { code, courseControls, controlCodes, lengthMeters: measuredLengthMeters(document, courseId, choices) };
}

export function courseVariantList(document: CourseSettingDocument, courseId: string): CourseVariant[] {
  findCourse(document, courseId);
  const all = variations(document, courseId);
  if (all.length === 0) return [variant(document, courseId, "", null)];
  return all.map(v => variant(document, courseId, v.code, v.choices));
}

export function controlOrder(document: CourseSettingDocument, courseId: string, code?: string): string[] {
  if (code === undefined) return enumerateCourseControls(document, courseId);
  const all = variations(document, courseId);
  if (all.length === 0 && code === "") return enumerateCourseControls(document, courseId);
  const found = all.find(v => v.code === code);
  if (!found) throw new CourseSettingEditError("NOT_FOUND", `Varianten ${code} finns inte`);
  return enumerateCourseControls(document, courseId, found.choices);
}

/** Längd (uträknad eller inskriven), min/max för gafflade banor, flest kontroller i någon variant. */
export function summaries(document: CourseSettingDocument): CourseSummary[] {
  return [...document.courses].sort((a, b) => a.order - b.order).map(course => {
    const variants = courseVariantList(document, course.id);
    const lengths = variants.map(v => v.lengthMeters);
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    const override = course.lengthOverrideMeters;
    return {
      course: course.id,
      name: course.name,
      lengthMeters: override ?? max,
      ...(variants.length > 1 ? { lengthRangeMeters: override !== undefined ? { min: override, max: override } : { min, max } } : {}),
      ...(course.climbMeters !== undefined ? { climbMeters: course.climbMeters } : {}),
      controlCount: Math.max(...variants.map(v => v.controlCodes.length)),
      variants
    };
  });
}

/** Siffror som ser ut som andra upp och ned (QueryEvent.badUpsideDownNumbers i Purple Pen, BSD). */
export const INVERTIBLE_CODES: ReadonlySet<number> = new Set([
  61, 66, 68, 81, 86, 89, 98, 99,
  106, 108, 109, 116, 118, 119, 161, 166, 168, 169, 186, 188, 189, 191, 196, 198, 199,
  601, 606, 608, 611, 616, 618, 661, 666, 668, 669, 681, 686, 688, 691, 696, 698, 699,
  801, 806, 809, 811, 816, 819, 861, 866, 868, 869, 881, 886, 889, 891, 896, 898, 899,
  901, 908, 909, 911, 918, 919, 961, 966, 968, 969, 981, 988, 989, 991, 996, 998, 999
]);

export function isInvertibleCode(code: string): boolean {
  return /^\d+$/.test(code) && INVERTIBLE_CODES.has(Number(code));
}

/** Purple Pens regel för en kod: 1–3 tecken utan blanksteg (QueryEvent.IsLegalControlCode). */
export function isLegalCode(code: string): boolean {
  return code.length >= 1 && code.length <= 3 && !code.includes(" ");
}

/**
 * Nästa lediga kod från numreringens start: oanvänd, utan inledande nolla och (om omvändbara ska undvikas) inte
 * omvändbar. Efter 999 börjar sökningen om på 31 (QueryEvent.NextUnusedControlCode i Purple Pen, BSD).
 */
export function nextUnusedCode(document: CourseSettingDocument): string {
  const used = new Set(Object.values(document.controls).map(control => control.code).filter(code => code !== undefined));
  const { start, disallowInvertible } = document.event.numbering;
  let wrapped = false;
  for (let code = start; ; code++) {
    if (code >= 1000) {
      if (wrapped) return "XX";
      wrapped = true;
      code = 31;
    }
    const text = String(code);
    if (!used.has(text) && !(disallowInvertible && INVERTIBLE_CODES.has(code))) return text;
  }
}
