import { describe, expect, it } from "vitest";
import { applyEdit, courseControlOrder, emptyDocument, variations, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { applySteps, beginDrag, cancelDrag, canUndo, createEditor, dragTo, redo, setView, undo } from "./course-setting-editor";
import { ALL_CONTROLS } from "./course-setting-hit";
import {
  courseNameList, metersBetween, newControlEdit, occurrencesToReplace, readMoveThreshold, readRememberedChoice, sharedMoveQuestion,
  writeMoveThreshold, writeRememberedChoice
} from "./course-setting-move-shared";

/** Kartan i 1:10 000 (1 mm = 10 m); banorna A och B har 31, C har bara 35. */
function build() {
  let document = emptyDocument({ title: "Test", mapScale: 10000, sprint: false });
  const run = (edit: CourseSettingEdit) => { const result = applyEdit(document, edit); document = result.document; return result.created ?? ""; };
  run({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } });
  run({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 100, y: 0 } });
  const c31 = run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 0 }, code: "31" });
  const c35 = run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "35" });
  const a = run({ type: "ADD_COURSE", name: "A" }), b = run({ type: "ADD_COURSE", name: "B" }), c = run({ type: "ADD_COURSE", name: "C" });
  run({ type: "INSERT_COURSE_CONTROL", course: a, control: c31 });
  run({ type: "INSERT_COURSE_CONTROL", course: b, control: c31 });
  run({ type: "INSERT_COURSE_CONTROL", course: c, control: c35 });
  return { document, c31, c35, a, b, c, run: (edit: CourseSettingEdit) => { run(edit); return document; } };
}

const codes = (document: CourseSettingDocument, course: string) =>
  courseControlOrder(document, course).map(id => document.controls[document.courseControls[id]!.control]!.code ?? "·");

function memory(): Storage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: key => void values.delete(key),
    clear: () => values.clear(), key: () => null, get length() { return values.size; } };
}

