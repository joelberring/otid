import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEdit, carryForkLetters, courseVariants, purplePenLetterDifferences, readPpen, variantLetters, variations, writePpen,
  type CourseSettingDocument
} from "../src";
import { lineCourse } from "./build";

/**
 * ADR-0175, tillägg 2026-11-12 (c): grenarnas bokstäver i banläggningen står kvar när en gren tas bort, så att kartor som
 * tryckts härifrån betyder samma sak i tidtagningen.
 */

/** Nattbanan: S 31 [A:41 | B:42] 50 [C:61 | D:63 | E:64] 70 M. */
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
  return { b, course, first, second };
}

const codes = (document: CourseSettingDocument, course: string) => variations(document, course).map(variation => variation.code);
const controlsOf = (document: CourseSettingDocument, course: string, code: string) =>
  courseVariants(document, course).find(variant => variant.code === code)!.courseControls
    .map(id => document.controls[document.courseControls[id]!.control]!.code).filter(Boolean);

/** Ett dokument som det ser ut på servern före tillägget: inga sparade bokstäver. */
function withoutLetters(document: CourseSettingDocument): CourseSettingDocument {
  return { ...document,
    courseControls: Object.fromEntries(Object.entries(document.courseControls).map(([id, item]) => {
      const copy = { ...item };
      delete copy.letter;
      return [id, copy];
    })),
    courses: document.courses.map(course => { const copy = { ...course }; delete copy.retiredLetters; return copy; }) };
}

describe("bakåtkompatibilitet: dokument utan sparade bokstäver", () => {
  it("har Purple Pens bokstäver och koder, och en ändring som inte rör grenarna sparar inga bokstäver", () => {
    const { b, course } = night();
    const old = withoutLetters(b.document);
    expect(codes(old, course)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
    expect([...variantLetters(old, course).values()]).toEqual([...variantLetters(old, course, { ignoreStored: true }).values()]);
    // Samma koder som när bokstäverna är utskrivna.
    expect(codes(b.document, course)).toEqual(codes(old, course));
    // En kontroll till i grundföljden, en flyttad kontroll och en ny kod: inga bokstäver skrivs.
    const extra = applyEdit(old, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "99" });
    const inserted = applyEdit(extra.document, { type: "INSERT_COURSE_CONTROL", course, control: extra.created! }).document;
    const moved = applyEdit(inserted, { type: "MOVE_CONTROL", control: extra.created!, at: { x: 51, y: 50 } }).document;
    expect(Object.values(moved.courseControls).some(item => item.letter !== undefined)).toBe(false);
    expect(moved.courses.some(row => row.retiredLetters !== undefined)).toBe(false);
    expect(codes(moved, course)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
  });

  it("alla .ppen-filer i fixtures: samma bokstäver som Purple Pen, och en flyttad kontroll skriver inga bokstäver", () => {
    const folder = join(import.meta.dirname, "../../../fixtures/course-setting");
    const files = readdirSync(folder).filter(name => name.endsWith(".ppen"));
    expect(files.length).toBeGreaterThan(0);
    let forked = 0;
    for (const name of files) {
      const document = readPpen(readFileSync(join(folder, name), "utf8")).document;
      for (const course of document.courses) {
        const own = [...variantLetters(document, course.id).entries()];
        expect(own, `${name} ${course.name}`).toEqual([...variantLetters(document, course.id, { ignoreStored: true }).entries()]);
        if (own.length > 0) forked++;
      }
      const control = Object.values(document.controls)[0];
      if (!control) continue;
      const moved = applyEdit(document, { type: "MOVE_CONTROL", control: control.id, at: { x: control.at.x + 1, y: control.at.y } }).document;
      expect(Object.values(moved.courseControls).some(item => item.letter !== undefined), name).toBe(false);
      for (const course of document.courses) expect(codes(moved, course.id), `${name} ${course.name}`).toEqual(codes(document, course.id));
    }
    expect(forked).toBeGreaterThan(0);
  });

  it("en .ppen utan O-Tid:s bokstäver läses in i Purple Pens ordning", () => {
    const { b, course } = night();
    const read = readPpen(writePpen(withoutLetters(b.document))).document;
    expect(Object.values(read.courseControls).some(item => item.letter !== undefined)).toBe(false);
    expect(codes(read, course)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
  });
});

describe("en gren tas bort i banläggningen", () => {
  it("i mitten: C och E står kvar, D blir använd; utskrift och överföring får samma koder", () => {
    const { b, course, second } = night();
    // Dokumentet från servern utan bokstäver; grenen D (63) tas bort.
    const removed = applyEdit(withoutLetters(b.document), { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }).document;
    expect(codes(removed, course)).toEqual(["AC", "AE", "BC", "BE"]);
    expect(controlsOf(removed, course, "AE")).toEqual(["31", "41", "32", "64", "33"]);
    expect(removed.courses.find(row => row.id === course)!.retiredLetters).toEqual(["D"]);
    // Purple Pen skulle ge C, D: exporten varnar.
    expect(purplePenLetterDifferences(removed)).toEqual([{ course: "A", letters: "A, B, C, E", purplePen: "A, B, C, D" }]);
    // Bokstäverna följer med .ppen från O-Tid.
    const back = readPpen(writePpen(removed)).document;
    expect(codes(back, course)).toEqual(["AC", "AE", "BC", "BE"]);
    expect(back.courses.find(row => row.id === course)!.retiredLetters).toEqual(["D"]);
  });

  it("först och sist", () => {
    const { b, course, second } = night();
    const firstGone = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[0]! }).document;
    expect(codes(firstGone, course)).toEqual(["AD", "AE", "BD", "BE"]);
    const lastGone = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[2]! }).document;
    expect(codes(lastGone, course)).toEqual(["AC", "AD", "BC", "BD"]);
  });

  it("en ny gren efter en borttagning får en bokstav som aldrig använts", () => {
    const { b, course, first, second } = night();
    const removed = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }).document;
    // Gafflingen A/B tas bort och görs om med tre grenar: alla tre är nya grenar och får F, G och H (inte A, B eller D,
    // som löpare kan ha på tryckta kartor).
    const without = applyEdit(removed, { type: "REMOVE_SPLIT", course, at: first[0]! }).document;
    expect(codes(without, course)).toEqual(["C", "E"]);
    const again = applyEdit(without, { type: "ADD_SPLIT", course, at: first[0]!, kind: "FORK", branches: 3 }).document;
    expect([...variantLetters(again, course).values()]).toEqual(["F", "G", "H", "C", "E"]);
    expect(again.courses.find(row => row.id === course)!.retiredLetters).toEqual(["A", "B", "D"]);
  });

  it("en hel gaffling tas bort: den andra behåller sina bokstäver", () => {
    const { b, course, first } = night();
    const gone = applyEdit(b.document, { type: "REMOVE_SPLIT", course, at: first[0]! }).document;
    expect(codes(gone, course)).toEqual(["C", "D", "E"]);
  });

  it("slinga: en slinga tas bort och de andra behåller sina bokstäver", () => {
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "LOOP", branches: 3 });
    const branches = b.document.courseControls[at]!.split!.branches;
    for (const [index, branch] of branches.slice(1).entries()) b.insert(course, b.control("NORMAL", 5 + index, 20, String(51 + index)), branch);
    expect([...variantLetters(b.document, course).values()]).toEqual(["A", "B", "C"]);
    const gone = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: branches[2]! }).document;
    expect([...variantLetters(gone, course).values()]).toEqual(["A", "C"]);
  });
});

