/**
 * ADR-0175, tillägg 2026-11-12 (c): grenarnas sparade bokstäver i .ppen. Purple Pens format har inga bokstäver (de räknas
 * fram i ordning), så de skrivs som de bortvalda varianterna: ett eget element sist i filen i O-Tid:s namnrymd med JSON.
 * Purple Pen hoppar över elementet och skriver inte tillbaka det; en fil som sparats i Purple Pen saknar det, och då paras
 * grenarna med banläggningens bokstäver när filen läses in (`carryForkLetters`).
 */
import type { CourseSettingDocument } from "./types";
import { attr, el, textOf, type XmlElement } from "./xml";

export const LETTERS_ELEMENT = "otid:letters";
const LETTERS_NAMESPACE = "https://o-tid.se/ns/ppen-letters/1";

interface LettersJson {
  readonly schemaVersion: 1;
  /** Banans id → grenarnas bokstäver (banans kontroll → bokstav) och använda bokstäver. */
  readonly courses: Readonly<Record<string, { readonly branches: Readonly<Record<string, string>>; readonly retired?: readonly string[] }>>;
}

const LETTER = /^[A-Za-z]$/;

/** Bokstäverna ur elementet på banornas kontroller som finns; kastar om versionen eller formen är fel. */
export function readLettersElement(element: XmlElement, document: CourseSettingDocument): CourseSettingDocument {
  if (attr(element, "schema-version") !== "1") throw new Error("okänd version av bokstäverna");
  const parsed = JSON.parse(textOf(element)) as Partial<LettersJson>;
  if (typeof parsed !== "object" || parsed === null || parsed.schemaVersion !== 1 || typeof parsed.courses !== "object" || parsed.courses === null) {
    throw new Error("bokstäverna har fel form");
  }
  const courseControls = { ...document.courseControls };
  const courses = document.courses.map(course => {
    const row = parsed.courses![course.id];
    if (!row || typeof row !== "object" || typeof row.branches !== "object" || row.branches === null) return course;
    for (const [id, letter] of Object.entries(row.branches)) {
      if (typeof letter !== "string" || !LETTER.test(letter)) throw new Error("bokstäverna har fel form");
      const item = courseControls[id];
      if (item) courseControls[id] = { ...item, letter };
    }
    const retired = Array.isArray(row.retired) ? row.retired.filter(letter => typeof letter === "string" && LETTER.test(letter)) : [];
    return retired.length > 0 ? { ...course, retiredLetters: retired } : course;
  });
  return { ...document, courseControls, courses };
}

/** Elementet för filen, eller `undefined` när ingen bana har sparade bokstäver. */
export function lettersElement(document: CourseSettingDocument): XmlElement | undefined {
  const courses: Record<string, { branches: Record<string, string>; retired?: string[] }> = {};
  for (const course of document.courses) {
    const branches: Record<string, string> = {};
    for (const id of reachable(document, course.first)) {
      const item = document.courseControls[id];
      if (item?.letter !== undefined && item.split) branches[id] = item.letter;
    }
    const retired = course.retiredLetters ?? [];
    if (Object.keys(branches).length > 0 || retired.length > 0) courses[course.id] = { branches, ...(retired.length > 0 ? { retired: [...retired] } : {}) };
  }
  if (Object.keys(courses).length === 0) return undefined;
  const out: LettersJson = { schemaVersion: 1, courses };
  return el(LETTERS_ELEMENT, [["xmlns:otid", LETTERS_NAMESPACE], ["schema-version", "1"]], [JSON.stringify(out)]);
}

/** Banans kontroller som nås från den första via nästa och grenar. */
function reachable(document: CourseSettingDocument, first: string | undefined): Set<string> {
  const seen = new Set<string>();
  const stack = first ? [first] : [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const item = document.courseControls[current];
    if (item?.next) stack.push(item.next);
    for (const branch of item?.split?.branches ?? []) stack.push(branch);
  }
  return seen;
}
