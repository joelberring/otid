import { describe, expect, it } from "vitest";
import { applyEdit, checkDocument, checkKey, checkLevel, courseVariants, type CourseSettingDocument } from "../src";
import { lineCourse } from "./build";

/**
 * Steg G1 (ägaren 2026-11-21, översynen av gafflingarna A4, A5, A7, A8 och A1:s varning): grunden S-31-32-33-F, gaffel vid 31
 * med 41/42 och (i vissa fall) gaffel vid 32 med 43/44.
 */
const variantsOf = (document: CourseSettingDocument, course: string) => courseVariants(document, course).map(v => [v.code, v.controlCodes.join(" ")]);

function base(second = true) {
  const { b, course, controls } = lineCourse(3);
  const [c31, c32, c33] = controls as [string, string, string];
  const at31 = b.cc(course, c31);
  b.edit({ type: "ADD_SPLIT", course, at: at31, kind: "FORK", branches: 2 });
  const [a, bb] = b.document.courseControls[at31]!.split!.branches as [string, string];
  const c41 = b.control("NORMAL", 10, 10, "41"), c42 = b.control("NORMAL", 10, -10, "42");
  b.insert(course, c41, a);
  b.insert(course, c42, bb);
  let at32 = b.cc(course, c32), c43 = "", c44 = "";
  if (second) {
    b.edit({ type: "ADD_SPLIT", course, at: at32, kind: "FORK", branches: 2 });
    const [c, d] = b.document.courseControls[at32]!.split!.branches as [string, string];
    c43 = b.control("NORMAL", 30, 10, "43"); c44 = b.control("NORMAL", 30, -10, "44");
    b.insert(course, c43, c);
    b.insert(course, c44, d);
  } else at32 = b.cc(course, c32);
  return { b, course, c31, c32, c33, c41, c42, c43, c44, at31, at32 };
}

describe("G1: ta bort gafflingen och grenar", () => {
  it("A4: Ta bort gafflingen behåller gren A oavsett vilken grens kopia som är vald", () => {
    const { b, course, at32 } = base();
    expect(variantsOf(b.document, course)).toEqual([["AC", "31 41 32 43 33"], ["AD", "31 41 32 44 33"], ["BC", "31 42 32 43 33"], ["BD", "31 42 32 44 33"]]);
    const copyD = b.document.courseControls[at32]!.split!.branches[1]!;
    const removed = applyEdit(b.document, { type: "REMOVE_SPLIT", course, at: copyD }).document;
    expect(variantsOf(removed, course)).toEqual([["A", "31 41 32 43 33"], ["B", "31 42 32 43 33"]]);
    expect(removed.courseControls[copyD]).toBeUndefined();
    // Också med gren A vald, och med tre grenar där den sista är vald.
    expect(variantsOf(applyEdit(b.document, { type: "REMOVE_SPLIT", course, at: at32 }).document, course)).toEqual(variantsOf(removed, course));
    b.edit({ type: "ADD_BRANCH", course, at: at32 });
    const copyE = b.document.courseControls[at32]!.split!.branches[2]!;
    expect(variantsOf(applyEdit(b.document, { type: "REMOVE_SPLIT", course, at: copyE }).document, course)).toEqual(variantsOf(removed, course));
  });

  it("A5: med två grenar försvinner gafflingen när en gren tas bort, med tre blir två kvar", () => {
    const { b, course, at32 } = base();
    const copyD = b.document.courseControls[at32]!.split!.branches[1]!;
    const two = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: copyD }).document;
    expect(two.courseControls[at32]!.split).toBeUndefined();
    expect(variantsOf(two, course)).toEqual([["A", "31 41 32 43 33"], ["B", "31 42 32 43 33"]]);
    b.edit({ type: "ADD_BRANCH", course, at: at32 });
    const three = applyEdit(b.document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: copyD }).document;
    expect(three.courseControls[at32]!.split!.branches).toHaveLength(2);
  });
});