describe("inläsning av .ppen över en banläggning med sparade bokstäver", () => {
  it("paras efter innehåll: Purple Pens C, D blir C, E igen", () => {
    const { b, course, second } = night();
    const removed = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }).document;
    // Filen sparad i Purple Pen: O-Tid:s element saknas, Purple Pen döper i ordning.
    const fromPurplePen = withoutLetters(readPpen(writePpen(removed)).document);
    expect(codes(fromPurplePen, course)).toEqual(["AC", "AD", "BC", "BD"]);
    const carried = carryForkLetters(removed, fromPurplePen);
    expect(carried.notices).toEqual([]);
    expect(codes(carried.document, course)).toEqual(["AC", "AE", "BC", "BE"]);
  });

  it("en gren som ändrats i Purple Pen går inte att para och sägs", () => {
    const { b, course, second } = night();
    const stamped = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }).document;
    const file = withoutLetters(readPpen(writePpen(stamped)).document);
    // I Purple Pen byttes 64 mot en ny kontroll 65 i den sista grenen.
    const branch = file.courseControls[second[2]!]!;
    const inBranch = file.courseControls[branch.next!]!;
    const changed: CourseSettingDocument = { ...file, controls: { ...file.controls, [inBranch.control]: { ...file.controls[inBranch.control]!, code: "65" } } };
    const carried = carryForkLetters(stamped, changed);
    expect(carried.notices).toEqual([{ course: "A", lost: ["E"], added: ["F"] }]);
    expect(codes(carried.document, course)).toEqual(["AC", "AF", "BC", "BF"]);
  });

  it("utan sparade bokstäver i banläggningen gäller filens ordning som förut", () => {
    const { b, course } = night();
    const file = withoutLetters(readPpen(writePpen(b.document)).document);
    const carried = carryForkLetters(withoutLetters(b.document), file);
    expect(carried.document).toBe(file);
    expect(carried.notices).toEqual([]);
    expect(codes(carried.document, course)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
  });
});
