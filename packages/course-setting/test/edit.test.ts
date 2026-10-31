import { describe, expect, it } from "vitest";
import {
  CourseSettingEditError, applyEdit, courseControlOrder, courseSummaries, courseVariants, emptyDocument, nextFreeCode,
  readPpen, writePpen, type CourseSettingDocument, type CourseSettingEdit
} from "../src";
import { Builder, lineCourse } from "./build";

const codesOf = (document: CourseSettingDocument, course: string, variant?: string) =>
  courseControlOrder(document, course, variant).map(id => document.controls[document.courseControls[id]!.control]!)
    .map(control => control.code ?? control.kind);

const roundTrip = (document: CourseSettingDocument) => readPpen(writePpen(document)).document;

function expectError(document: CourseSettingDocument, edit: CourseSettingEdit, code: CourseSettingEditError["code"]): void {
  try {
    applyEdit(document, edit);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(CourseSettingEditError);
    expect((error as CourseSettingEditError).code).toBe(code);
  }
}

describe("emptyDocument", () => {
  it("ger ISOM 2017 och går fram och tillbaka", () => {
    const document = emptyDocument({ title: "Träning", mapScale: 10000 });
    expect(document.event.overprintStandard).toBe("ISOM2017");
    expect(document.event.descriptionStandard).toBe("2018");
    expect(roundTrip(document)).toEqual(document);
    expect(writePpen(document)).toContain('<standards map="2017" description="2018" />');
  });

  it("sprint ger ISSprOM 2019 med storlekar relativt kartan", () => {
    const document = emptyDocument({ title: "Sprint", mapScale: 4000, sprint: true });
    expect(document.event.overprintStandard).toBe("ISSPROM2019");
    expect(writePpen(document)).toContain('scale-sizes="RelativeToMap"');
    expect(writePpen(document)).toContain('map="Spr2019"');
  });
});

