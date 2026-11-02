import { describe, expect, it } from "vitest";
import {
  applyEdit, courseControlOrder, courseVariants, createdIdsBetween, diffTouches, documentChanges, editTouches, objectPatch, replayEdits,
  touchedConflict, type CourseSettingDocument, type CourseSettingEdit
} from "../src";
import { lineCourse } from "./build";

/** Översynen 2026-11-02: det som en åtgärd faktiskt ändrar (strukturen också) och ångra per fält för händelsen. */
function forked() {
  const { b, course, controls } = lineCourse(2);
  const branchA = b.cc(course, controls[0]!);
  b.edit({ type: "ADD_SPLIT", course, at: branchA, kind: "FORK", branches: 2 });
  const branchB = b.document.courseControls[branchA]!.split!.branches[1]!;
  return { b, course, branchA, branchB };
}

/** Servern: åtgärderna sparas i ordning; touches per version som tjänsten lagrar dem. */
function save(document: CourseSettingDocument, edits: readonly CourseSettingEdit[], touched?: readonly string[]) {
  const result = replayEdits(document, edits, { conflict: touched ? touchedConflict(touched) : undefined });
  return { result, touches: result.applied.flatMap(row => row.touches) };
}

const inCourse = (document: CourseSettingDocument, course: string, control: string) =>
  courseVariants(document, course).some(variant => courseControlOrder(document, course, variant.code)
    .some(id => document.courseControls[id]!.control === control));

describe("diffTouches", () => {
  it("ger banornas struktur fält för fält och nya eller borttagna objekt hela", () => {
    const { b, course } = forked();
    const before = b.document;
    const control = Object.keys(before.controls).find(id => before.controls[id]!.kind === "NORMAL")!;
    const after = applyEdit(before, { type: "INSERT_COURSE_CONTROL", course, control }).document;
    const created = createdIdsBetween(before, after);
    const touches = diffTouches(before, after);
    expect(touches).toContain(`courseControl:${created.courseControls[0]}`);
    expect(touches.some(touch => /^courseControl:[^:]+:next$/.test(touch))).toBe(true);
    // Det som åtgärden själv skapade räknas inte när id:t kan återanvändas.
    expect(diffTouches(before, after, created)).not.toContain(`courseControl:${created.courseControls[0]}`);
    expect(editTouches({ type: "INSERT_COURSE_CONTROL", course, control })).toEqual([]);
  });

  it("två samtidigt: gaffling tas bort medan någon lägger in en kontroll i grenen – den andra får besked, inget försvinner tyst", () => {
    const { b, course, branchA, branchB } = forked();
    const base = b.document;
    const z = applyEdit(base, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 30 }, code: "55" });
    const zId = z.created!;
    const anna: CourseSettingEdit[] = [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 30 }, code: "55" },
      { type: "INSERT_COURSE_CONTROL", course, control: zId, after: branchB }];
    const bo: CourseSettingEdit[] = [{ type: "REMOVE_SPLIT", course, at: branchA }];

    const first = save(base, anna);
    expect(first.result.rejected).toEqual([]);
    expect(inCourse(first.result.document, course, zId)).toBe(true);

    // Före översynen: bara åtgärdernas egna touches (strukturen har inga) – Bos borttagning gick igenom och Z försvann.
    const old = replayEdits(first.result.document, bo, { conflict: touchedConflict(first.result.applied.flatMap(row => editTouches(row.edit))) });
    expect(old.rejected).toEqual([]);
    expect(inCourse(old.document, course, zId)).toBe(false);

    // Nu: serverns touches ur skillnaden – Bo får besked och Z finns kvar.
    const second = save(first.result.document, bo, first.touches);
    expect(second.result.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
    expect(inCourse(second.result.document, course, zId)).toBe(true);

    // Samma sak i webbläsaren (uppspelning mot författarens version).
    const rebased = replayEdits(first.result.document, bo, { conflict: documentChanges(base, first.result.document) });
    expect(rebased.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
  });

  it("två som lägger in kontroller på olika ställen i banan krockar inte", () => {
    const { b, course, branchA } = forked();
    const base = b.document;
    const finishCc = courseControlOrder(base, course, courseVariants(base, course)[0]!.code).at(-1)!;
    const beforeFinish = Object.values(base.courseControls).find(row => row.next === finishCc)!.id;
    const edits = (x: number, after: string): CourseSettingEdit[] => {
      const control = applyEdit(base, { type: "ADD_CONTROL", kind: "NORMAL", at: { x, y: 40 } }).created!;
      return [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x, y: 40 } }, { type: "INSERT_COURSE_CONTROL", course, control, after }];
    };
    const first = save(base, edits(1, branchA));
    const bo = edits(2, beforeFinish);
    const created = [createdIdsBetween(base, applyEdit(base, bo[0]!).document),
      createdIdsBetween(applyEdit(base, bo[0]!).document, applyEdit(applyEdit(base, bo[0]!).document, bo[1]!).document)];
    const second = replayEdits(first.result.document, bo, { conflict: touchedConflict(first.touches), created });
    expect(second.rejected).toEqual([]);
    expect(second.applied).toHaveLength(2);
  });
});

describe("ångra per fält för händelsen", () => {
  it("ångra av titeln rör inte någon annans språk eller utskriftsprofil", () => {
    const { b } = lineCourse(1);
    const base = b.document;
    const mine = applyEdit(base, { type: "SET_EVENT", changes: { title: "Ny titel" } }).document;
    const undo = objectPatch(mine, base)!;
    expect(undo.event).toBeUndefined();
    expect(Object.keys(undo.eventFields ?? {})).toEqual(["title"]);
    expect(editTouches(undo)).toEqual(["event:title"]);
    // Någon annan ändrar språket och väljer profil under tiden.
    const theirs = applyEdit(mine, { type: "SET_EVENT", changes: { descriptionLanguage: "en", printProfileId: "kontor" } }).document;
    const replay = replayEdits(theirs, [undo], { conflict: documentChanges(mine, theirs) });
    expect(replay.rejected).toEqual([]);
    expect(replay.document.event.title).toBe(base.event.title);
    expect(replay.document.event.descriptionLanguage).toBe("en");
    expect(replay.document.event.printProfileId).toBe("kontor");
  });

  it("ett fält som inte fanns tas bort när det ångras; en titel som någon annan hunnit ändra krockar", () => {
    const { b } = lineCourse(1);
    const base = b.document;
    const mine = applyEdit(base, { type: "SET_EVENT", changes: { printProfileId: "kontor" } }).document;
    const undo = objectPatch(mine, base)!;
    expect(undo.eventFields).toEqual({ printProfileId: null });
    expect(applyEdit(mine, undo).document.event.printProfileId).toBeUndefined();
    const titled = objectPatch(applyEdit(base, { type: "SET_EVENT", changes: { title: "A" } }).document, base)!;
    const theirs = applyEdit(base, { type: "SET_EVENT", changes: { title: "B" } }).document;
    const replay = replayEdits(theirs, [titled], { conflict: documentChanges(applyEdit(base, { type: "SET_EVENT", changes: { title: "A" } }).document, theirs) });
    expect(replay.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
  });

  it("en äldre ångra med hela händelsen gäller fortfarande", () => {
    const { b } = lineCourse(1);
    const base = b.document;
    const changed = applyEdit(base, { type: "SET_EVENT", changes: { title: "X" } }).document;
    expect(applyEdit(changed, { type: "PUT_OBJECTS", event: base.event }).document.event).toEqual(base.event);
  });
});
