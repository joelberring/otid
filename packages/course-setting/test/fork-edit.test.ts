import { describe, expect, it } from "vitest";
import {
  CourseSettingEditError, applyEdit, courseVariants, readPpen, variantLetters, writePpen, type CourseSettingDocument, type CourseSettingEdit
} from "../src";
import { lineCourse, type Builder } from "./build";

const variantsOf = (document: CourseSettingDocument, course: string) => courseVariants(document, course).map(v => [v.code, v.controlCodes.join(" ")]);
const roundTrip = (document: CourseSettingDocument) => readPpen(writePpen(document)).document;
function failure(document: CourseSettingDocument, edit: CourseSettingEdit): string {
  try { applyEdit(document, edit); } catch (error) { if (error instanceof CourseSettingEditError) return error.message; throw error; }
  throw new Error("Ändringen gick igenom");
}

/** S 31 [A: 35 | B: 36] 32 33 34 F, gafflingen vid 31. */
function forked(): { b: Builder; course: string; at: string } {
  const { b, course, controls } = lineCourse(4);
  const at = b.cc(course, controls[0]!);
  b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
  const branches = b.document.courseControls[at]!.split!.branches;
  b.insert(course, b.control("NORMAL", 10, 10), branches[0]);
  b.insert(course, b.control("NORMAL", 10, -10), branches[1]);
  return { b, course, at };
}

describe("gafflingar: grenar och flytt (ägaren 2026-11-17)", () => {
  it("lägger till en tom gren och tar bort den igen", () => {
    const { b, course, at } = forked();
    b.edit({ type: "ADD_BRANCH", course, at });
    expect(variantsOf(b.document, course)).toEqual([["A", "31 35 32 33 34"], ["B", "31 36 32 33 34"], ["C", "31 32 33 34"]]);
    const added = b.document.courseControls[at]!.split!.branches[2]!;
    b.edit({ type: "REMOVE_COURSE_CONTROL", course, courseControl: added });
    expect(variantsOf(b.document, course)).toEqual([["A", "31 35 32 33 34"], ["B", "31 36 32 33 34"]]);
    expect(roundTrip(b.document)).toEqual(b.document);
  });

  it("flyttar början framåt när grenarna börjar med samma kontroll, och tillbaka", () => {
    const { b, course, at } = forked();
    expect(failure(b.document, { type: "MOVE_SPLIT", course, at, edge: "START", direction: "FORWARD" })).toMatch(/inte med samma kontroll \(35, 36\)/);
    // 37 först i båda grenarna (som ägarens 56).
    const common = b.control("NORMAL", 5, 0);
    for (const branch of b.document.courseControls[at]!.split!.branches) b.insert(course, common, branch);
    expect(variantsOf(b.document, course)).toEqual([["A", "31 37 35 32 33 34"], ["B", "31 37 36 32 33 34"]]);
    b.edit({ type: "MOVE_SPLIT", course, at, edge: "START", direction: "FORWARD" });
    // Samma varianter, men 37 är gemensam och gafflingen börjar vid den (grenarnas id och bokstäver är kvar).
    expect(variantsOf(b.document, course)).toEqual([["A", "31 37 35 32 33 34"], ["B", "31 37 36 32 33 34"]]);
    expect(b.document.controls[b.document.courseControls[at]!.control]!.code).toBe("37");
    expect([...variantLetters(b.document, course).values()]).toEqual(["A", "B"]);
    expect(roundTrip(b.document)).toEqual(b.document);
    b.edit({ type: "MOVE_SPLIT", course, at, edge: "START", direction: "BACK" });
    expect(b.document.controls[b.document.courseControls[at]!.control]!.code).toBe("31");
    expect(variantsOf(b.document, course)).toEqual([["A", "31 37 35 32 33 34"], ["B", "31 37 36 32 33 34"]]);
    // Före 31 finns starten: gafflingen kan börja där också, men inte före kartutdelning eller utan kontroll före.
    b.edit({ type: "MOVE_SPLIT", course, at, edge: "START", direction: "BACK" });
    expect(failure(b.document, { type: "MOVE_SPLIT", course, at, edge: "START", direction: "BACK" })).toMatch(/ingen kontroll före/);
  });

  it("flyttar mötespunkten framåt och tillbaka, och vägrar när grenarna inte slutar lika", () => {
    const { b, course, at } = forked();
    b.edit({ type: "MOVE_SPLIT", course, at, edge: "END", direction: "FORWARD" });
    const end = b.document.courseControls[at]!.split!.end;
    expect(b.document.controls[b.document.courseControls[end]!.control]!.code).toBe("33");
    expect(variantsOf(b.document, course)).toEqual([["A", "31 35 32 33 34"], ["B", "31 36 32 33 34"]]);
    expect(roundTrip(b.document)).toEqual(b.document);
    b.edit({ type: "MOVE_SPLIT", course, at, edge: "END", direction: "BACK" });
    expect(b.document.controls[b.document.courseControls[b.document.courseControls[at]!.split!.end]!.control]!.code).toBe("32");
    expect(failure(b.document, { type: "MOVE_SPLIT", course, at, edge: "END", direction: "BACK" })).toMatch(/inte med samma kontroll \(35, 36\)/);
    b.edit({ type: "ADD_BRANCH", course, at });
    expect(failure(b.document, { type: "MOVE_SPLIT", course, at, edge: "END", direction: "BACK" })).toMatch(/tomma grenar/);
  });

  it("en slinga flyttas inte, och fel id ger NOT_FOUND", () => {
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "LOOP", branches: 2 });
    expect(failure(b.document, { type: "MOVE_SPLIT", course, at, edge: "END", direction: "FORWARD" })).toMatch(/slinga/);
    b.edit({ type: "ADD_BRANCH", course, at });
    expect(courseVariants(b.document, course).length).toBe(6);
    expect(() => applyEdit(b.document, { type: "ADD_BRANCH", course, at: "999" })).toThrow(/finns inte/);
  });
});
