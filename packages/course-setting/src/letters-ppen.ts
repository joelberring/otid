/**
 * ADR-0175, tillägg 2026-11-12 (c): grenarnas sparade bokstäver i .ppen. Purple Pens format har inga bokstäver (de räknas
 * fram i ordning), så de skrivs som de bortvalda varianterna: ett eget element sist i filen i O-Tid:s namnrymd med JSON.
 * Purple Pen hoppar över elementet och skriver inte tillbaka det; en fil som sparats i Purple Pen saknar det, och då paras
 * grenarna med banläggningens bokstäver när filen läses in (`carryForkLetters`).
 *
 * Tillägg 2026-11-21 (b): låset (`lock`, `unlockedAt`) och bokstäverna vid senaste överföringen (`transferred`) följer med.
 */
import type { Course, CourseSettingDocument, ForkLetterLock } from "./types";
import { attr, el, textOf, type XmlElement } from "./xml";

export const LETTERS_ELEMENT = "otid:letters";
const LETTERS_NAMESPACE = "https://o-tid.se/ns/ppen-letters/1";

interface LettersJson {
  readonly schemaVersion: 1;
  /** Banans id → grenarnas bokstäver (banans kontroll → bokstav) och använda bokstäver. */
  readonly courses: Readonly<Record<string, CourseLetters>>;
}

interface CourseLetters {
  readonly branches: Readonly<Record<string, string>>;
  readonly retired?: readonly string[];
  readonly lock?: ForkLetterLock;
  readonly unlockedAt?: string;
  readonly transferred?: Readonly<Record<string, string>>;
}

const REASONS = new Set(["MANUAL", "PRINT", "ASSIGNED", "START_LIST"]);

/** Låset och överförda bokstäver ur filen (det som har fel form hoppas över). */
function lockFields(row: Partial<CourseLetters>): Partial<Pick<Course, "forkLetterLock" | "forkLetterUnlockedAt" | "transferredLetters">> {
  const out: { forkLetterLock?: ForkLetterLock; forkLetterUnlockedAt?: string; transferredLetters?: Record<string, string> } = {};
  const lock = row.lock as Partial<ForkLetterLock> | undefined;
  if (lock && typeof lock === "object" && typeof lock.reason === "string" && REASONS.has(lock.reason) && typeof lock.at === "string") {
    out.forkLetterLock = { reason: lock.reason, at: lock.at };
  }
  if (typeof row.unlockedAt === "string") out.forkLetterUnlockedAt = row.unlockedAt;
  if (row.transferred && typeof row.transferred === "object") {
    const entries = Object.entries(row.transferred).filter(([, letter]) => typeof letter === "string" && LETTER.test(letter));
    if (entries.length > 0) out.transferredLetters = Object.fromEntries(entries);
  }
  return out;
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
    return { ...course, ...(retired.length > 0 ? { retiredLetters: retired } : {}), ...lockFields(row) };
  });
  return { ...document, courseControls, courses };
}

/** Elementet för filen, eller `undefined` när ingen bana har sparade bokstäver. */
export function lettersElement(document: CourseSettingDocument): XmlElement | undefined {
  const courses: Record<string, CourseLetters> = {};
  for (const course of document.courses) {
    const branches: Record<string, string> = {};
    for (const id of reachable(document, course.first)) {
      const item = document.courseControls[id];
      if (item?.letter !== undefined && item.split) branches[id] = item.letter;
    }
    const retired = course.retiredLetters ?? [];
    const extra = { ...(course.forkLetterLock ? { lock: course.forkLetterLock } : {}),
      ...(course.forkLetterUnlockedAt !== undefined ? { unlockedAt: course.forkLetterUnlockedAt } : {}),
      ...(course.transferredLetters ? { transferred: course.transferredLetters } : {}) };
    if (Object.keys(branches).length > 0 || retired.length > 0 || Object.keys(extra).length > 0) {
      courses[course.id] = { branches, ...(retired.length > 0 ? { retired: [...retired] } : {}), ...extra };
    }
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
