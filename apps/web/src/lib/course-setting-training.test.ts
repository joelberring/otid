import { describe, expect, it } from "vitest";
import { applyEdit, layoutOverprint } from "@o-tid/course-setting";
import { applySteps, createEditor, redo, undo } from "./course-setting-editor";
import {
  changeCourseTraining, courseControlChoices, legAt, lineAlongLegs, makePairs, newSection, newTrainingId, omit, starCourseEdits
} from "./course-setting-training";
import { mapRenderRequest } from "./course-setting-print";
import { testDocument } from "./course-setting-test-document";

describe("träningsläget i editorn (ADR-0192)", () => {
  it("slumpade id, nya avsnitt och kontrollernas val", () => {
    expect(newTrainingId()).toMatch(/^t[0-9a-z]{6,10}$/);
    expect(newTrainingId()).not.toBe(newTrainingId());
    const first = newSection("CORRIDOR");
    expect(first).toMatchObject({ from: null, to: null, marker: { kind: "NONE" }, corridor: { shape: "ANGULAR", widthMeters: 60 } });
    const next = newSection("BAND", { ...first, to: "c3" });
    expect(next).toMatchObject({ from: "c3", to: null, marker: { kind: "TEXT" }, filter: { preset: "CONTOURS" } });
    expect(courseControlChoices(testDocument(), "k").map(row => row.label)).toEqual(["Start", "1 (31)", "2 (32)", "Mål"]);
    expect(omit({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });

  it("sträckan vid ett klick, linjen längs sträckorna och kepsens par", () => {
    const document = testDocument();
    expect(legAt(document, "k", { x: 15, y: 5.5 }, 1)).toEqual({ from: "a", to: "b" });
    expect(legAt(document, "k", { x: 30, y: 30 }, 1)).toBeUndefined();
    expect(lineAlongLegs(document, "k")).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]);
    expect(makePairs(document, "k", "ADJACENT")).toEqual([["c2", "c3"]]);
  });

  it("stjärnbanan och träningen i ett ångra-steg", () => {
    let state = createEditor(testDocument(), "k");
    const made = starCourseEdits(state.document, "Stjärna 31", "a", ["b"]);
    state = applySteps(state, [...made.edits, { type: "PUT_TRAINING", courses: { [made.courseId]: { outside: { kind: "FULL" }, sections: [], star: { center: "a", print: "PER_CONTROL" } } } }],
      applyEdit);
    const star = state.document.courses.find(course => course.name === "Stjärna 31")!;
    expect(star.id).toBe(made.courseId);
    expect(courseControlChoices(state.document, star.id).map(row => row.label)).toEqual(["Start", "1 (31)", "2 (32)", "3 (31)", "Mål"]);
    expect(state.document.training?.courses[star.id]?.star?.center).toBe("a");
    const undone = undo(state);
    expect(undone.document.courses).toHaveLength(1);
    expect(undone.document.training).toBeUndefined();
    expect(redo(undone).document.training?.courses[star.id]).toBeDefined();
  });

  it("ändringen av banans träning och banpåtrycket utan träningen (före)", () => {
    let state = createEditor(testDocument(), "k");
    state = applySteps(state, [changeCourseTraining(state.document, "k", current => ({ ...current, sections: [newSection("CORRIDOR")] }))], applyEdit);
    expect(state.document.training?.courses.k?.sections).toHaveLength(1);
    expect(layoutOverprint(state.document, { course: "k", training: { off: true } })).toEqual(layoutOverprint(testDocument(), { course: "k" }));
  });

  it("ramens kartbild får passen med sig", () => {
    const passes = [{ within: [], without: [], filters: [] }];
    const frame = { clip: { x: 0, y: 0, width: 10, height: 10 }, transform: { scale: 1, translateX: 0, translateY: 0 },
      mapArea: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };
    expect(mapRenderRequest({ ...frame, mapPasses: passes }).passes).toBe(passes);
    expect(mapRenderRequest(frame).passes).toBeUndefined();
  });
});