describe("frågan när en delad kontroll flyttas långt", () => {
  it("frågar i en bana över gränsen när kontrollen finns i en annan bana", () => {
    const { document, c31, a } = build();
    const from = document.controls[c31]!.at;
    expect(metersBetween(document, from, { x: 55, y: 0 })).toBe(50);
    const question = sharedMoveQuestion(document, { view: a, control: c31, from, at: { x: 56, y: 0 }, thresholdM: 50 })!;
    expect(question).toMatchObject({ code: "31", courseName: "A", otherCourses: ["B"], occurrences: 1, newCode: "32" });
    expect(Math.round(question.meters)).toBe(60);
  });

  it("frågar inte: liten flytt, Alla kontroller, bara i den här banan, start", () => {
    const { document, c31, c35, a, c } = build();
    const from = document.controls[c31]!.at;
    expect(sharedMoveQuestion(document, { view: a, control: c31, from, at: { x: 54, y: 0 }, thresholdM: 50 })).toBeUndefined();
    expect(sharedMoveQuestion(document, { view: a, control: c31, from, at: { x: 55.02, y: 0 }, thresholdM: 50 })).toBeUndefined();
    expect(sharedMoveQuestion(document, { view: ALL_CONTROLS, control: c31, from, at: { x: 90, y: 0 }, thresholdM: 50 })).toBeUndefined();
    expect(sharedMoveQuestion(document, { view: c, control: c35, from: document.controls[c35]!.at, at: { x: 90, y: 90 }, thresholdM: 50 })).toBeUndefined();
    const start = Object.values(document.controls).find(control => control.kind === "START")!;
    expect(sharedMoveQuestion(document, { view: a, control: start.id, from: start.at, at: { x: 0, y: 90 }, thresholdM: 50 })).toBeUndefined();
  });

  it("valet Ny kontroll är ett steg: ångra och gör om", () => {
    const { document, c31, a, b } = build();
    let state = setView(createEditor(document), a);
    const from = document.controls[c31]!.at;
    // Dragningen står på det nya läget medan frågan visas; valet avbryter den och gör den nya kontrollen.
    state = dragTo(beginDrag(state), { type: "MOVE_CONTROL", control: c31, at: { x: 50, y: 20 } }, applyEdit);
    const question = sharedMoveQuestion(state.dragBase!, { view: a, control: c31, from, at: { x: 50, y: 20 }, thresholdM: 50 })!;
    state = applySteps(cancelDrag(state), [newControlEdit(question)], applyEdit);
    expect(state.past).toHaveLength(1);
    expect(state.log).toHaveLength(1);
    expect(codes(state.document, a)).toEqual(["·", "32", "·"]);
    expect(codes(state.document, b)).toEqual(["·", "31", "·"]);
    expect(state.document.controls[c31]!.at).toEqual(from);
    expect(canUndo(state)).toBe(true);
    state = undo(state);
    expect(codes(state.document, a)).toEqual(["·", "31", "·"]);
    expect(Object.values(state.document.controls).some(control => control.code === "32")).toBe(false);
    state = redo(state);
    expect(codes(state.document, a)).toEqual(["·", "32", "·"]);
  });

  it("fjäril: alla förekomster i samma ring byts; i en variant bara den som syns", () => {
    const { c31, a, run } = build();
    const spoke = run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 30 }, code: "36" });
    const spokeId = Object.values(spoke.controls).find(control => control.code === "36")!.id;
    run({ type: "INSERT_COURSE_CONTROL", course: a, control: spokeId });
    const document = run({ type: "INSERT_COURSE_CONTROL", course: a, control: c31 });
    const all = courseControlOrder(document, a).filter(id => document.courseControls[id]!.control === c31);
    expect(occurrencesToReplace(document, a, c31, all[1])).toEqual(all);
    expect(sharedMoveQuestion(document, { view: a, control: c31, from: { x: 50, y: 0 }, at: { x: 50, y: -20 }, courseControl: all[0], thresholdM: 50 })!
      .occurrences).toBe(2);
    // Gaffling där 31 finns i båda grenarna: i variant A byts bara grenen A.
    const fork = build();
    const x = fork.run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 30, y: 0 }, code: "37" });
    const c37 = Object.values(x.controls).find(control => control.code === "37")!.id;
    let doc = fork.run({ type: "INSERT_COURSE_CONTROL", course: fork.c, control: c37 });
    const at = courseControlOrder(doc, fork.c).find(id => doc.courseControls[id]!.control === c37)!;
    doc = fork.run({ type: "ADD_SPLIT", course: fork.c, at, kind: "FORK", branches: 2 });
    const [branchA, branchB] = doc.courseControls[at]!.split!.branches;
    doc = fork.run({ type: "INSERT_COURSE_CONTROL", course: fork.c, control: fork.c31, after: branchA });
    doc = fork.run({ type: "INSERT_COURSE_CONTROL", course: fork.c, control: fork.c31, after: branchB });
    const in31 = courseControlOrder(doc, fork.c).filter(id => doc.courseControls[id]!.control === fork.c31);
    expect(in31).toHaveLength(2);
    expect(occurrencesToReplace(doc, fork.c, fork.c31, in31[0])).toEqual(in31);
    const variantOf = (id: string) => variations(doc, fork.c).map(row => row.code).find(code => {
      const order = courseControlOrder(doc, fork.c, code);
      return order.includes(id) && !order.includes(in31.find(other => other !== id)!);
    });
    const variant = variantOf(in31[0]!);
    expect(variant).toBeDefined();
    expect(occurrencesToReplace(doc, fork.c, fork.c31, in31[0], variant)).toEqual([in31[0]]);
  });

  it("banornas namn förkortas och inställningarna läses tåligt", () => {
    expect(courseNameList(["B"])).toBe("B");
    expect(courseNameList(["B", "C"])).toBe("B och C");
    expect(courseNameList(["B", "C", "D", "E", "F", "G"], 4)).toBe("B, C, D och 3 till");
    const storage = memory();
    expect(readMoveThreshold(storage)).toBe(50);
    writeMoveThreshold(storage, 20);
    expect(readMoveThreshold(storage)).toBe(20);
    expect(readMoveThreshold(undefined)).toBe(50);
    expect(readRememberedChoice(storage, "r1")).toBeUndefined();
    writeRememberedChoice(storage, "r1", "NEW");
    expect(readRememberedChoice(storage, "r1")).toBe("NEW");
    expect(readRememberedChoice(storage, "r2")).toBeUndefined();
    writeRememberedChoice(storage, "r1", undefined);
    expect(readRememberedChoice(storage, "r1")).toBeUndefined();
    const broken = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readMoveThreshold(broken)).toBe(50);
    expect(readRememberedChoice(broken, "r1")).toBeUndefined();
  });
});
