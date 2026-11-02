import { describe, expect, it } from "vitest";
import {
  applyEdit, controlsOnlyIn, CourseSettingEditError, courseControlOrder, courseVariants, createdIdsBetween, documentChanges, editTouches,
  readPpen, replayEdits, unusedControls, writePpen, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds
} from "../src";
import { Builder, lineCourse } from "./build";

/** ADR-0180 beslut 14: duplicera bana, passagens vinkel och oanvända kontroller. */
function author(document: CourseSettingDocument, edits: readonly CourseSettingEdit[]) {
  const created: CreatedIds[] = [];
  let current = document;
  for (const edit of edits) {
    const next = applyEdit(current, edit).document;
    created.push(createdIdsBetween(current, next));
    current = next;
  }
  return { document: current, created };
}

const codes = (document: CourseSettingDocument, course: string, variant?: string) =>
  courseControlOrder(document, course, variant).map(id => document.controls[document.courseControls[id]!.control]!.code ?? document.controls[document.courseControls[id]!.control]!.kind);

/** En bana med gaffling i två grenar (A: 31, B: 32) och sedan 33, ett nummer flyttat och en tryckyta. */
function forked() {
  const { b, course, controls } = lineCourse(2);
  const branchA = b.cc(course, controls[0]!);
  b.edit({ type: "ADD_SPLIT", course, at: branchA, kind: "FORK", branches: 2 });
  const branchB = b.document.courseControls[branchA]!.split!.branches[1]!;
  const x = b.control("NORMAL", 10, 10, "41");
  const y = b.control("NORMAL", 10, -10, "42");
  b.insert(course, x, branchA);
  b.insert(course, y, branchB);
  b.edit({ type: "MOVE_NUMBER", course, courseControl: branchA, at: { x: 3, y: 4 } });
  b.edit({ type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: false, rect: { minX: -30, minY: -20, maxX: 60, maxY: 20 } } });
  b.edit({ type: "UPDATE_COURSE", course, changes: { labelKind: "SEQUENCE_AND_CODE", printScale: 7500, secondaryTitle: "H21" } });
  return { b, course };
}

describe("DUPLICATE_COURSE", () => {
  it("kopierar kontrollerna i ordning, gafflingen, numret, tryckytan och inställningarna, direkt efter originalet", () => {
    const { b, course } = forked();
    const other = b.course("Sist");
    const copy = b.edit({ type: "DUPLICATE_COURSE", course, name: "A (kopia)" });
    const document = b.document;
    const original = document.courses.find(row => row.id === course)!, duplicate = document.courses.find(row => row.id === copy)!;
    expect(duplicate.name).toBe("A (kopia)");
    expect(duplicate.order).toBe(original.order + 1);
    expect(document.courses.find(row => row.id === other)!.order).toBe(original.order + 2);
    expect(duplicate).toMatchObject({ labelKind: "SEQUENCE_AND_CODE", printScale: 7500, secondaryTitle: "H21", printArea: original.printArea });
    expect(courseVariants(document, copy).map(v => v.code)).toEqual(courseVariants(document, course).map(v => v.code));
    for (const variant of ["A", "B"]) expect(codes(document, copy, variant)).toEqual(codes(document, course, variant));
    // Egna banans kontroller (inga delade med originalet), samma nummerläge.
    const mine = courseControlOrder(document, copy), theirs = new Set(courseControlOrder(document, course));
    expect(mine.some(id => theirs.has(id))).toBe(false);
    const split = mine.map(id => document.courseControls[id]!).find(item => item.split)!;
    expect(split.split!.branches.every(id => mine.includes(id))).toBe(true);
    expect(mine.map(id => document.courseControls[id]!.numberAt).filter(Boolean)).toEqual([{ x: 3, y: 4 }]);
  });

  it("banans specialobjekt syns också på kopian; objekt på alla banor rörs inte", () => {
    const { b, course } = forked();
    b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], courses: [course] } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "water", points: [{ x: 1, y: 1 }] } });
    const copy = b.edit({ type: "DUPLICATE_COURSE", course, name: "Kopia" });
    const [area, water] = b.document.specialObjects;
    expect(area!.courses).toEqual([course, copy]);
    expect(water!.courses).toEqual([]);
  });

  it("finns inte eller saknar namn: fel", () => {
    const { b, course } = forked();
    expect(() => b.edit({ type: "DUPLICATE_COURSE", course: "99", name: "X" })).toThrow(CourseSettingEditError);
    expect(() => b.edit({ type: "DUPLICATE_COURSE", course, name: " " })).toThrow(CourseSettingEditError);
  });

  it("rundresa till .ppen: kopian läses tillbaka med samma varianter", () => {
    const { b, course } = forked();
    const copy = b.edit({ type: "DUPLICATE_COURSE", course, name: "Kopia" });
    const back = readPpen(writePpen(b.document)).document;
    expect(back.courses.map(row => row.name)).toContain("Kopia");
    expect(courseVariants(back, copy).map(v => v.controlCodes)).toEqual(courseVariants(b.document, course).map(v => v.controlCodes));
  });

  it("samarbetet: kopian spelas upp på en version där någon annan lagt till en bana och följande åtgärder träffar kopian", () => {
    const { b, course } = forked();
    const base = b.document;
    const edits: CourseSettingEdit[] = [{ type: "DUPLICATE_COURSE", course, name: "Kopia" }];
    const first = author(base, edits);
    const copyId = first.created[0]!.courses[0]!;
    edits.push({ type: "UPDATE_COURSE", course: copyId, changes: { name: "Kopia 2" } });
    const local = author(base, edits);
    const current = applyEdit(base, { type: "ADD_COURSE", name: "Annan" }).document;
    const result = replayEdits(current, edits, { created: local.created, conflict: documentChanges(base, current) });
    expect(result.rejected).toEqual([]);
    const replayedCopy = result.applied[0]!.created.courses[0]!;
    expect(replayedCopy).not.toBe(copyId);
    expect(result.document.courses.find(row => row.id === replayedCopy)!.name).toBe("Kopia 2");
    expect(courseVariants(result.document, replayedCopy)).toHaveLength(2);
  });

  it("samarbetet: originalet borttaget av någon annan ger NOT_FOUND", () => {
    const { b, course } = forked();
    const base = b.document;
    const current = applyEdit(base, { type: "DELETE_COURSE", course }).document;
    const result = replayEdits(current, [{ type: "DUPLICATE_COURSE", course, name: "Kopia" }], { conflict: documentChanges(base, current) });
    expect(result.rejected.map(row => row.code)).toEqual(["NOT_FOUND"]);
  });
});

