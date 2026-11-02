import { describe, expect, it } from "vitest";
import { applyEdit as apply, courseControlOrder, emptyDocument, type CourseSettingDocument } from "@o-tid/course-setting";
import { addPoint, addSplit, applySteps, createEditor, select, setView, workInBranch, type EditorState } from "./course-setting-editor";
import { allBranches, branchLabels, branchOf, branchVariant, courseTree, forkOfBranch } from "./course-setting-forks";
import { ALL_CONTROLS } from "./course-setting-hit";
import { PALETTE, paletteIcon } from "./course-setting-palette";
import {
  angleTowards, handlePosition, legOrientation, nearestLegOrientation, nearHandle, rotatableOf, rotateEdit
} from "./course-setting-rotate";
import { ghostPrimitives, otherCoursesPrimitives, snapAt, snapCandidates } from "./course-setting-snap";
import { clickSpecial } from "./course-setting-specials";
import { testDocument } from "./course-setting-test-document";

/** ADR-0180 beslut 12: fångst av befintliga kontroller, vridning, grenarnas presentation och paletten. */
const nextCode = (document: CourseSettingDocument) => String(31 + Object.keys(document.controls).length);

/** Testdokumentet med en kontroll till (33) som inte är med i banan. */
function withLoose() {
  return apply(testDocument(), { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 30, y: 0 }, code: "33" });
}

describe("befintliga kontroller snäpper", () => {
  it("kandidaterna är kontroller av samma slag som inte är med i banan", () => {
    const { document, created } = withLoose();
    expect(snapCandidates(document, "k", "NORMAL")).toEqual([created]);
    expect(snapCandidates(document, "k", "START")).toEqual([]);
    expect(snapCandidates(document, "k", "ANY")).toEqual([created]);
    expect(snapCandidates(document, ALL_CONTROLS, "NORMAL")).toEqual([]);
  });

  it("inom ringen plus fångavståndet: den befintliga; utanför: ingen", () => {
    const { document, created } = withLoose();
    const candidates = snapCandidates(document, "k", "NORMAL");
    // Ringen 3 mm, fingret 22 px vid 4 px/mm = 5,5 mm.
    expect(snapAt(document, candidates, { x: 32, y: 1 }, 3, 22 / 4)?.control).toBe(created);
    expect(snapAt(document, candidates, { x: 38, y: 0 }, 3, 22 / 4)?.control).toBe(created);
    expect(snapAt(document, candidates, { x: 39, y: 0 }, 3, 22 / 4)).toBeUndefined();
    // Musen: 10 px.
    expect(snapAt(document, candidates, { x: 36, y: 0 }, 3, 10 / 4)).toBeUndefined();
  });

  it("ett klick med fångst lägger in den befintliga kontrollen; utan fångst blir det en ny", () => {
    const { document, created } = withLoose();
    let state = setView(createEditor(document), "k");
    state = select(state, { kind: "control", control: "a", courseControl: "c2" });
    const snapped = addPoint(state, "ADD_CONTROL", { x: 31, y: 0 }, apply, nextCode, created);
    expect(Object.keys(snapped.document.controls)).toHaveLength(5);
    expect(courseControlOrder(snapped.document, "k").map(id => snapped.document.courseControls[id]!.control)).toEqual(["s", "a", created, "b", "f"]);
    const fresh = addPoint(state, "ADD_CONTROL", { x: 31, y: 0 }, apply, nextCode);
    expect(Object.keys(fresh.document.controls)).toHaveLength(6);
  });

  it("svaga ringar och koder för kontrollerna utanför banan, andra banor för sig", () => {
    const { document, created } = withLoose();
    const ghosts = ghostPrimitives(document, "k");
    expect(new Set(ghosts.map(primitive => primitive.ref))).toEqual(new Set([created]));
    expect(ghosts.some(primitive => primitive.kind === "text" && primitive.text === "33")).toBe(true);
    expect(ghostPrimitives(document, ALL_CONTROLS)).toEqual([]);
    const two = apply(document, { type: "ADD_COURSE", name: "Kort" }).document;
    expect(otherCoursesPrimitives(two, "k").length).toBeGreaterThan(0);
  });
});

