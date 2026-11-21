/**
 * ADR-0175, tillägg 2026-11-21 (b): utkast och lås för nycklarna (grenarnas bokstäver) per bana.
 *
 * - Utkast (ingen `Course.forkLetterLock`): grenarna får bokstäver i banans ordning när en gaffling ändras (`keepForkLetters`).
 * - Låst: tillägg (c) gäller (bokstaven står kvar på grenen). Låset sätts av servern (tryck med variantkod, tilldelade
 *   varianter, publicerad startlista; `withForkLetterLocks`) eller för hand (`SET_FORK_LETTER_LOCK`).
 * - «Ordna nycklarna» (`RENUMBER_FORK_LETTERS`): grenarna får bokstäver i banans ordning också i en låst bana, bortvalen följer
 *   med och de använda bokstäverna glöms.
 * - Överföringen till tävlingen sparar grenarnas bokstäver (`transferredLetters`); nästa överföring översätter tävlingens
 *   koder med dem (`transferLetterRenames`).
 *
 * Allt som påverkar bokstäverna står i dokumentet, så att samma ändring ger samma resultat i webbläsaren och på servern.
 */
import { renameExcludedVariants, isIdentity, letterTranslation, translateCode } from "./fork-codes";
import { stampLetters } from "./fork-letters";
import { allCourseVariantList } from "./summary";
import type { Course, CourseSettingDocument, CourseSettingEdit, ForkLetterLock, ForkLetterLockReason } from "./types";
import { CourseSettingEditError } from "./types";
import { findCourse, variantLetters, variations } from "./walk";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const lettersOf = (document: CourseSettingDocument, courseId: string): Map<string, string> => {
  try { return variantLetters(document, courseId); } catch { return new Map(); }
};

export const isForkLetterLocked = (course: Pick<Course, "forkLetterLock">) => course.forkLetterLock !== undefined;

/** Banan har gafflingar eller slingor (minst en gren med bokstav). */
export const isForkedCourse = (document: CourseSettingDocument, courseId: string) => lettersOf(document, courseId).size > 0;

function replace(document: CourseSettingDocument, course: Course): CourseSettingDocument {
  return { ...document, courses: document.courses.map(row => row.id === course.id ? course : row) };
}

