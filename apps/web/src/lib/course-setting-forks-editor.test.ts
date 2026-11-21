import { describe, expect, it } from "vitest";
import { applyEdit, checkDocument, courseVariants, emptyDocument, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import {
  addPoint, addSplit, finishBranch, insertExisting, LEG_IN_SEVERAL_BRANCHES, legPlace, removeSelected, removeSplit, select, selectedForkStart,
  selectedLegAmbiguous, setView, splitPlace, workInBranch, type EditorState
} from "./course-setting-editor";
import { ghostPrimitives, placesOnCourse, snapAt, snapCandidates, controlsInCourse } from "./course-setting-snap";
import { allBranches, courseTree } from "./course-setting-forks";

/**
 * Steg G1 (ägaren 2026-11-21, översynen av gafflingarna A1–A6): editorns arbetsflöde runt grenarna. Grunden S-31-32-33-F,
 * gaffel vid 31 med 41/42 (A, B); i scenarierna görs gaffeln vid 32 (C, D) med editorns egna funktioner.
 */
function build() {
  let document = emptyDocument({ title: "Test", mapScale: 10000, sprint: false });
  const run = (edit: CourseSettingEdit) => { const result = applyEdit(document, edit); document = result.document; return result.created ?? ""; };
  const control = (code: string, x: number, y: number) => run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x, y }, code });
  run({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } });
  run({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 100, y: 0 } });
  const ids = { c31: control("31", 20, 0), c32: control("32", 40, 0), c33: control("33", 60, 0), c41: control("41", 30, 10), c42: control("42", 30, -10),
    c43: control("43", 50, 10), c44: control("44", 50, -10), c45: control("45", 30, -20) };
  const course = run({ type: "ADD_COURSE", name: "SBN" });
  for (const id of [ids.c31, ids.c32, ids.c33]) run({ type: "INSERT_COURSE_CONTROL", course, control: id });
  const cc = (id: string) => Object.values(document.courseControls).find(item => item.control === id)!.id;
  const at31 = cc(ids.c31);
  run({ type: "ADD_SPLIT", course, at: at31, kind: "FORK", branches: 2 });
  const [a, b] = document.courseControls[at31]!.split!.branches as [string, string];
  run({ type: "INSERT_COURSE_CONTROL", course, control: ids.c41, after: a });
  run({ type: "INSERT_COURSE_CONTROL", course, control: ids.c42, after: b });
  return { document, course, ids, at31, a, b, at32: cc(ids.c32), at33: cc(ids.c33) };
}

const variantsOf = (document: CourseSettingDocument, course: string) => courseVariants(document, course).map(v => `${v.code}:${v.controlCodes.join("-")}`);
const codes = ["99", "98", "97", "96"];
const nextCode = (document: CourseSettingDocument) => codes.find(code => !Object.values(document.controls).some(item => item.code === code))!;
const selectCc = (state: EditorState, courseControl: string) =>
  select(state, { kind: "control", control: state.document.courseControls[courseControl]!.control, courseControl });

/** Gaffel vid 32 med editorn: 43 i gren C, 44 i gren D (editorn står i gren D efteråt). */
function forkAt32() {
  const built = build();
  let state = selectCc(setView(createState(built.document), built.course), built.at32);
  state = addSplit(state, "FORK", 2, applyEdit);
  const [c, d] = state.document.courseControls[built.at32]!.split!.branches as [string, string];
  expect(state.branch).toBe(c);
  state = insertExisting(state, built.ids.c43, applyEdit);
  state = workInBranch(state, d);
  state = insertExisting(state, built.ids.c44, applyEdit);
  return { ...built, state, c, d };
}

function createState(document: CourseSettingDocument): EditorState {
  return { document, past: [], future: [], log: [], nextSeq: 1, view: "ALL_CONTROLS", tool: "SELECT", revision: 0 };
}