describe("vridning", () => {
  function crossingCourse() {
    // Start (0,0) → passage (10,10) → mål (20,10): in längs 45°, ut längs 0° → medel 22,5°, passagen −67,5° = 292,5°.
    let document = emptyDocument({ title: "", mapScale: 10000 });
    for (const [kind, at] of [["START", { x: 0, y: 0 }], ["FINISH", { x: 20, y: 10 }]] as const) document = apply(document, { type: "ADD_CONTROL", kind, at }).document;
    const course = apply(document, { type: "ADD_COURSE", name: "A" });
    let state = setView(createEditor(course.document), course.created!);
    state = addPoint(state, "ADD_CROSSING", { x: 10, y: 10 }, apply, nextCode);
    return { state, course: course.created! };
  }

  it("en ny obligatorisk passage i en bana vrids efter sträckan genom den (ett ångra-steg)", () => {
    const { state } = crossingCourse();
    const crossing = Object.values(state.document.controls).find(control => control.kind === "CROSSING_POINT")!;
    expect(crossing.orientation).toBeCloseTo(292.5, 1);
    expect(state.past).toHaveLength(1);
    expect(state.log.map(entry => entry.edit.type)).toEqual(["ADD_CONTROL", "INSERT_COURSE_CONTROL", "SET_CONTROL_ORIENTATION"]);
  });

  it("i Alla kontroller får passagen vinkeln 0 (ingen sträcka)", () => {
    const state = addPoint(createEditor(emptyDocument({ title: "", mapScale: 10000 })), "ADD_CROSSING", { x: 1, y: 1 }, apply, nextCode);
    expect(Object.values(state.document.controls)[0]!.orientation).toBe(0);
  });

  it("legOrientation och närmaste sträcka för en valfri passage", () => {
    const { state, course } = crossingCourse();
    const cc = courseControlOrder(state.document, course)[1]!;
    expect(legOrientation(state.document, course, cc)).toBeCloseTo(292.5, 1);
    expect(legOrientation(state.document, ALL_CONTROLS, cc)).toBeUndefined();
    // Nära sträckan passage–mål (vågrät): 270°.
    expect(nearestLegOrientation(state.document, course, { x: 15, y: 11 }, 3)).toBe(270);
    expect(nearestLegOrientation(state.document, course, { x: 15, y: 30 }, 3)).toBeUndefined();
  });

  it("handtaget, 5°-steg och fri vinkel, och ändringen för kontroll och specialobjekt", () => {
    const { state } = crossingCourse();
    const id = Object.values(state.document.controls).find(control => control.kind === "CROSSING_POINT")!.id;
    const target = rotatableOf(state.document, { kind: "control", control: id })!;
    expect(target.orientation).toBeCloseTo(292.5, 1);
    const handle = handlePosition(target, 4);
    expect(Math.hypot(handle.x - 10, handle.y - 10) * 4).toBeCloseTo(38);
    expect(nearHandle(target, handle, 4, "mouse")).toBe(true);
    expect(nearHandle(target, { x: 10, y: 10 }, 4, "touch")).toBe(false);
    expect(angleTowards({ x: 0, y: 0 }, { x: 10, y: 1.3 }, false)).toBe(5);
    expect(angleTowards({ x: 0, y: 0 }, { x: 10, y: 1.3 }, true)).toBeCloseTo(7.4, 1);
    expect(angleTowards({ x: 0, y: 0 }, { x: 0, y: -10 }, false)).toBe(270);
    expect(rotateEdit(target, -10)).toEqual({ type: "SET_CONTROL_ORIENTATION", control: id, orientation: 350 });
    expect(rotatableOf(state.document, { kind: "control", control: "1" })).toBeUndefined();
    const special = apply(state.document, { type: "ADD_SPECIAL", special: { kind: "optional-crossing-point", points: [{ x: 5, y: 5 }], orientation: 30 } });
    const optional = rotatableOf(special.document, { kind: "special", special: special.created! })!;
    expect(rotateEdit(optional, 45)).toEqual({ type: "UPDATE_SPECIAL", special: special.created, changes: { orientation: 45 } });
  });
});

/** Banan s–a–b–f med gaffling vid a i tre grenar: A tom, B med 41, C med 42 och 43. */
function forked() {
  let state = setView(createEditor(testDocument()), "k");
  state = select(state, { kind: "control", control: "a", courseControl: "c2" });
  state = addSplit(state, "FORK", 3, apply);
  return state;
}

