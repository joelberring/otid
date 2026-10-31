import { describe, expect, it, vi } from "vitest";
import type { OverprintPrimitive } from "@o-tid/course-setting";
import { Autosaver } from "./course-setting-autosave";
import { circleArcs } from "./course-setting-draw";
import {
  addBend, addPoint, applySteps, beginDrag, canRedo, canUndo, cancelTool, courseChain, createEditor, dragTo, endDrag, insertExisting, redo,
  removeSelected, select, setView, undo
} from "./course-setting-editor";
import { ALL_CONTROLS, bendInsertIndex, hitTest, nearestBend, primitiveDistance } from "./course-setting-hit";
import { checkRows, controlLabel, legInput, minutes } from "./course-setting-text";
import { testApply as apply, testDocument } from "./course-setting-test-document";
import { bitmapPlacement, fitBounds, panBy, toMap, toScreen, topLeft, wheelFactor, zoomAt } from "./course-setting-viewport";

/** Steg 62: banläggningens rena moduler – kartvyn (mm ↔ skärm, y uppåt), träff-test, editorn, autosparandet och texterna. */
const view = { centerX: 50, centerY: 40, pxPerMm: 4, width: 400, height: 300 };
const nextCode = () => "40";

describe("kartvyn", () => {
  it("räknar mm till skärm och tillbaka med y uppåt i kartan", () => {
    expect(toScreen(view, { x: 50, y: 40 })).toEqual({ x: 200, y: 150 });
    expect(toScreen(view, { x: 60, y: 50 })).toEqual({ x: 240, y: 110 });
    expect(toMap(view, { x: 240, y: 110 })).toEqual({ x: 60, y: 50 });
    expect(topLeft(view)).toEqual({ x: 0, y: 77.5 });
  });

  it("zoomar kring pekaren så att punkten under den står still och panorerar med pekaren", () => {
    const zoomed = zoomAt(view, 2, { x: 300, y: 100 });
    expect(zoomed.pxPerMm).toBe(8);
    const before = toMap(view, { x: 300, y: 100 }), after = toMap(zoomed, { x: 300, y: 100 });
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
    const panned = panBy(view, 40, -20);
    expect(toScreen(panned, { x: 50, y: 40 })).toEqual({ x: 240, y: 130 });
    expect(zoomAt(view, 1e6).pxPerMm).toBe(80);
    expect(wheelFactor(100)).toBeCloseTo(0.8);
    expect(wheelFactor(-100)).toBeCloseTo(1.25);
  });

  it("visar hela kartan och flyttar en gammal bild till den nya vyn", () => {
    const fitted = fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 532, 300, 16);
    expect(fitted).toMatchObject({ centerX: 50, centerY: 25, pxPerMm: 5 });
    expect(bitmapPlacement(view, zoomAt(view, 2))).toEqual({ x: -200, y: -150, width: 800, height: 600 });
  });
});

describe("träff-testet", () => {
  const document = testDocument();
  const ring = (ref: string, x: number, y: number): OverprintPrimitive =>
    ({ kind: "circle", role: "CONTROL", color: "COURSE", center: { x, y }, diameter: 6, lineWidth: 0.35, ref });
  const primitives: OverprintPrimitive[] = [
    ring("c2", 10, 0), ring("c3", 20, 10),
    { kind: "polyline", role: "LEG", color: "COURSE", points: [{ x: 13, y: 3 }, { x: 17, y: 7 }], width: 0.35, ref: "c2-c3" },
    { kind: "text", role: "NUMBER", color: "COURSE", at: { x: 14, y: -3 }, text: "1", heightMm: 4, align: "center", ref: "c2" }
  ];

  it("träffar ringen även inuti och avståndet är 0 där", () => {
    expect(primitiveDistance(primitives[0]!, { x: 11, y: 1 })).toBe(0);
    expect(primitiveDistance(primitives[0]!, { x: 15, y: 0 })).toBeCloseTo(15 - 10 - 3.175);
  });

  it("ger banans kontroll i en bana, kontrollen i Alla kontroller, sträckan och numret först", () => {
    expect(hitTest(document, "k", primitives, { x: 10.5, y: 0 }, 1)).toEqual({ kind: "control", control: "a", courseControl: "c2" });
    expect(hitTest(document, "k", primitives, { x: 15, y: 5 }, 1)).toMatchObject({ kind: "leg", from: "a", to: "b", fromCourseControl: "c2" });
    expect(hitTest(document, "k", primitives, { x: 14, y: -3 }, 1)).toMatchObject({ kind: "number", control: "a" });
    expect(hitTest(document, ALL_CONTROLS, [{ ...ring("a", 10, 0) }], { x: 10, y: 0 }, 1)).toEqual({ kind: "control", control: "a" });
    expect(hitTest(document, "k", primitives, { x: 40, y: 40 }, 1)).toBeUndefined();
  });

  it("lägger brytpunkter i ordning längs linjen och hittar den närmaste", () => {
    expect(bendInsertIndex({ x: 0, y: 0 }, { x: 30, y: 0 }, [{ x: 10, y: 5 }, { x: 20, y: 5 }], { x: 25, y: 3 })).toBe(2);
    expect(bendInsertIndex({ x: 0, y: 0 }, { x: 30, y: 0 }, [{ x: 10, y: 5 }], { x: 3, y: 1 })).toBe(0);
    expect(nearestBend([{ x: 10, y: 5 }, { x: 20, y: 5 }], { x: 19.5, y: 5 }, 1)).toBe(1);
    expect(nearestBend([{ x: 10, y: 5 }], { x: 30, y: 5 }, 1)).toBeUndefined();
  });
});