describe("applyEdit", () => {
  it("ger id som nästa lediga heltal och koder från numreringen", () => {
    const b = new Builder();
    expect(b.control("NORMAL", 0, 0)).toBe("1");
    expect(b.control("NORMAL", 10, 0)).toBe("2");
    expect(b.code("1")).toBe("31");
    expect(b.code("2")).toBe("32");
    expect(nextFreeCode(b.document)).toBe("33");
  });

  it("hoppar över omvändbara koder när de ska undvikas", () => {
    const b = new Builder();
    b.edit({ type: "SET_EVENT", changes: { numbering: { start: 65, disallowInvertible: true } } });
    expect(["65", "67", "69", "70"].map(() => b.code(b.control("NORMAL", 0, 0)))).toEqual(["65", "67", "69", "70"]);
    b.edit({ type: "SET_EVENT", changes: { numbering: { start: 98, disallowInvertible: false } } });
    expect(nextFreeCode(b.document)).toBe("98");
  });

  it("ändrar aldrig det gamla dokumentet", () => {
    const { b, course, controls } = lineCourse(3);
    const before = JSON.stringify(b.document);
    const old = b.document;
    applyEdit(old, { type: "DELETE_CONTROL", control: controls[1]! });
    applyEdit(old, { type: "ADD_SPLIT", course, at: b.cc(course, controls[0]!), kind: "FORK", branches: 2 });
    expect(JSON.stringify(old)).toBe(before);
  });

  it("lägger till start och mål på en ny bana och kontroller före målet", () => {
    const { b, course } = lineCourse(3);
    expect(codesOf(b.document, course)).toEqual(["START", "31", "32", "33", "FINISH"]);
    const extra = b.control("NORMAL", 70, 10);
    b.insert(course, extra, b.cc(course, "3"));
    expect(codesOf(b.document, course)).toEqual(["START", "31", "34", "32", "33", "FINISH"]);
    const first = b.control("NORMAL", -30, 0);
    b.insert(course, first, null);
    expect(codesOf(b.document, course)[0]).toBe("35");
  });

  it("byter start och mål i stället för att lägga till en till", () => {
    const { b, course } = lineCourse(2);
    const start2 = b.control("START", -40, 0);
    const finish2 = b.control("FINISH", 60, 0);
    b.insert(course, start2);
    b.insert(course, finish2);
    expect(courseControlOrder(b.document, course).map(id => b.document.courseControls[id]!.control)).toEqual([start2, "3", "4", finish2]);
  });

  it("tar bort en kontroll från alla banor och sträckor", () => {
    const { b, course, controls } = lineCourse(3);
    const other = b.course("B");
    b.insert(other, controls[1]!);
    b.edit({ type: "SET_LEG_BENDS", from: controls[0]!, to: controls[1]!, bends: [{ x: 10, y: 5 }] });
    b.edit({ type: "DELETE_CONTROL", control: controls[1]! });
    expect(codesOf(b.document, course)).toEqual(["START", "31", "33", "FINISH"]);
    expect(codesOf(b.document, other)).toEqual(["START", "FINISH"]);
    expect(Object.keys(b.document.legs)).toEqual([]);
    expect(b.document.controls[controls[1]!]).toBeUndefined();
  });

  it("tar bort och ändrar banor", () => {
    const { b, course } = lineCourse(2);
    const second = b.course("B");
    b.edit({ type: "UPDATE_COURSE", course: second, changes: { order: 1, climbMeters: 45, name: "Bana B" } });
    expect(b.document.courses.map(c => [c.name, c.order])).toEqual([["A", 2], ["Bana B", 1]]);
    expect(b.document.courses[1]!.climbMeters).toBe(45);
    b.edit({ type: "DELETE_COURSE", course });
    expect(b.document.courses.map(c => c.id)).toEqual([second]);
    expect(Object.values(b.document.courseControls).every(cc => !courseControlOrder(b.document, second).includes(cc.id) ? false : true)).toBe(true);
    expectError(b.document, { type: "UPDATE_COURSE", course: second, changes: { labelKind: "SCORE" } }, "INVALID");
  });

  it("kastar NOT_FOUND, IN_USE och INVALID", () => {
    const { b, course, controls, finish } = lineCourse(2);
    expectError(b.document, { type: "MOVE_CONTROL", control: "99", at: { x: 0, y: 0 } }, "NOT_FOUND");
    expectError(b.document, { type: "SET_CONTROL_CODE", control: controls[0]!, code: "32" }, "IN_USE");
    expectError(b.document, { type: "SET_CONTROL_CODE", control: controls[0]!, code: "1000" }, "INVALID");
    expectError(b.document, { type: "ADD_SPLIT", course, at: b.cc(course, finish), kind: "FORK", branches: 2 }, "INVALID");
    expectError(b.document, { type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 }, code: "40" }, "INVALID");
  });

  it("flyttar numret med kontrollen och skriver det relativt", () => {
    const { b, course, controls } = lineCourse(2);
    const cc = b.cc(course, controls[0]!);
    b.edit({ type: "MOVE_NUMBER", course, courseControl: cc, at: { x: 3.25, y: 4.5 } });
    b.edit({ type: "MOVE_CONTROL", control: controls[0]!, at: { x: 1, y: 1 } });
    expect(b.document.courseControls[cc]!.numberAt).toEqual({ x: 4.25, y: 5.5 });
    expect(writePpen(b.document)).toContain('<number-location x="3.25" y="4.5" />');
    expect(roundTrip(b.document)).toEqual(b.document);
    b.edit({ type: "MOVE_NUMBER", course, courseControl: cc, at: null });
    expect(b.document.courseControls[cc]!.numberAt).toBeUndefined();
  });

  it("skapar sträckor bara när de behövs", () => {
    const { b, controls } = lineCourse(2);
    expect(b.document.legs).toEqual({});
    b.edit({ type: "SET_LEG_BENDS", from: controls[0]!, to: controls[1]!, bends: [{ x: 10, y: 10 }] });
    b.edit({ type: "SET_LEG_GAPS", from: controls[0]!, to: controls[1]!, gaps: [{ start: 4, length: 1 }] });
    expect(Object.keys(b.document.legs)).toEqual([`${controls[0]}-${controls[1]}`]);
    expect(roundTrip(b.document)).toEqual(b.document);
    b.edit({ type: "SET_LEG_BENDS", from: controls[0]!, to: controls[1]!, bends: [] });
    b.edit({ type: "SET_LEG_GAPS", from: controls[0]!, to: controls[1]!, gaps: [] });
    expect(b.document.legs).toEqual({});
  });

  it("skriver ringavbrott som Purple Pen", () => {
    const { b, controls } = lineCourse(1);
    b.edit({ type: "SET_CIRCLE_GAPS", control: controls[0]!, gaps: [{ scale: 10000, startDegrees: 10, endDegrees: 40 }] });
    const xml = writePpen(b.document);
    expect(xml).toContain('<circle-gaps scale="10000">10:40</circle-gaps>');
    expect(xml).toContain('<gaps scale="10000">11111111111111111111111111110001</gaps>');
    expect(roundTrip(b.document)).toEqual(b.document);
    b.edit({ type: "SET_CIRCLE_GAPS", control: controls[0]!, gaps: [] });
    expect(writePpen(b.document)).not.toMatch(/<(circle-)?gaps/);
  });

  it("räknar längd med brytpunkter och respekterar inskriven längd", () => {
    const { b, course, controls } = lineCourse(2);
    // Start (-20,0) → 31 (0,0) → 32 (20,0) → mål (40,0): 60 mm i 1:10 000 = 600 m.
    expect(courseSummaries(b.document)[0]!.lengthMeters).toBeCloseTo(600, 6);
    b.edit({ type: "SET_LEG_BENDS", from: controls[0]!, to: controls[1]!, bends: [{ x: 10, y: 10 }] });
    expect(courseSummaries(b.document)[0]!.lengthMeters).toBeCloseTo(400 + 2 * Math.hypot(10, 10) * 10, 6);
    b.edit({ type: "UPDATE_COURSE", course, changes: { lengthOverrideMeters: 1234 } });
    expect(courseSummaries(b.document)[0]!.lengthMeters).toBe(1234);
    expect(courseSummaries(b.document)[0]!.controlCount).toBe(2);
  });
});