describe("G1 A2: Klar fortsätter efter mötespunkten", () => {
  it("efter Klar läggs nästa kontroll efter 33, inte i gren D (förut AD:…-44-99-33)", () => {
    const { state, course, d, at33 } = forkAt32();
    expect(state.branch).toBe(d);
    const done = finishBranch(state);
    expect(done.branch).toBeUndefined();
    expect(done.selection).toEqual({ kind: "control", control: state.document.courseControls[at33]!.control, courseControl: at33 });
    const next = addPoint(done, "ADD_CONTROL", { x: 80, y: 0 }, applyEdit, nextCode);
    expect(variantsOf(next.document, course)).toEqual(["AC:31-41-32-43-33-99", "AD:31-41-32-44-33-99", "BC:31-42-32-43-33-99", "BD:31-42-32-44-33-99"]);
  });

  it("en slinga: gaffelkontrollen i följden blir vald; en gaffling i en gren: man arbetar sedan i den yttre grenen", () => {
    const built = build();
    let state = selectCc(setView(createState(built.document), built.course), built.at32);
    state = addSplit(state, "LOOP", 2, applyEdit);
    expect(finishBranch(state).selection).toMatchObject({ courseControl: built.at32 });
    // Gaffling vid 41 i gren A: Klar väljer 32 (där den inre möts) och man står kvar i ... ingen gren (32 är den yttres mötespunkt).
    let inner = selectCc(setView(createState(built.document), built.course), built.document.courseControls[built.a]!.next!);
    inner = addSplit(inner, "FORK", 2, applyEdit);
    const finished = finishBranch(inner);
    expect(finished.selection).toMatchObject({ courseControl: built.at32 });
    expect(finished.branch).toBeUndefined();
  });

  it("utan gren gör Klar ingenting mer än att lämna grenraden", () => {
    const { document, course } = build();
    const state = setView(createState(document), course);
    expect(finishBranch(state)).toMatchObject({ branch: undefined, selection: undefined });
  });
});

describe("G1 A3: efter Ta bort står man kvar i grenen", () => {
  it("42 bort ur gren B och sedan 45: 45 hamnar i gren B, inte före målet (förut B:S-31-32-33-45-F)", () => {
    const { document, course, ids, b } = build();
    let state = workInBranch(setView(createState(document), course), b, document.courseControls[b]!.next);
    expect(state.selection).toMatchObject({ control: ids.c42 });
    state = removeSelected(state, applyEdit);
    expect(state.selection).toEqual({ kind: "control", control: ids.c31, courseControl: b });
    state = insertExisting(state, ids.c45, applyEdit);
    expect(variantsOf(state.document, course)).toEqual(["A:31-41-32-33", "B:31-45-32-33"]);
  });

  it("utan markering i en gren läggs nya kontroller efter grenens sista kontroll", () => {
    const { document, course, ids, b } = build();
    let state = select(workInBranch(setView(createState(document), course), b), undefined);
    state = insertExisting(state, ids.c45, applyEdit);
    expect(variantsOf(state.document, course)).toEqual(["A:31-41-32-33", "B:31-42-45-32-33"]);
    // Utan gren: före målet som förut.
    state = select({ ...state, branch: undefined }, undefined);
    state = insertExisting(state, ids.c44, applyEdit);
    expect(variantsOf(state.document, course)).toEqual(["A:31-41-32-33-44", "B:31-42-45-32-33-44"]);
  });

  it("en borttagen gren lämnar grenraden; kontrollen före i grundföljden blir vald", () => {
    const { document, course, ids, b, at31 } = build();
    let state = selectCc(workInBranch(setView(createState(document), course), b), b);
    state = removeSelected(state, applyEdit);
    expect(state.branch).toBeUndefined();
    expect(state.document.courseControls[at31]!.split).toBeUndefined();
    expect(state.selection).toMatchObject({ control: ids.c31, courseControl: at31 });
    // En vanlig kontroll i grundföljden: kontrollen före.
    state = removeSelected(selectCc(state, Object.values(state.document.courseControls).find(item => item.control === ids.c33)!.id), applyEdit);
    expect(state.selection).toMatchObject({ control: ids.c32 });
  });
});

describe("G1 A1: kontroller som redan finns på banan går att lägga in", () => {
  it("43 (i gren C) är kandidat och spöke, med var den finns; start och mål som förut", () => {
    const { state, course, ids } = forkAt32();
    const { document } = state;
    const candidates = snapCandidates(document, course, "NORMAL");
    expect(candidates).toEqual(expect.arrayContaining([ids.c43, ids.c31, ids.c45]));
    const start = Object.values(document.controls).find(item => item.kind === "START")!.id;
    expect(snapCandidates(document, course, "START")).not.toContain(start);
    expect(snapCandidates(document, course, "ANY")).not.toContain(start);
    expect(snapCandidates(document, course, "ANY")).toContain(ids.c43);
    const ghosts = ghostPrimitives(document, course, candidates);
    const plain = ghosts.find(item => item.ref === ids.c45);
    expect(plain && plain.kind !== "image" ? plain.fade : "saknas").toBeUndefined();
    const again = ghosts.filter(item => item.ref === ids.c43);
    expect(again.length).toBeGreaterThan(0);
    expect(again.every(item => item.kind !== "image" && item.fade === 0.5 && item.role !== "NUMBER")).toBe(true);
    const snap = snapAt(document, candidates, document.controls[ids.c43]!.at, 3, 1, controlsInCourse(document, course));
    expect(snap).toMatchObject({ control: ids.c43, onCourse: true });
    expect(placesOnCourse(document, course, ids.c43)).toEqual(["C"]);
    expect(placesOnCourse(document, course, ids.c32)).toEqual([""]);
    expect(placesOnCourse(document, course, ids.c45)).toEqual([]);
  });

  it("Kontroll-verktyget som snäpper på 43 lägger in den i gren D (ingen ny kontroll med ny kod)", () => {
    const { state, course, ids } = forkAt32();
    const before = Object.keys(state.document.controls).length;
    const next = addPoint(state, "ADD_CONTROL", state.document.controls[ids.c43]!.at, applyEdit, nextCode, ids.c43);
    expect(Object.keys(next.document.controls)).toHaveLength(before);
    expect(variantsOf(next.document, course)).toContain("AD:31-41-32-44-43-33");
    // Två gånger i rad varnas (per variant).
    const twice = insertExisting(next, ids.c43, applyEdit);
    expect(checkDocument(twice.document).some(check => check.kind === "SAME_CONTROL_TWICE_IN_ROW" && check.control === ids.c43)).toBe(true);
  });
});