describe("editorn", () => {
  it("lägger nya kontroller efter vald kontroll i banan, och ångra/gör om går stegvis", () => {
    let state = setView(createEditor(testDocument()), "k");
    state = select(state, { kind: "control", control: "a", courseControl: "c2" });
    state = addPoint(state, "ADD_CONTROL", { x: 15, y: 20 }, apply, nextCode);
    const added = state.selection!;
    expect(added.kind === "control" && state.document.controls[added.control]?.code).toBe("40");
    const chain = courseChain(state.document, "k").map(id => state.document.courseControls[id]!.control);
    expect(chain).toEqual(["s", "a", added.kind === "control" ? added.control : "", "b", "f"]);
    expect(state.past).toHaveLength(1);
    expect(canUndo(state)).toBe(true);
    const undone = undo(state);
    expect(courseChain(undone.document, "k")).toEqual(["c1", "c2", "c3", "c4"]);
    expect(undone.selection).toBeUndefined();
    expect(canRedo(undone)).toBe(true);
    expect(redo(undone).document).toBe(state.document);
  });

  it("i Alla kontroller läggs kontrollen bara till; start hamnar först och mål sist i en bana", () => {
    const all = addPoint(createEditor(testDocument()), "ADD_CONTROL", { x: 1, y: 1 }, apply, nextCode);
    expect(Object.keys(all.document.controls)).toHaveLength(5);
    expect(courseChain(all.document, "k")).toHaveLength(4);
    const course = setView(createEditor(testDocument()), "k");
    const started = addPoint(course, "ADD_START", { x: -5, y: 0 }, apply, nextCode);
    expect(started.document.controls[started.document.courseControls[courseChain(started.document, "k")[0]!]!.control]!.kind).toBe("START");
    expect(started.document.controls[courseChain(started.document, "k").map(id => started.document.courseControls[id]!.control)[0]!]!.at)
      .toEqual({ x: -5, y: 0 });
  });

  it("lägger in en befintlig kontroll, tar bort från banan med Delete och avvisar en borttagning som inte går", () => {
    let state = select(setView(createEditor(testDocument()), "k"), { kind: "control", control: "b", courseControl: "c3" });
    state = insertExisting(state, "a", apply);
    expect(courseChain(state.document, "k").map(id => state.document.courseControls[id]!.control)).toEqual(["s", "a", "b", "a", "f"]);
    state = removeSelected(state, apply);
    expect(courseChain(state.document, "k").map(id => state.document.courseControls[id]!.control)).toEqual(["s", "a", "b", "f"]);
    const blocked = removeSelected(select(createEditor(testDocument()), { kind: "control", control: "a" }), apply);
    expect(blocked.error).toBe("Kontrollen används på en bana");
    expect(blocked.past).toHaveLength(0);
  });

  it("en dragning är ett steg i historiken; Escape tar tillbaka Välj", () => {
    let state = beginDrag(createEditor(testDocument()));
    state = dragTo(state, { type: "MOVE_CONTROL", control: "a", at: { x: 11, y: 1 } }, apply);
    state = dragTo(state, { type: "MOVE_CONTROL", control: "a", at: { x: 12, y: 2 } }, apply);
    expect(state.past).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
    state = endDrag(state);
    expect(state.document.controls.a!.at).toEqual({ x: 12, y: 2 });
    expect(state.past).toHaveLength(1);
    expect(undo(state).document.controls.a!.at).toEqual({ x: 10, y: 0 });
    expect(cancelTool({ ...state, tool: "ADD_CONTROL" })).toMatchObject({ tool: "SELECT", selection: undefined });
    const unchanged = endDrag(beginDrag(createEditor(testDocument())));
    expect(unchanged.past).toHaveLength(0);
  });

  it("brytpunkter läggs på vald sträcka och tas bort med Delete", () => {
    let state = select(setView(createEditor(testDocument()), "k"), { kind: "leg", from: "a", to: "b" });
    state = addBend(state, { x: 15, y: 2 }, apply);
    state = addBend(state, { x: 18, y: 8 }, apply);
    expect(state.document.legs["a-b"]!.bends).toEqual([{ x: 15, y: 2 }, { x: 18, y: 8 }]);
    state = removeSelected(state, apply);
    expect(state.document.legs["a-b"]!.bends).toEqual([]);
  });

  it("flera steg som bygger på varandra blir ett", () => {
    const state = applySteps(setView(createEditor(testDocument()), "k"), [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 1, y: 1 }, code: "50" },
      created => ({ type: "INSERT_COURSE_CONTROL", course: "k", control: created! })], apply);
    expect(state.past).toHaveLength(1);
    expect(courseChain(state.document, "k")).toHaveLength(5);
  });
});