/** Gaffling vid `at` med en kontroll per gren. */
function fork(b: Builder, course: string, at: string, branchControls: string[]): void {
  b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: branchControls.length });
  const branches = b.document.courseControls[at]!.split!.branches;
  branches.forEach((branch, index) => b.insert(course, branchControls[index]!, branch));
}

describe("gafflingar och slingor", () => {
  it("två grenar ger A och B", () => {
    const { b, course, controls } = lineCourse(2);
    fork(b, course, b.cc(course, controls[0]!), [b.control("NORMAL", 10, 10), b.control("NORMAL", 10, -10)]);
    const variants = courseVariants(b.document, course);
    expect(variants.map(v => [v.code, v.controlCodes])).toEqual([["A", ["31", "33", "32"]], ["B", ["31", "34", "32"]]]);
    expect(codesOf(b.document, course, "B")).toEqual(["START", "31", "34", "32", "FINISH"]);
    expect(roundTrip(b.document)).toEqual(b.document);
  });

  it("två och tre gafflingar efter varandra fortsätter bokstäverna", () => {
    const { b, course, controls } = lineCourse(4);
    fork(b, course, b.cc(course, controls[0]!), [b.control("NORMAL", 10, 10), b.control("NORMAL", 10, -10)]);
    fork(b, course, b.cc(course, controls[1]!), [b.control("NORMAL", 30, 10), b.control("NORMAL", 30, -10)]);
    expect(courseVariants(b.document, course).map(v => v.code)).toEqual(["AC", "AD", "BC", "BD"]);
    fork(b, course, b.cc(course, controls[2]!), [b.control("NORMAL", 50, 10), b.control("NORMAL", 50, -10)]);
    const variants = courseVariants(b.document, course);
    expect(variants.map(v => v.code)).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"]);
    expect(variants.find(v => v.code === "BDF")!.controlCodes).toEqual(["31", "36", "32", "38", "33", "40", "34"]);
    const summary = courseSummaries(b.document)[0]!;
    expect(summary.lengthRangeMeters!.min).toBeLessThanOrEqual(summary.lengthRangeMeters!.max);
  });

  it("slinga med två varv ger AB och BA", () => {
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "LOOP", branches: 2 });
    const [, loop1, loop2] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 5, 15), loop1);
    b.insert(course, b.control("NORMAL", -5, 15), loop2);
    const variants = courseVariants(b.document, course);
    expect(variants.map(v => [v.code, v.controlCodes])).toEqual([
      ["AB", ["31", "33", "31", "34", "31", "32"]],
      ["BA", ["31", "34", "31", "33", "31", "32"]]
    ]);
    expect(roundTrip(b.document)).toEqual(b.document);
  });

  it("gaffling och slinga kombinerat", () => {
    const { b, course, controls } = lineCourse(3);
    fork(b, course, b.cc(course, controls[0]!), [b.control("NORMAL", 10, 10), b.control("NORMAL", 10, -10)]);
    const at = b.cc(course, controls[1]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "LOOP", branches: 2 });
    const [, loop1, loop2] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 25, 15), loop1);
    b.insert(course, b.control("NORMAL", 15, 15), loop2);
    expect(courseVariants(b.document, course).map(v => v.code)).toEqual(["ACD", "ADC", "BCD", "BDC"]);
  });

  it("tar bort en gren och hela gafflingen", () => {
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    fork(b, course, at, [b.control("NORMAL", 10, 10), b.control("NORMAL", 10, 0), b.control("NORMAL", 10, -10)]);
    expect(courseVariants(b.document, course).map(v => v.code)).toEqual(["A", "B", "C"]);
    const branchB = b.document.courseControls[at]!.split!.branches[1]!;
    b.edit({ type: "REMOVE_COURSE_CONTROL", course, courseControl: branchB });
    expect(courseVariants(b.document, course).map(v => v.controlCodes)).toEqual([["31", "33", "32"], ["31", "35", "32"]]);
    b.edit({ type: "REMOVE_SPLIT", course, at });
    expect(courseVariants(b.document, course).map(v => [v.code, v.controlCodes])).toEqual([["", ["31", "33", "32"]]]);
    expect(Object.values(b.document.courseControls).some(cc => cc.split)).toBe(false);
  });

  it("tar bort en gaffelkontroll som Purple Pen: gren A blir kvar", () => {
    const { b, course, controls } = lineCourse(2);
    fork(b, course, b.cc(course, controls[0]!), [b.control("NORMAL", 10, 10), b.control("NORMAL", 10, -10)]);
    b.edit({ type: "DELETE_CONTROL", control: controls[0]! });
    expect(codesOf(b.document, course)).toEqual(["START", "33", "32", "FINISH"]);
  });
});
