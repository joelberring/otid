/**
 * ADR-0175, tillägg 2026-11-12 (c): grenarnas bokstäver i banläggningen är grenarnas identitet, som i tidtagningen. Kartorna
 * trycks härifrån med variantkoden, så en bokstav ska betyda samma gren efter en ändring:
 *
 * - Ett dokument utan sparade bokstäver har Purple Pens ordning (`variantLetters`) tills en gaffling eller slinga ändras.
 * - När en banas grenar ändras (`keepForkLetters`, efter varje ändring) skrivs bokstäverna ut på grenarna: de som finns kvar
 *   behåller sin bokstav, en borttagen grens bokstav blir använd (`retiredLetters`) och en ny gren får nästa lediga.
 * - En .ppen saknar bokstäver (Purple Pen döper i ordning). Läses en fil in över en banläggning med sparade bokstäver paras
 *   grenarna efter innehåll (`carryForkLetters`); det som inte går att para sägs.
 */
import { enumerateCourseControls, findCourse, variantLetters } from "./walk";
import type { Course, CourseControl, CourseSettingDocument } from "./types";

const lettersOf = (document: CourseSettingDocument, courseId: string): Map<string, string> => {
  try { return variantLetters(document, courseId); } catch { return new Map(); }
};

/** Banan har sparade bokstäver (en gren med `letter` eller använda bokstäver). */
export function hasStoredForkLetters(document: CourseSettingDocument, course: Course): boolean {
  if ((course.retiredLetters?.length ?? 0) > 0) return true;
  try {
    return enumerateCourseControls(document, course.id).some(id => document.courseControls[id]?.letter !== undefined);
  } catch { return false; }
}

const sameOrder = (left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) =>
  left.size === right.size && [...left.keys()].every((key, index) => [...right.keys()][index] === key);

/**
 * Skriver ut bokstäverna på banans grenar: `kept` (gren → bokstav) gäller, övriga grenar får nästa lediga bokstav som inte
 * är använd. Tar bort `letter` från banans kontroller som inte längre börjar en gren.
 */
function stampLetters(document: CourseSettingDocument, course: Course, kept: ReadonlyMap<string, string>, retired: readonly string[]): CourseSettingDocument {
  const keptLetters = new Set(kept.values());
  const retiredLetters = [...new Set(retired)].filter(letter => !keptLetters.has(letter)).sort();
  const base: Course = retiredLetters.length > 0 ? { ...course, retiredLetters } : withoutRetired(course);
  const courseControls: Record<string, CourseControl> = { ...document.courseControls };
  let ids: string[] = [];
  try { ids = enumerateCourseControls(document, course.id); } catch { return document; }
  // Först de kvarvarande bokstäverna, sedan räknas de nya fram med dem som upptagna.
  for (const id of ids) {
    const item = courseControls[id];
    if (!item) continue;
    const letter = kept.get(id);
    courseControls[id] = letter !== undefined ? { ...item, letter } : withoutLetter(item);
  }
  const draft: CourseSettingDocument = { ...document, courseControls, courses: document.courses.map(row => row.id === course.id ? base : row) };
  const letters = lettersOf(draft, course.id);
  for (const [id, letter] of letters) courseControls[id] = { ...courseControls[id]!, letter };
  return draft;
}

function withoutLetter(item: CourseControl): CourseControl {
  if (item.letter === undefined) return item;
  const copy = { ...item };
  delete copy.letter;
  return copy;
}

function withoutRetired(course: Course): Course {
  if (course.retiredLetters === undefined) return course;
  const copy = { ...course };
  delete copy.retiredLetters;
  return copy;
}

/**
 * Efter en ändring: för varje bana vars grenar ändrats (andra grenar eller annan ordning) skrivs bokstäverna ut så att de
 * gamla står kvar. En bana utan ändrade grenar rörs inte, så ett dokument utan sparade bokstäver behåller Purple Pens
 * ordning tills en gaffling eller slinga ändras.
 */
export function keepForkLetters(before: CourseSettingDocument, after: CourseSettingDocument): CourseSettingDocument {
  let result = after;
  for (const course of after.courses) {
    if (course.kind === "SCORE") continue;
    const previous = before.courses.find(row => row.id === course.id);
    if (!previous) continue;
    const old = lettersOf(before, course.id);
    const now = lettersOf(after, course.id);
    if (sameOrder(old, now)) continue;
    const kept = new Map([...now.keys()].flatMap(id => old.has(id) ? [[id, old.get(id)!] as const] : []));
    result = stampLetters(result, findCourse(result, course.id), kept, [...(previous.retiredLetters ?? []), ...old.values()]);
  }
  return result;
}