function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): T {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

export interface RenumberRow {
  readonly from: string;
  readonly to: string;
  /** Varianten är bortvald (ADR-0198). */
  readonly excluded: boolean;
}

/** Förhandsvisningen av «Ordna nycklarna»: varje variants kod före och efter (också de som inte byter kod). */
export function renumberPreview(document: CourseSettingDocument, courseId: string): RenumberRow[] {
  const before = allCourseVariantList(document, courseId);
  const after = renumberForkLetters(document, courseId);
  const now = variations(after, courseId);
  const old = variations(document, courseId);
  const sameChoices = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
  return old.map(variation => ({ from: variation.code, to: now.find(row => sameChoices(row.choices, variation.choices))?.code ?? variation.code,
    excluded: before.some(row => row.code === variation.code && row.excluded === true) }));
}

/** «Ordna nycklarna» behövs: bokstäverna skiljer sig från banans ordning, eller det finns använda bokstäver. */
export function needsRenumber(document: CourseSettingDocument, courseId: string): boolean {
  const course = findCourse(document, courseId);
  if ((course.retiredLetters?.length ?? 0) > 0) return true;
  const own = lettersOf(document, courseId);
  let purple: Map<string, string>;
  try { purple = variantLetters(document, courseId, { ignoreStored: true }); } catch { return false; }
  return [...own].some(([branch, letter]) => purple.get(branch) !== letter);
}

/** Grenarna får Purple Pens bokstäver i banans ordning (skrivs ut på grenarna), bortvalen följer med och använda glöms. */
export function renumberForkLetters(document: CourseSettingDocument, courseId: string): CourseSettingDocument {
  const course = findCourse(document, courseId);
  if (course.kind === "SCORE") throw new CourseSettingEditError("INVALID", "En poängbana har inga gafflingar");
  const old = variantLetters(document, courseId);
  const purple = variantLetters(document, courseId, { ignoreStored: true });
  const stamped = stampLetters(document, course, purple, []);
  return renameExcludedVariants(document, stamped, courseId, old);
}

function setLock(document: CourseSettingDocument, edit: Extract<CourseSettingEdit, { type: "SET_FORK_LETTER_LOCK" }>): CourseSettingDocument {
  const course = findCourse(document, edit.course);
  if (typeof edit.at !== "string" || !ISO.test(edit.at)) throw new CourseSettingEditError("INVALID", "Tiden för låset saknas");
  if (!edit.locked) {
    if (!course.forkLetterLock) return document;
    return replace(document, { ...without(course, "forkLetterLock"), forkLetterUnlockedAt: edit.at });
  }
  if (course.forkLetterLock) return document;
  const reason = edit.reason ?? "MANUAL";
  if (reason !== "MANUAL" && reason !== "PRINT") throw new CourseSettingEditError("INVALID", "Låset sätts för hand eller av en utskrift");
  return replace(document, { ...without(course, "forkLetterUnlockedAt"), forkLetterLock: { reason, at: edit.at } });
}

/** Ändringarna i nycklarna (`RENUMBER_FORK_LETTERS`, `SET_FORK_LETTER_LOCK`). */
export function applyForkLetterEdit(document: CourseSettingDocument, edit: Extract<CourseSettingEdit, { type: "RENUMBER_FORK_LETTERS" | "SET_FORK_LETTER_LOCK" }>)
  : CourseSettingDocument {
  return edit.type === "RENUMBER_FORK_LETTERS" ? renumberForkLetters(document, edit.course) : setLock(document, edit);
}

export interface ForkLetterLockRequest {
  readonly course: string;
  readonly reason: ForkLetterLockReason;
  readonly at: string;
  /**
   * En ny händelse (tryck, fördelning, publicering): låser också en bana vars lås hävts för hand. Utan `force` (tävlingens
   * läge, vid läsning och överföring) låses en bana vars lås hävts för hand inte igen.
   */
  readonly force?: boolean | undefined;
}

/** Servern låser banor (bara gafflade och olåsta). Samma dokument tillbaka när inget ändras. */
export function withForkLetterLocks(document: CourseSettingDocument, locks: readonly ForkLetterLockRequest[]): CourseSettingDocument {
  let result = document;
  for (const request of locks) {
    const course = result.courses.find(row => row.id === request.course);
    if (!course || course.kind === "SCORE" || course.forkLetterLock || !isForkedCourse(result, course.id)) continue;
    if (course.forkLetterUnlockedAt !== undefined && !request.force) continue;
    const lock: ForkLetterLock = { reason: request.reason, at: request.at };
    result = replace(result, { ...without(course, "forkLetterUnlockedAt"), forkLetterLock: lock });
  }
  return result;
}

/** Grenarnas bokstäver nu (gren → bokstav), det som överföringen sparar i `transferredLetters`. */
export function transferLetters(document: CourseSettingDocument, courseId: string): Record<string, string> {
  return Object.fromEntries(lettersOf(document, courseId));
}

/**
 * Översättningen för överföringen: tävlingens koder (med bokstäverna vid förra överföringen) → koderna nu, bokstav för
 * bokstav. `undefined` när inget bytt bokstav (eller banan aldrig förts över).
 */
export function transferLetterRenames(document: CourseSettingDocument, courseId: string): Record<string, string | null> | undefined {
  const course = findCourse(document, courseId);
  if (!course.transferredLetters) return undefined;
  const letters = letterTranslation(course.transferredLetters, lettersOf(document, courseId));
  return isIdentity(letters) ? undefined : Object.fromEntries(letters);
}

/** En kod i tävlingen översatt med `transferLetterRenames` (null = varianten finns inte längre). */
export const translateTransferredCode = (code: string, renames: Readonly<Record<string, string | null>>) => translateCode(code, renames);

/** Servern sparar bokstäverna som fördes över (per bana). Samma dokument tillbaka när inget ändras. */
export function withTransferredLetters(document: CourseSettingDocument, rows: readonly { readonly course: string; readonly letters: Readonly<Record<string, string>> }[])
  : CourseSettingDocument {
  let result = document;
  for (const row of rows) {
    const course = result.courses.find(candidate => candidate.id === row.course);
    if (!course) continue;
    const empty = Object.keys(row.letters).length === 0;
    const same = course.transferredLetters !== undefined && Object.keys(course.transferredLetters).length === Object.keys(row.letters).length &&
      Object.entries(row.letters).every(([branch, letter]) => course.transferredLetters![branch] === letter);
    if (same || (empty && course.transferredLetters === undefined)) continue;
    result = replace(result, empty ? without(course, "transferredLetters") : { ...course, transferredLetters: { ...row.letters } });
  }
  return result;
}