describe("G1: inre gaffling som möts där den yttre möts (A7)", () => {
  it("flyttar den yttre gafflingens ihopgång först och varianterna är desamma", () => {
    const { b, course, at31 } = base(false);
    const c41cc = b.document.courseControls[b.document.courseControls[at31]!.split!.branches[0]!]!.next!;
    // Inre gaffling vid 41 i gren A: den möts vid 32, där också den yttre möts.
    b.edit({ type: "ADD_SPLIT", course, at: c41cc, kind: "FORK", branches: 2 });
    const inner = b.document.courseControls[c41cc]!.split!;
    expect(inner.end).toBe(b.document.courseControls[at31]!.split!.end);
    const before = variantsOf(b.document, course);
    b.edit({ type: "MOVE_SPLIT", course, at: c41cc, edge: "END", direction: "FORWARD" });
    expect(variantsOf(b.document, course)).toEqual(before);
    const outer = b.document.courseControls[at31]!.split!;
    const moved = b.document.courseControls[c41cc]!.split!;
    const code = (cc: string) => b.document.controls[b.document.courseControls[cc]!.control]!.code;
    expect(code(outer.end)).toBe("33");
    expect(code(moved.end)).toBe("33");
  });
});

describe("G1: varningar för gafflingar (A8) och samma kontroll två gånger i rad (A1)", () => {
  it("tom gren och lika varianter i en ny gaffling, inte i en slinga", () => {
    const { b, course, at32 } = base(false);
    b.edit({ type: "ADD_SPLIT", course, at: at32, kind: "FORK", branches: 2 });
    const checks = checkDocument(b.document);
    const empty = checks.filter(check => check.kind === "EMPTY_BRANCH");
    expect(empty.map(check => check.kind === "EMPTY_BRANCH" && check.letter)).toEqual(["C", "D"]);
    expect(empty.every(check => checkLevel(check) === "WARNING")).toBe(true);
    const same = checks.filter(check => check.kind === "SAME_VARIANTS");
    expect(same.map(check => check.kind === "SAME_VARIANTS" && check.codes)).toEqual([["AC", "AD"], ["BC", "BD"]]);
    expect(checkKey(same[0]!)).toBe(`SAME_VARIANTS/${course}/AC/AD`);
    // En kontroll i gren C: gren D är fortfarande tom, men varianterna är olika.
    const c43 = b.control("NORMAL", 30, 10, "43");
    b.insert(course, c43, b.document.courseControls[at32]!.split!.branches[0]);
    const after = checkDocument(b.document);
    expect(after.filter(check => check.kind === "EMPTY_BRANCH")).toHaveLength(1);
    expect(after.some(check => check.kind === "SAME_VARIANTS")).toBe(false);
  });

  it("en tom slinga är ingen tom gren", () => {
    const { b, course, at32 } = base(false);
    b.edit({ type: "ADD_SPLIT", course, at: at32, kind: "LOOP", branches: 2 });
    expect(checkDocument(b.document).some(check => check.kind === "EMPTY_BRANCH")).toBe(false);
  });

  it("samma kontroll två gånger i rad i en gren (en variant) varnas", () => {
    const { b, course, at32, c43, c44 } = base();
    const d = b.document.courseControls[at32]!.split!.branches[1]!;
    const after44 = b.document.courseControls[d]!.next!;
    expect(b.document.courseControls[after44]!.control).toBe(c44);
    // 43 finns i gren C; in i gren D efter 44 går bra, men två gånger efter varandra varnas.
    b.insert(course, c43, after44);
    expect(checkDocument(b.document).some(check => check.kind === "SAME_CONTROL_TWICE_IN_ROW")).toBe(false);
    const again = b.document.courseControls[after44]!.next!;
    b.insert(course, c43, again);
    const twice = checkDocument(b.document).filter(check => check.kind === "SAME_CONTROL_TWICE_IN_ROW");
    expect(twice).toEqual([{ kind: "SAME_CONTROL_TWICE_IN_ROW", course, control: c43 }]);
    expect(variantsOf(b.document, course).find(([code]) => code === "AD")).toEqual(["AD", "31 41 32 44 43 43 33"]);
  });
});