/** Grenens innehåll: gaffelkontrollens kod och kontrollerna i grenen fram till där grenarna möts. */
function branchKey(document: CourseSettingDocument, branch: string): string | undefined {
  const start = document.courseControls[branch];
  const split = start?.split;
  if (!start || !split) return undefined;
  const codeOf = (item: CourseControl | undefined) => {
    const point = item ? document.controls[item.control] : undefined;
    return point?.code ?? point?.kind ?? "?";
  };
  const codes: string[] = [split.kind, codeOf(start)];
  let next = start.next;
  for (let steps = 0; next !== undefined && next !== split.end && steps < 10_000; steps++) {
    const item = document.courseControls[next];
    codes.push(codeOf(item));
    next = item?.next;
  }
  return codes.join(" ");
}

export interface ForkLetterNotice {
  readonly course: string;
  /** Bokstäver från tidigare kartor som ingen gren i filen fick (grenen finns inte eller har ändrats). */
  readonly lost: readonly string[];
  /** Grenar i filen som inte fanns förut och fick nya bokstäver. */
  readonly added: readonly string[];
}

/**
 * En inläst .ppen ersätter banläggningen. Har en bana i den nuvarande sparade bokstäver och saknar filen dem (Purple Pen
 * skriver inte O-Tid:s element) paras filens grenar efter innehåll med de gamla: samma kontroller ger samma bokstav, en
 * gren som inte går att para får nästa lediga bokstav och en gammal bokstav utan gren blir använd. Det som inte gick att
 * para sägs per bana.
 */
export function carryForkLetters(current: CourseSettingDocument, imported: CourseSettingDocument)
  : { readonly document: CourseSettingDocument; readonly notices: readonly ForkLetterNotice[] } {
  let document = imported;
  const notices: ForkLetterNotice[] = [];
  for (const course of imported.courses) {
    if (course.kind === "SCORE" || hasStoredForkLetters(imported, course)) continue;
    const previous = current.courses.find(row => row.id === course.id && row.name === course.name) ??
      current.courses.find(row => row.name === course.name);
    if (!previous || !hasStoredForkLetters(current, previous)) continue;
    const old = lettersOf(current, previous.id);
    const now = lettersOf(document, course.id);
    const oldByKey = new Map<string, string[]>();
    for (const [branch, letter] of old) {
      const key = branchKey(current, branch);
      if (key !== undefined) oldByKey.set(key, [...(oldByKey.get(key) ?? []), letter]);
    }
    const kept = new Map<string, string>();
    for (const branch of now.keys()) {
      const key = branchKey(document, branch);
      const candidates = key === undefined ? undefined : oldByKey.get(key);
      const letter = candidates?.shift();
      if (letter !== undefined) kept.set(branch, letter);
    }
    document = stampLetters(document, course, kept, [...(previous.retiredLetters ?? []), ...old.values()]);
    const keptLetters = new Set(kept.values());
    const lost = [...old.values()].filter(letter => !keptLetters.has(letter));
    const fresh = lettersOf(document, course.id);
    const added = [...fresh].filter(([branch]) => !kept.has(branch)).map(([, letter]) => letter);
    if (lost.length > 0 || added.length > 0) notices.push({ course: course.name, lost, added });
  }
  return { document, notices };
}

/**
 * Banor vars bokstäver i O-Tid skiljer sig från dem Purple Pen ger samma fil (en lucka efter en borttagen gren). En .ppen
 * har inga bokstäver, så i Purple Pen blir de andra än på O-Tid:s kartor.
 */
export function purplePenLetterDifferences(document: CourseSettingDocument): { readonly course: string; readonly letters: string; readonly purplePen: string }[] {
  return document.courses.flatMap(course => {
    if (course.kind === "SCORE") return [];
    let own: Map<string, string>, purple: Map<string, string>;
    try {
      own = variantLetters(document, course.id);
      purple = variantLetters(document, course.id, { ignoreStored: true });
    } catch { return []; }
    const letters = [...own.values()].join(", "), purplePen = [...purple.values()].join(", ");
    return letters === purplePen ? [] : [{ course: course.name, letters, purplePen }];
  });
}
