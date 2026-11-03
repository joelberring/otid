import { describe, expect, it } from "vitest";
import { applyEdit, type CourseSettingDocument } from "@o-tid/course-setting";
import { applySteps, createEditor, redo, undo } from "./course-setting-editor";
import { formOf, moveCourseEdit, orderedCourses, parseMeters, parsePoints, propertyChanges, scoreTotal } from "./course-setting-properties";
import { describeEdit } from "./course-setting-suggestion";
import { testDocument } from "./course-setting-test-document";

/** Testdokumentet med två banor till (Mellan, Kort). */
function threeCourses(): CourseSettingDocument {
  let document = testDocument();
  document = applyEdit(document, { type: "ADD_COURSE", name: "Mellan" }).document;
  document = applyEdit(document, { type: "ADD_COURSE", name: "Kort" }).document;
  return document;
}
const names = (document: CourseSettingDocument) => orderedCourses(document).map(course => course.name);

describe("ADR-0190: banans egenskaper i editorn", () => {
  it("formuläret ger bara det som ändrats; tomt tar bort", () => {
    const course = { ...testDocument().courses[0]!, climbMeters: 40 };
    expect(propertyChanges(course, formOf(course))).toEqual({ changes: undefined });
    expect(propertyChanges(course, { ...formOf(course), climb: "85 m" })).toEqual({ changes: { climbMeters: 85 } });
    expect(propertyChanges(course, { ...formOf(course), climb: "", length: "4 300" })).toEqual({ changes: { climbMeters: null, lengthOverrideMeters: 4300 } });
    expect(propertyChanges(course, { ...formOf(course), kind: "SCORE" })).toEqual({ changes: { kind: "SCORE" } });
    expect(propertyChanges(course, { ...formOf(course), climb: "-3" })).toEqual({ error: "climb" });
    expect(propertyChanges(course, { ...formOf(course), length: "0" })).toEqual({ error: "length" });
    expect(parseMeters("12,5", 0, 10)).toBeUndefined();
    expect(parsePoints("")).toBeNull();
    expect(parsePoints("0")).toBeNull();
    expect(parsePoints("30")).toBe(30);
    expect(parsePoints("3.5")).toBeUndefined();
  });

  it("flytta upp och ned: en åtgärd, ett ångra-steg som bara rör ordningen", () => {
    const start = createEditor(threeCourses());
    const kort = start.document.courses.find(course => course.name === "Kort")!.id;
    expect(moveCourseEdit(start.document, kort, 3)).toBeUndefined();
    const moved = applySteps(start, [moveCourseEdit(start.document, kort, 1)!], applyEdit);
    expect(names(moved.document)).toEqual(["Kort", "Lång", "Mellan"]);
    expect(moved.past.at(-1)!.undo!.courseOrder).toBeDefined();
    expect(moved.past.at(-1)!.undo!.courses).toBeUndefined();
    const back = undo(moved);
    expect(names(back.document)).toEqual(["Lång", "Mellan", "Kort"]);
    const undone = back.log.at(-1)!.edit;
    expect(undone.type === "PUT_OBJECTS" && undone.courseOrder !== undefined && undone.courses === undefined).toBe(true);
    expect(names(redo(back).document)).toEqual(["Kort", "Lång", "Mellan"]);
  });

  it("stigning, fast längd och poängbana ångras och görs om", () => {
    let state = createEditor(testDocument());
    state = applySteps(state, [{ type: "UPDATE_COURSE", course: "k", changes: { climbMeters: 85, lengthOverrideMeters: 4300, kind: "SCORE" } }], applyEdit);
    state = applySteps(state, [{ type: "SET_POINTS", course: "k", courseControl: "c2", points: 20 }], applyEdit);
    // Kontrollen utan satta poäng räknas med kodens tiotal (som tävlingens rogaining): 20 + 3.
    expect(scoreTotal(state.document, ["c1", "c2", "c3", "c4"])).toEqual({ points: 23, controls: 2 });
    state = undo(undo(state));
    expect(state.document.courses[0]).toMatchObject({ kind: "NORMAL", labelKind: "SEQUENCE" });
    expect(state.document.courses[0]!.climbMeters).toBeUndefined();
    expect(state.document.courseControls.c2!.points).toBeUndefined();
    state = redo(redo(state));
    expect(state.document.courses[0]).toMatchObject({ kind: "SCORE", climbMeters: 85, lengthOverrideMeters: 4300 });
    expect(state.document.courseControls.c2!.points).toBe(20);
  });

  it("förslagens och beskedens text", () => {
    const document = testDocument();
    expect(describeEdit({ type: "UPDATE_COURSE", course: "k", changes: { climbMeters: 85 } }, document)).toBe("Stigning 85 m på Lång");
    expect(describeEdit({ type: "UPDATE_COURSE", course: "k", changes: { climbMeters: null, lengthOverrideMeters: null } }, document))
      .toBe("Ingen stigning, uträknad längd på Lång");
    expect(describeEdit({ type: "UPDATE_COURSE", course: "k", changes: { kind: "SCORE" } }, document)).toBe("Poängbana på Lång");
    expect(describeEdit({ type: "UPDATE_COURSE", course: "k", changes: { order: 2 } }, document)).toBe("Plats 2 i listan på Lång");
    expect(describeEdit({ type: "SET_POINTS", course: "k", courseControl: "c2", points: 30 }, document)).toBe("30 poäng för kontroll 31 på Lång");
  });
});
