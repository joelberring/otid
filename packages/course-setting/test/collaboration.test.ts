import { describe, expect, it } from "vitest";
import {
  applyEdit, CourseSettingEditError, courseControlOrder, createdIdsBetween, documentChanges, editTouches, objectPatch, replayEdits,
  touchedConflict, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds
} from "../src";
import { lineCourse } from "./build";

/** Gör åtgärderna som en författare (lokalt) och ger dokumentet och id:n varje åtgärd skapade. */
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

const codes = (document: CourseSettingDocument, course: string) =>
  courseControlOrder(document, course).map(id => document.controls[document.courseControls[id]!.control]!.code ?? "-");

describe("steg 66: åtgärder som spelas upp på en nyare version", () => {
  it("två som lägger till kontroller samtidigt: id översätts så att följande åtgärder träffar rätt kontroll", () => {
    const { b, course } = lineCourse(2);
    const base = b.document;
    // A: ny kontroll (id 5 hos A), flyttar den och lägger in den på banan.
    const a = author(base, [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 100, y: 100 }, code: "33" }]);
    const aControl = a.created[0]!.controls[0]!;
    const aEdits: CourseSettingEdit[] = [
      { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 100, y: 100 }, code: "33" },
      { type: "MOVE_CONTROL", control: aControl, at: { x: 110, y: 100 } },
      { type: "INSERT_COURSE_CONTROL", course, control: aControl }
    ];
    const local = author(base, aEdits);
    // B hann först med en egen kontroll (samma id och samma kod hos B).
    const current = applyEdit(base, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: -50, y: 0 }, code: "33" }).document;
    const result = replayEdits(current, aEdits, { created: local.created, conflict: documentChanges(base, current) });
    expect(result.rejected).toEqual([]);
    const newId = result.applied[0]!.created.controls[0]!;
    expect(newId).not.toBe(aControl);
    expect(result.idMap.controls[aControl]).toBe(newId);
    // B:s kontroll är orörd, A:s fick nästa lediga kod och ligger på banan.
    expect(result.document.controls[aControl]!.at).toEqual({ x: -50, y: 0 });
    expect(result.document.controls[newId]!.at).toEqual({ x: 110, y: 100 });
    expect(result.document.controls[newId]!.code).toBe("34");
    expect(codes(result.document, course)).toEqual(["-", "31", "32", "34", "-"]);
  });

  it("samma kontroll flyttad av två: den första vinner, den andra får besked; olika kontroller står båda kvar", () => {
    const { b, controls } = lineCourse(3);
    const base = b.document;
    const current = applyEdit(base, { type: "MOVE_CONTROL", control: controls[0]!, at: { x: 1, y: 1 } }).document;
    const mine: CourseSettingEdit[] = [
      { type: "MOVE_CONTROL", control: controls[0]!, at: { x: 2, y: 2 } },
      { type: "MOVE_CONTROL", control: controls[1]!, at: { x: 3, y: 3 } }
    ];
    const result = replayEdits(current, mine, { conflict: documentChanges(base, current) });
    expect(result.rejected.map(row => [row.index, row.code])).toEqual([[0, "CONFLICT"]]);
    expect(result.document.controls[controls[0]!]!.at).toEqual({ x: 1, y: 1 });
    expect(result.document.controls[controls[1]!]!.at).toEqual({ x: 3, y: 3 });
    // Utan andras ändring (samma version) är det ingen konflikt.
    expect(replayEdits(base, mine, { conflict: documentChanges(base, base) }).rejected).toEqual([]);
  });

  it("en borttagen kontroll: åtgärden avvisas och det som byggde på den också", () => {
    const { b, controls, course } = lineCourse(2);
    const base = b.document;
    const current = applyEdit(base, { type: "DELETE_CONTROL", control: controls[1]! }).document;
    const edits: CourseSettingEdit[] = [
      { type: "SET_CONTROL_CODE", control: controls[1]!, code: "50" },
      { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 }, code: "60" }
    ];
    const local = author(base, edits);
    const added = local.created[1]!.controls[0]!;
    const all = [...edits, { type: "SET_LEG_BENDS", from: controls[1]!, to: added, bends: [{ x: 1, y: 1 }] } as CourseSettingEdit,
      { type: "INSERT_COURSE_CONTROL", course, control: added } as CourseSettingEdit];
    const result = replayEdits(current, all, { created: [...local.created, undefined, undefined] });
    expect(result.rejected.map(row => [row.index, row.code])).toEqual([[0, "NOT_FOUND"], [2, "NOT_FOUND"]]);
    expect(result.applied.map(row => row.index)).toEqual([1, 3]);
  });

  it("ett förslag godkänt delvis: det som bygger på en åtgärd som inte godkändes görs inte", () => {
    const { b } = lineCourse(2);
    const base = b.document;
    const edits: CourseSettingEdit[] = [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 }, code: "70" }];
    const first = author(base, edits);
    const id = first.created[0]!.controls[0]!;
    edits.push({ type: "MOVE_CONTROL", control: id, at: { x: 6, y: 6 } }, { type: "SET_EVENT", changes: { title: "Ny" } });
    const local = author(base, edits);
    // Någon annan har lagt till en kontroll med samma id: flytten får inte träffa den.
    const current = applyEdit(base, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 9, y: 9 } }).document;
    const result = replayEdits(current, edits, { created: local.created, skip: new Set([0]) });
    expect(result.rejected.map(row => [row.index, row.code])).toEqual([[1, "DEPENDS"]]);
    expect(result.document.controls[id]!.at).toEqual({ x: 9, y: 9 });
    expect(result.document.event.title).toBe("Ny");
  });

  it("ångra med objectPatch sätter bara tillbaka det som steget ändrade", () => {
    const { b, controls, course } = lineCourse(3);
    const before = b.document;
    const after = applyEdit(before, { type: "REMOVE_COURSE_CONTROL", course, courseControl: b.cc(course, controls[1]!) }).document;
    const undo = objectPatch(after, before)!;
    expect(undo.type).toBe("PUT_OBJECTS");
    expect(editTouches(undo).every(touch => touch.startsWith("courseControl:"))).toBe(true);
    // Någon annan flyttar en kontroll; ångra behåller flytten.
    const remote = applyEdit(after, { type: "MOVE_CONTROL", control: controls[2]!, at: { x: 7, y: 7 } }).document;
    const undone = applyEdit(remote, undo).document;
    expect(codes(undone, course)).toEqual(codes(before, course));
    expect(undone.controls[controls[2]!]!.at).toEqual({ x: 7, y: 7 });
    expect(objectPatch(before, before)).toBeUndefined();
  });

  it("PUT_OBJECTS som pekar på något borttaget avvisas", () => {
    const { b, controls, course } = lineCourse(2);
    const before = b.document;
    const after = applyEdit(before, { type: "REMOVE_COURSE_CONTROL", course, courseControl: b.cc(course, controls[0]!) }).document;
    const undo = objectPatch(after, before)!;
    const gone = applyEdit(after, { type: "DELETE_CONTROL", control: controls[0]! }).document;
    expect(() => applyEdit(gone, undo)).toThrow(CourseSettingEditError);
  });

  it("serverns logg: en annan version som ändrade samma sak, eller hela dokumentet", () => {
    const conflict = touchedConflict(["control:3:at", "course:1"]);
    expect(conflict("control:3:at", "control:3:at")).toBe(true);
    expect(conflict("control:4:at", "control:4:at")).toBe(false);
    expect(conflict("course:1:name", "course:1:name")).toBe(true);
    expect(touchedConflict("ALL")("event:title", "event:title")).toBe(true);
    expect(touchedConflict([])("control:3", "control:3")).toBe(false);
  });
});