describe("gafflingens grenar", () => {
  it("efter Gaffla här står editorn i gren A och nästa kontroll hamnar där", () => {
    let state = forked();
    expect(state.branch).toBe("c2");
    expect(state.selection).toEqual({ kind: "control", control: "a", courseControl: "c2" });
    state = addPoint(state, "ADD_CONTROL", { x: 12, y: 5 }, apply, () => "41");
    const tree = courseTree(state.document, "k");
    const [a, b, c] = allBranches(tree);
    expect(a!.rows.map(row => row.kind === "control" && row.label)).toEqual(["kontroll 41"]);
    expect(b!.rows).toEqual([]);
    expect(c!.rows).toEqual([]);
  });

  it("trädet: grenarna bredvid varandra med bokstav, var de går ihop, Nästa gren och varianten som visas", () => {
    let state = forked();
    const tree0 = courseTree(state.document, "k");
    const fork0 = tree0.find(row => row.kind === "fork")!;
    expect(fork0.kind === "fork" && fork0.branches.map(branch => branch.letter)).toEqual(["A", "B", "C"]);
    expect(fork0.kind === "fork" && fork0.joinLabel).toBe("kontroll 32");
    // Gren B: lägg in 41; gren C: 42 och 43.
    const [, b0, c0] = allBranches(tree0);
    state = addPoint(workInBranch(state, b0!.start, b0!.last), "ADD_CONTROL", { x: 14, y: 2 }, apply, () => "41");
    state = workInBranch(state, c0!.start, c0!.last);
    state = addPoint(state, "ADD_CONTROL", { x: 14, y: 8 }, apply, () => "42");
    state = addPoint(state, "ADD_CONTROL", { x: 16, y: 9 }, apply, () => "43");
    const tree = courseTree(state.document, "k");
    expect(tree.map(row => row.kind === "control" ? row.label : "fork")).toEqual(["start", "kontroll 31", "fork", "kontroll 32", "mål"]);
    const [a, b, c] = allBranches(tree);
    expect(b!.rows.map(row => row.kind === "control" && row.label)).toEqual(["kontroll 41"]);
    expect(c!.rows.map(row => row.kind === "control" && row.label)).toEqual(["kontroll 42", "kontroll 43"]);
    expect(c!.last).toBe((c!.rows[1] as { courseControl: string }).courseControl);
    expect(branchOf(tree, c!.last)?.letter).toBe("C");
    expect(forkOfBranch(tree, c!.start)?.index).toBe(2);
    expect(branchVariant(state.document, "k", b!.start)).toBe("B");
    expect(branchVariant(state.document, "k", a!.start)).toBe("A");
    // Bokstäverna på kartan: en per gren, ute på grenens första sträcka.
    const labels = branchLabels(state.document, "k", tree);
    expect(labels.map(label => label.letter)).toEqual(["A", "B", "C"]);
    expect(labels.every(label => Number.isFinite(label.at.x) && Number.isFinite(label.at.y))).toBe(true);
  });

  it("slinga: editorn står i första slingan och den går tillbaka till gaffelkontrollen", () => {
    let state = setView(createEditor(testDocument()), "k");
    state = select(state, { kind: "control", control: "a", courseControl: "c2" });
    state = addSplit(state, "LOOP", 2, apply);
    state = addPoint(state, "ADD_CONTROL", { x: 12, y: -5 }, apply, () => "51");
    const tree = courseTree(state.document, "k");
    const fork = tree.find(row => row.kind === "fork")!;
    expect(fork.kind === "fork" && fork.split).toBe("LOOP");
    expect(fork.kind === "fork" && fork.branches.map(branch => [branch.letter, branch.rows.length])).toEqual([["A", 1], ["B", 0]]);
    expect(tree.map(row => row.kind === "control" ? row.label : "fork")).toEqual(["start", "kontroll 31", "fork", "kontroll 32", "mål"]);
  });

  it("byte av bana släpper grenen", () => {
    expect(setView(forked(), ALL_CONTROLS).branch).toBeUndefined();
  });
});

describe("paletten och bilden", () => {
  it("varje slag har en ikon ritad med banpåtrycket (bild: ram)", () => {
    for (const group of PALETTE) for (const item of group.items) {
      const icon = paletteIcon(item);
      expect(icon.primitives.length, JSON.stringify(item)).toBeGreaterThan(0);
      expect(icon.bounds.maxX).toBeGreaterThan(icon.bounds.minX);
    }
    expect(PALETTE.flatMap(group => group.items)).toHaveLength(18);
  });

  it("en vald bild läggs ut med ett klick med bildens proportioner", () => {
    let state: EditorState = { ...createEditor(emptyDocument({ title: "", mapScale: 10000 })), tool: "SPECIAL", specialKind: "image",
      specialImage: { format: "png", data: "iVBORw0KGgo=", aspect: 0.5 } };
    state = clickSpecial(state, { x: 10, y: 20 }, apply, 1);
    const image = state.document.specialObjects[0]!;
    expect(image.kind).toBe("image");
    expect(image.points).toEqual([{ x: 10, y: 20 }, { x: 35, y: 7.5 }]);
    expect(state.specialImage).toBeUndefined();
    const without = clickSpecial({ ...state, specialImage: undefined }, { x: 1, y: 1 }, apply, 1);
    expect(without.error).toMatch(/Välj en bild/);
  });
});

describe("ta bort bana och oanvända kontroller i ett ångra-steg", () => {
  it("banan och kontrollerna som bara den använde", () => {
    const state = setView(createEditor(testDocument()), "k");
    const next = applySteps(state, [{ type: "DELETE_COURSE", course: "k" }, { type: "DELETE_CONTROL", control: "a" }, { type: "DELETE_CONTROL", control: "b" }], apply);
    expect(next.past).toHaveLength(1);
    expect(Object.keys(next.document.controls).sort()).toEqual(["f", "s"]);
  });
});