describe("G1 A4–A5: gafflingen och gaffelkontrollen", () => {
  it("Ta bort gafflingen med gren D:s kopia vald: gren C blir kvar och dess gaffelkontroll blir vald", () => {
    const { state, course, at32, d } = forkAt32();
    const removed = removeSplit(selectCc(state, d), applyEdit);
    expect(variantsOf(removed.document, course)).toEqual(["A:31-41-32-43-33", "B:31-42-32-43-33"]);
    expect(removed.selection).toMatchObject({ courseControl: at32 });
    expect(removed.branch).toBeUndefined();
  });

  it("gaffelkontrollen känns igen (Delete frågar); en slinga och vanliga kontroller inte", () => {
    const { state, at32, d, at33 } = forkAt32();
    expect(selectedForkStart(selectCc(state, d))).toEqual({ courseControl: d, control: state.document.courseControls[d]!.control });
    expect(selectedForkStart(selectCc(state, at32))).toMatchObject({ courseControl: at32 });
    expect(selectedForkStart(selectCc(state, at33))).toBeUndefined();
    // Ta bort gren D (två grenar): gafflingen försvinner.
    const removed = removeSelected(selectCc(state, d), applyEdit);
    expect(removed.document.courseControls[at32]!.split).toBeUndefined();
    expect(removed.selection).toMatchObject({ courseControl: at32 });
  });
});

describe("G1 A6: sträckor i flera grenar", () => {
  it("32–33 i två tomma grenar: tvetydig utan gren eller variant, annars rätt gren", () => {
    const built = build();
    let state = selectCc(setView(createState(built.document), built.course), built.at32);
    state = addSplit(state, "FORK", 2, applyEdit);
    const [c, d] = state.document.courseControls[built.at32]!.split!.branches as [string, string];
    const leg = { from: built.ids.c32, to: built.ids.c33 };
    expect(legPlace(state.document, built.course, leg)).toEqual({ ambiguous: true });
    expect(legPlace(state.document, built.course, leg, d)).toEqual({ at: d, ambiguous: false });
    expect(legPlace(state.document, built.course, leg, undefined, "AD")).toEqual({ at: d, ambiguous: false });
    expect(legPlace(state.document, built.course, leg, undefined, "BC")).toEqual({ at: c, ambiguous: false });
    const onLeg = select({ ...state, branch: undefined }, { kind: "leg", ...leg });
    expect(selectedLegAmbiguous(onLeg)).toBe(true);
    expect(splitPlace(onLeg)).toBeUndefined();
    const tried = insertExisting(onLeg, built.ids.c45, applyEdit);
    expect(tried.document).toBe(onLeg.document);
    expect(tried.error).toBe(LEG_IN_SEVERAL_BRANCHES);
    const inD = insertExisting({ ...onLeg, branch: d }, built.ids.c45, applyEdit);
    expect(variantsOf(inD.document, built.course)).toContain("AD:31-41-32-45-33");
    // En sträcka som bara finns en gång är inte tvetydig.
    expect(legPlace(state.document, built.course, { from: built.ids.c31, to: built.ids.c41 }).ambiguous).toBe(false);
  });

  it("grenträdets sista kontroll i grenen", () => {
    const { state, d } = forkAt32();
    const last = allBranches(courseTree(state.document, state.view)).find(row => row.start === d)!.last;
    expect(state.document.controls[state.document.courseControls[last]!.control]!.code).toBe("44");
  });
});
