/** Varianter, längder och nästa lediga kod. */
import type { Course, CourseSettingDocument, CourseSummary, CourseVariant } from "./types";
import { CourseSettingEditError } from "./types";
import { legKey } from "./ppen-common";
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

/** ADR-0198: varianten är bortvald när både koden och kontrollkoderna stämmer med ett bortval. */
export function isExcludedVariant(course: Course, variant: Pick<CourseVariant, "code" | "controlCodes">): boolean {
  return (course.excludedVariants ?? []).some(row => row.code === variant.code && row.controls.length === variant.controlCodes.length &&
    row.controls.every((code, index) => code === variant.controlCodes[index]));
}

/** Alla varianter (också bortvalda, med `excluded`). */
export function allCourseVariantList(document: CourseSettingDocument, courseId: string): CourseVariant[] {
  const course = findCourse(document, courseId);
  const all = variations(document, courseId);
  if (all.length === 0) return [variant(document, courseId, "", null)];
  const list = all.map(v => variant(document, courseId, v.code, v.choices));
  if (!course.excludedVariants?.length) return list;
  const marked = list.map(row => isExcludedVariant(course, row) ? { ...row, excluded: true } : row);
  // Minst en variant används alltid (ett bortval som efter en ändring träffar alla gäller inte).
  return marked.every(row => row.excluded) ? list : marked;
}

/** Varianterna som används (ADR-0198: utan de bortvalda). */
export function courseVariantList(document: CourseSettingDocument, courseId: string): CourseVariant[] {
  return allCourseVariantList(document, courseId).filter(row => !row.excluded);
}

/** Banans längd i meter, före avrundning (ADR-0198 tillägg 12). */
export interface CourseLength {
  /** Längden som gäller: den fasta (inskrivna) längden, annars den längsta kvarvarande varianten (eller den valda). */
  readonly meters: number;
  /** Kortaste och längsta kvarvarande variant (samma som `meters` med fast längd eller en vald variant). */
  readonly min: number;
  readonly max: number;
  /** Banläggaren har skrivit in längden (`lengthOverrideMeters`). */
  readonly fixed: boolean;
}

function lengthOf(course: Course, all: readonly CourseVariant[], variant: string | undefined): CourseLength {
  const fixed = course.lengthOverrideMeters;
  if (fixed !== undefined) return { meters: fixed, min: fixed, max: fixed, fixed: true };
  const chosen = variant === undefined ? undefined : all.find(row => row.code === variant);
  const lengths = chosen ? [chosen.lengthMeters] : all.filter(row => !row.excluded).map(row => row.lengthMeters);
  const min = Math.min(...lengths), max = Math.max(...lengths);
  return { meters: max, min, max, fixed: false };
}

/**
 * ADR-0198 tillägg 12: banans längd, den enda regeln i banläggningen (banlistan, egenskaperna, kontrollbeskrivningen,
 * rubriken och textmakron på utskriften, pappersramens variabel och överföringen till tävlingen). Fast längd går före; annars
 * den längsta varianten som är kvar (bortvalda räknas inte), med `variant` den variantens uppmätta längd (en okänd kod ger
 * banans). Avrundningen gör den som visar längden.
 */
export function courseLength(document: CourseSettingDocument, courseId: string, options: { readonly variant?: string | undefined } = {}): CourseLength {
  return lengthOf(findCourse(document, courseId), allCourseVariantList(document, courseId), options.variant);
}

/** Banans kontroller i ordning för varje variant som används (bortvalda tas inte med); en ogafflad bana eller poängbana ger en. */
export function activeControlOrders(document: CourseSettingDocument, courseId: string): (readonly string[])[] {
  return courseVariantList(document, courseId).map(row => row.courseControls);
}

/**
 * ADR-0198 tillägg 12: kontrollerna (`controls`) och sträckorna (`legKey` av kontrollerna) som finns i någon variant som
 * används. `undefined` när inget är bortvalt (då gäller alla grenar, som `enumerateLegs`).
 */
export function activeParts(document: CourseSettingDocument, courseId: string): { readonly controls: ReadonlySet<string>; readonly legs: ReadonlySet<string> } | undefined {
  if (excludedVariantCodes(document, courseId).size === 0) return undefined;
  const controls = new Set<string>(), legs = new Set<string>();
  for (const order of activeControlOrders(document, courseId)) {
    const ids = order.map(id => document.courseControls[id]?.control);
    ids.forEach((id, index) => {
      if (id === undefined) return;
      controls.add(id);
      const previous = index > 0 ? ids[index - 1] : undefined;
      if (previous !== undefined) legs.add(legKey(previous, id));
    });
  }
  return { controls, legs };
}

/** Koderna för banans bortvalda varianter som gäller. */
export function excludedVariantCodes(document: CourseSettingDocument, courseId: string): Set<string> {
  const course = document.courses.find(row => row.id === courseId);
  if (!course?.excludedVariants?.length || course.kind === "SCORE") return new Set();
  return new Set(allCourseVariantList(document, courseId).filter(row => row.excluded).map(row => row.code));
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
    const all = allCourseVariantList(document, course.id);
    const variants = all.filter(row => !row.excluded);
    const length = lengthOf(course, all, undefined);
    return {
      course: course.id,
      name: course.name,
      lengthMeters: length.meters,
      ...(variants.length > 1 ? { lengthRangeMeters: { min: length.min, max: length.max } } : {}),
      ...(course.climbMeters !== undefined ? { climbMeters: course.climbMeters } : {}),
      controlCount: Math.max(...variants.map(v => v.controlCodes.length)),
      variants,
      excludedCount: all.length - variants.length
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