describe("SET_CONTROL_ORIENTATION", () => {
  function crossing() {
    const b = new Builder();
    const id = b.control("CROSSING_POINT", 10, 10);
    return { b, id };
  }

  it("sätter passagens vinkel i 0–360 och skrivs till .ppen", () => {
    const { b, id } = crossing();
    b.edit({ type: "SET_CONTROL_ORIENTATION", control: id, orientation: -45 });
    expect(b.document.controls[id]!.orientation).toBe(315);
    const xml = writePpen(b.document);
    expect(xml).toMatch(/<control id="\d+" kind="crossing-point" orientation="315"/);
    expect(readPpen(xml).document.controls[id]!.orientation).toBe(315);
  });

  it("bara passager kan vridas, och vinkeln måste vara ett tal", () => {
    const { b, id } = crossing();
    const normal = b.control("NORMAL", 0, 0);
    expect(() => b.edit({ type: "SET_CONTROL_ORIENTATION", control: normal, orientation: 10 })).toThrow(/Bara passager/);
    expect(() => b.edit({ type: "SET_CONTROL_ORIENTATION", control: id, orientation: Number.NaN })).toThrow(CourseSettingEditError);
  });

  it("samarbetet: samma passage vriden av någon annan ger konflikt; en ny passage hos författaren översätts", () => {
    const { b, id } = crossing();
    const base = b.document;
    expect(editTouches({ type: "SET_CONTROL_ORIENTATION", control: id, orientation: 1 })).toEqual([`control:${id}:orientation`]);
    const current = applyEdit(base, { type: "SET_CONTROL_ORIENTATION", control: id, orientation: 90 }).document;
    const conflict = replayEdits(current, [{ type: "SET_CONTROL_ORIENTATION", control: id, orientation: 30 }], { conflict: documentChanges(base, current) });
    expect(conflict.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
    // Ny passage och vridning: id översätts när någon annan hunnit lägga till en kontroll.
    const edits: CourseSettingEdit[] = [{ type: "ADD_CONTROL", kind: "CROSSING_POINT", at: { x: 1, y: 1 } }];
    const mine = author(base, edits).created[0]!.controls[0]!;
    edits.push({ type: "SET_CONTROL_ORIENTATION", control: mine, orientation: 30 });
    const local = author(base, edits);
    const other = applyEdit(base, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 } }).document;
    const replayed = replayEdits(other, edits, { created: local.created, conflict: documentChanges(base, other) });
    expect(replayed.rejected).toEqual([]);
    const fresh = replayed.applied[0]!.created.controls[0]!;
    expect(fresh).not.toBe(mine);
    expect(replayed.document.controls[fresh]!.orientation).toBe(30);
  });
});

describe("oanvända kontroller", () => {
  it("kontroller utan bana och de som bara en bana använder", () => {
    const { b, course, controls, start, finish } = lineCourse(3);
    const loose = b.control("NORMAL", 99, 99, "77");
    const other = b.course("B");
    b.insert(other, controls[1]!);
    expect(unusedControls(b.document)).toEqual([loose]);
    // B fick start och mål automatiskt (en ensam start och ett ensamt mål).
    expect(controlsOnlyIn(b.document, course)).toEqual([controls[0], controls[2]]);
    b.edit({ type: "DELETE_COURSE", course: other });
    expect(controlsOnlyIn(b.document, course)).toEqual([start, controls[0], controls[1], controls[2], finish]);
  });
});
