/**
 * ADR-0175, tillägg 2026-11-21 (b): en variantkod är en bokstav per gafflingspunkt. När grenarna får andra bokstäver (utkast,
 * «Ordna nycklarna», en överföring efter en omnumrering) översätts en gammal kod bokstav för bokstav: gammal bokstav → grenen
 * som hade den → grenens bokstav nu. En bokstav vars gren inte finns kvar ger ingen kod (`null`): varianten finns inte längre.
 */
import { allCourseVariantList } from "./summary";
import type { CourseSettingDocument } from "./types";
import { findCourse, variantLetters } from "./walk";

/** Gammal bokstav → ny bokstav (null = grenen finns inte kvar) ur grenarnas bokstäver före och efter (gren → bokstav). */
export function letterTranslation(before: ReadonlyMap<string, string> | Readonly<Record<string, string>>, after: ReadonlyMap<string, string>)
  : Map<string, string | null> {
  const entries = before instanceof Map ? [...before.entries()] : Object.entries(before);
  const out = new Map<string, string | null>();
  for (const [branch, letter] of entries) out.set(letter, after.get(branch) ?? null);
  return out;
}

/** Översättningen är ingen ändring (alla bokstäver står kvar på sina grenar). */
export const isIdentity = (letters: ReadonlyMap<string, string | null>) => [...letters].every(([from, to]) => from === to);

/** Koden översatt bokstav för bokstav; en bokstav som inte finns i översättningen står kvar. Null = en gren finns inte kvar. */
export function translateCode(code: string, letters: ReadonlyMap<string, string | null> | Readonly<Record<string, string | null>>): string | null {
  const map: ReadonlyMap<string, string | null> = letters instanceof Map ? letters : new Map(Object.entries(letters as Readonly<Record<string, string | null>>));
  const lookup = (letter: string) => map.get(letter);
  let out = "";
  for (const letter of code) {
    const next = lookup(letter);
    if (next === null) return null;
    out += next ?? letter;
  }
  return out;
}

/**
 * Bortvalen (ADR-0198, kod och kontroller) flyttas till de nya koderna efter att grenarna fått andra bokstäver. `old` är
 * grenarnas bokstäver före. Ett bortval flyttas bara när den översatta koden har samma kontroller; annars står det kvar
 * (och gäller inte, som när banan ändras på annat sätt).
 */
export function renameExcludedVariants(_before: CourseSettingDocument, after: CourseSettingDocument, courseId: string, old: ReadonlyMap<string, string>)
  : CourseSettingDocument {
  const course = findCourse(after, courseId);
  if (!course.excludedVariants?.length) return after;
  let letters: Map<string, string | null>, variants: ReturnType<typeof allCourseVariantList>;
  try {
    letters = letterTranslation(old, variantLetters(after, courseId));
    variants = allCourseVariantList({ ...after, courses: after.courses.map(row => row.id === courseId ? { ...row, excludedVariants: undefined } : row) }, courseId);
  } catch { return after; }
  if (isIdentity(letters)) return after;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((code, index) => code === b[index]);
  const seen = new Set<string>();
  const excludedVariants = course.excludedVariants.flatMap(row => {
    const code = translateCode(row.code, letters);
    const moved = code !== null && variants.some(variant => variant.code === code && same(variant.controlCodes, row.controls))
      ? { code, controls: [...row.controls] } : row;
    const key = `${moved.code} ${moved.controls.join(" ")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [moved];
  });
  return { ...after, courses: after.courses.map(row => row.id === courseId ? { ...row, excludedVariants } : row) };
}
