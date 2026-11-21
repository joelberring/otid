import { describe, expect, it } from "vitest";
import {
  applyEdit, courseVariants, renumberPreview, transferLetterRenames, transferLetters, translateTransferredCode, variantLetters, variations,
  withForkLetterLocks, withTransferredLetters, writePpen, readPpen, type CourseSettingDocument
} from "../src";
import { lineCourse } from "./build";

/**
 * ADR-0175, tillägg 2026-11-21 (b): utkast och lås för nycklarna, «Ordna nycklarna» och översättningen vid överföringen.
 * Nattbanan: S 31 [A:41 | B:42] 32 [C:61 | D:63 | E:64] 33 M.
 */
function night() {
  const { b, course, controls } = lineCourse(3);
  const [c31, c50] = controls;
  const at31 = b.cc(course, c31!), at50 = b.cc(course, c50!);
  b.edit({ type: "ADD_SPLIT", course, at: at31, kind: "FORK", branches: 2 });
  const first = b.document.courseControls[at31]!.split!.branches;
  b.insert(course, b.control("NORMAL", 10, 10, "41"), first[0]);
  b.insert(course, b.control("NORMAL", 10, -10, "42"), first[1]);
  b.edit({ type: "ADD_SPLIT", course, at: at50, kind: "FORK", branches: 3 });
  const second = b.document.courseControls[at50]!.split!.branches;
  b.insert(course, b.control("NORMAL", 30, 10, "61"), second[0]);
  b.insert(course, b.control("NORMAL", 30, 0, "63"), second[1]);
  b.insert(course, b.control("NORMAL", 30, -10, "64"), second[2]);
  return { b, course, first, second, at50 };
}

const AT = "2026-11-21T10:00:00Z";
const codes = (document: CourseSettingDocument, course: string) => variations(document, course).map(variation => variation.code);
const letters = (document: CourseSettingDocument, course: string) => [...variantLetters(document, course).values()];
const controlsOf = (document: CourseSettingDocument, course: string, code: string) =>
  courseVariants(document, course).find(variant => variant.code === code)?.controlCodes;
const courseOf = (document: CourseSettingDocument, course: string) => document.courses.find(row => row.id === course)!;
const lock = (document: CourseSettingDocument, course: string) =>
  applyEdit(document, { type: "SET_FORK_LETTER_LOCK", course, locked: true, reason: "MANUAL", at: AT }).document;
const edit = (document: CourseSettingDocument, change: Parameters<typeof applyEdit>[1]) => applyEdit(document, change).document;