describe("texterna och vägvalens indata", () => {
  const document = testDocument();
  it("skriver kontrollerna i klartext med vad som ska markeras", () => {
    expect(controlLabel(document, "a")).toBe("kontroll 31");
    expect(controlLabel(document, "s")).toBe("start");
    const rows = checkRows(document, [{ kind: "CONTROLS_TOO_CLOSE", controls: ["a", "b"], meters: 24.6, limitMeters: 60 },
      { kind: "COURSE_WITHOUT_START_OR_FINISH", course: "k" }, { kind: "DUPLICATE_CODE", code: "31", controls: ["a", "b"] }]);
    expect(rows.map(row => row.text)).toEqual(["kontroll 31 och kontroll 32 ligger 25 m från varandra (riktvärde minst 60 m).",
      "Lång saknar start eller mål.", "Koden 31 finns på 2 kontroller."]);
    expect(rows[0]!.controls).toEqual(["a", "b"]);
    expect(rows[1]!.course).toBe("k");
  });

  it("ger sträckans ändar och banans andra kontroller; nyckeln följer lägena", () => {
    const input = legInput(document, "s", "a", ["c1", "c2", "c3", "c4"])!;
    expect(input).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, otherControls: [{ code: "32", at: { x: 20, y: 10 } }] });
    const moved = { ...document, controls: { ...document.controls, a: { ...document.controls.a!, at: { x: 11, y: 0 } } } };
    expect(legInput(moved, "s", "a", [])!.key).not.toBe(input.key);
    expect(minutes(125.4)).toBe("2:05");
  });

  it("ritar ringens bågar mellan avbrotten", () => {
    expect(circleArcs(undefined)).toEqual([[0, 360]]);
    expect(circleArcs([{ startDegrees: 80, endDegrees: 100 }])).toEqual([[100, 440]]);
    expect(circleArcs([{ startDegrees: 350, endDegrees: 10 }, { startDegrees: 170, endDegrees: 190 }])).toEqual([[190, 350], [370, 530]]);
  });
});

describe("autosparandet", () => {
  it("väntar in pausen, sparar det senaste, bygger på serverns version och stannar vid konflikt", async () => {
    vi.useFakeTimers();
    try {
      const statuses: string[] = [];
      const save = vi.fn(async (document: string, version: number) => document === "konflikt"
        ? { kind: "conflict" as const, conflict: { version: 9 } } : { kind: "saved" as const, version: version + 1 });
      const saver = new Autosaver<string, { version: number }>(3, { save, onStatus: status => statuses.push(status), delayMs: 1500 });
      saver.change("a"); saver.change("b");
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenLastCalledWith("b", 3);
      expect(saver.currentVersion).toBe(4);
      saver.change("c");
      await saver.flush();
      expect(save).toHaveBeenLastCalledWith("c", 4);
      saver.change("konflikt");
      await vi.advanceTimersByTimeAsync(1600);
      expect(statuses.at(-1)).toBe("conflict");
      saver.change("d");
      await vi.advanceTimersByTimeAsync(5000);
      expect(save).toHaveBeenCalledTimes(3);
      saver.reset(9);
      saver.change("e");
      await vi.advanceTimersByTimeAsync(1600);
      expect(save).toHaveBeenLastCalledWith("e", 9);
      expect(statuses.at(-1)).toBe("saved");
    } finally { vi.useRealTimers(); }
  });

  it("försöker igen efter ett nätfel", async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const save = vi.fn(async (_document: string, version: number) => {
        if (fail) { fail = false; throw new Error("nät"); }
        return { kind: "saved" as const, version: version + 1 };
      });
      const statuses: string[] = [];
      const saver = new Autosaver<string>(0, { save, onStatus: status => statuses.push(status), delayMs: 100, retryMs: 1000 });
      saver.change("a");
      await vi.advanceTimersByTimeAsync(150);
      expect(statuses.at(-1)).toBe("failed");
      expect(saver.dirty).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)).toBe("saved");
    } finally { vi.useRealTimers(); }
  });
});