describe("utkast: bokstäverna följer banans ordning", () => {
  it("en gren tas bort ur en gaffling med tre grenar: sista bokstaven försvinner, inga använda bokstäver", () => {
    const { b, course, second } = night();
    const removed = edit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    expect(letters(removed, course)).toEqual(["A", "B", "C", "D"]);
    expect(codes(removed, course)).toEqual(["AC", "AD", "BC", "BD"]);
    // E-grenen (64) heter nu D.
    expect(controlsOf(removed, course, "AD")).toEqual(["31", "41", "32", "64", "33"]);
    expect(courseOf(removed, course).retiredLetters).toBeUndefined();
    expect(Object.values(removed.courseControls).some(item => item.letter !== undefined)).toBe(false);
  });

  it("en gaffling som tas bort och görs om får nästa bokstäver i ordning (C, D igen)", () => {
    const { b, course, at50 } = night();
    const gone = edit(b.document, { type: "REMOVE_SPLIT", course, at: at50 });
    expect(letters(gone, course)).toEqual(["A", "B"]);
    const again = edit(gone, { type: "ADD_SPLIT", course, at: at50, kind: "FORK", branches: 2 });
    expect(letters(again, course)).toEqual(["A", "B", "C", "D"]);
  });

  it("sparade bokstäver med lucka står kvar tills nästa gafflingsändring", () => {
    const { b, course, second } = night();
    // Låst, D tas bort (C, E), sedan hävs låset: banan är utkast men behåller C, E.
    const locked = edit(lock(b.document, course), { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    const draft = edit(locked, { type: "SET_FORK_LETTER_LOCK", course, locked: false, at: AT });
    expect(courseOf(draft, course).forkLetterLock).toBeUndefined();
    expect(courseOf(draft, course).forkLetterUnlockedAt).toBe(AT);
    expect(letters(draft, course)).toEqual(["A", "B", "C", "E"]);
    const moved = edit(draft, { type: "MOVE_CONTROL", control: Object.keys(draft.controls)[0]!, at: { x: 1, y: 1 } });
    expect(letters(moved, course)).toEqual(["A", "B", "C", "E"]);
    // Nästa gafflingsändring ordnar bokstäverna.
    const branch = edit(moved, { type: "ADD_BRANCH", course, at: second[0]! });
    expect(letters(branch, course)).toEqual(["A", "B", "C", "D", "E"]);
    expect(courseOf(branch, course).retiredLetters).toBeUndefined();
  });

  it("bortvalen följer med när utkastet ordnar om bokstäverna", () => {
    const { b, course, second } = night();
    const excluded = edit(b.document, { type: "UPDATE_COURSE", course, changes: { excludedVariants: [{ code: "BE", controls: controlsOf(b.document, course, "BE")! }] } });
    const removed = edit(excluded, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    expect(courseOf(removed, course).excludedVariants).toEqual([{ code: "BD", controls: ["31", "42", "32", "64", "33"] }]);
    expect(courseVariants(removed, course).map(variant => variant.code)).toEqual(["AC", "AD", "BC"]);
  });
});

describe("låst: bokstaven står kvar (tillägg c)", () => {
  it("D tas bort: C, E och D blir använd; en ny gren får F", () => {
    const { b, course, second } = night();
    const removed = edit(lock(b.document, course), { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    expect(codes(removed, course)).toEqual(["AC", "AE", "BC", "BE"]);
    expect(courseOf(removed, course).retiredLetters).toEqual(["D"]);
    expect(letters(edit(removed, { type: "ADD_BRANCH", course, at: second[0]! }), course)).toEqual(["A", "B", "C", "E", "F"]);
  });

  it("låset följer med i .ppen", () => {
    const { b, course } = night();
    const locked = withTransferredLetters(lock(b.document, course), [{ course, letters: transferLetters(b.document, course) }]);
    const back = readPpen(writePpen(locked)).document;
    expect(courseOf(back, course).forkLetterLock).toEqual({ reason: "MANUAL", at: AT });
    expect(courseOf(back, course).transferredLetters).toEqual(courseOf(locked, course).transferredLetters);
  });
});

describe("«Ordna nycklarna»", () => {
  it("i en låst bana: C, E blir C, D, bortvalet flyttas med och de använda bokstäverna glöms", () => {
    const { b, course, second } = night();
    let document = edit(lock(b.document, course), { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    document = edit(document, { type: "UPDATE_COURSE", course, changes: { excludedVariants: [{ code: "AE", controls: controlsOf(document, course, "AE")! }] } });
    expect(renumberPreview(document, course)).toEqual([
      { from: "AC", to: "AC", excluded: false }, { from: "AE", to: "AD", excluded: true },
      { from: "BC", to: "BC", excluded: false }, { from: "BE", to: "BD", excluded: false }]);
    const renumbered = edit(document, { type: "RENUMBER_FORK_LETTERS", course });
    expect(codes(renumbered, course)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(courseOf(renumbered, course).retiredLetters).toBeUndefined();
    expect(courseOf(renumbered, course).excludedVariants).toEqual([{ code: "AD", controls: ["31", "41", "32", "64", "33"] }]);
    expect(courseVariants(renumbered, course).map(variant => variant.code)).toEqual(["AC", "BC", "BD"]);
    // Låset står kvar; en ny gren efter omnumreringen får nästa lediga (E).
    expect(courseOf(renumbered, course).forkLetterLock).toBeDefined();
    expect(letters(edit(renumbered, { type: "ADD_BRANCH", course, at: second[0]! }), course)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("servern låser och översättningen vid överföringen", () => {
  it("låser bara gafflade och olåsta banor; ett lås som hävts för hand låses bara av en ny händelse", () => {
    const { b, course } = night();
    const locked = withForkLetterLocks(b.document, [{ course, reason: "ASSIGNED", at: AT }]);
    expect(courseOf(locked, course).forkLetterLock).toEqual({ reason: "ASSIGNED", at: AT });
    expect(withForkLetterLocks(locked, [{ course, reason: "PRINT", at: AT }])).toBe(locked);
    const unlocked = edit(locked, { type: "SET_FORK_LETTER_LOCK", course, locked: false, at: AT });
    expect(withForkLetterLocks(unlocked, [{ course, reason: "ASSIGNED", at: AT }])).toBe(unlocked);
    expect(courseOf(withForkLetterLocks(unlocked, [{ course, reason: "PRINT", at: AT, force: true }]), course).forkLetterLock?.reason).toBe("PRINT");
    const plain = lineCourse(2);
    expect(withForkLetterLocks(plain.b.document, [{ course: plain.course, reason: "ASSIGNED", at: AT }])).toBe(plain.b.document);
  });

  it("koderna från förra överföringen översätts bokstav för bokstav; en borttagen gren ger ingen kod", () => {
    const { b, course, second } = night();
    // Överfört med C, D, E (låst), sedan D bort och «Ordna nycklarna»: E blir D.
    let document = withTransferredLetters(lock(b.document, course), [{ course, letters: transferLetters(b.document, course) }]);
    expect(transferLetterRenames(document, course)).toBeUndefined();
    document = edit(document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! });
    document = edit(document, { type: "RENUMBER_FORK_LETTERS", course });
    const renames = transferLetterRenames(document, course)!;
    expect(renames).toEqual({ A: "A", B: "B", C: "C", D: null, E: "D" });
    expect(translateTransferredCode("AE", renames)).toBe("AD");
    expect(translateTransferredCode("BC", renames)).toBe("BC");
    expect(translateTransferredCode("AD", renames)).toBeNull();
    // Samma kontroller för den översatta koden som för den gamla.
    expect(controlsOf(document, course, "AD")).toEqual(controlsOf(b.document, course, "AE"));
  });
});
