import { describe, expect, it } from "vitest";
import { COURSE_SETTING_SKETCH_MAX_POINTS, courseSettingSketchSchema } from "@o-tid/contracts";
import {
  addClickPoint, cancelStroke, createSketch, distanceToSketch, endStroke, extendStroke, finishShape, hitSketch, setSketchOptions, simplify,
  sketchFull, sketchPointCount, sketchPreview, sketchShapes, startStroke, undoSketch, type SketchDraft
} from "./course-setting-sketch";

/** ADR-0181 beslut 8: ritläget utan React (dra, klick, två fingrar, ångra, slag och gränsen för punkter). */
function stroke(draft: SketchDraft, points: readonly { x: number; y: number }[], step = 0.1, tolerance = 0.15): SketchDraft {
  let next = startStroke(draft, points[0]!);
  for (const point of points.slice(1)) next = extendStroke(next, point, step);
  return endStroke(next, tolerance);
}
const wiggle = (count: number) => Array.from({ length: count }, (_, i) => ({ x: i * 0.2, y: Math.sin(i / 10) * 3 }));

describe("ritläget", () => {
  it("ett frihandsstreck förenklas när det släpps och sparas med slag, form och betydelse", () => {
    const straight = Array.from({ length: 101 }, (_, i) => ({ x: i * 0.2, y: 5 + (i % 2) * 0.01 }));
    const draft = stroke(setSketchOptions(createSketch("MAP_ERROR"), { intent: "WRONG" }), straight);
    expect(draft.current).toBeUndefined();
    expect(draft.shapes).toEqual([{ kind: "LINE", style: "MAP_ERROR", intent: "WRONG", points: [{ x: 0, y: 5 }, { x: 20, y: 5 }] }]);
    const curved = stroke(createSketch(), wiggle(200));
    expect(curved.shapes[0]!.points.length).toBeGreaterThan(5);
    expect(curved.shapes[0]!.points.length).toBeLessThan(60);
    expect(courseSettingSketchSchema.safeParse(curved.shapes).success).toBe(true);
  });

  it("punkter närmare än steget hoppas över; ett streck utan längd blir ingenting", () => {
    let draft = startStroke(createSketch(), { x: 0, y: 0 });
    draft = extendStroke(draft, { x: 0.01, y: 0 }, 0.5);
    expect(draft.current?.points).toHaveLength(1);
    expect(endStroke(draft, 0.1).shapes).toEqual([]);
  });

  it("klick punkt för punkt; avslutas med Enter (finishShape) eller när ett streck börjar; en yta kräver tre punkter", () => {
    let draft = setSketchOptions(createSketch("MARKING"), { shape: "AREA" });
    draft = addClickPoint(addClickPoint(draft, { x: 1, y: 1 }), { x: 5, y: 1 });
    expect(finishShape(draft).shapes).toEqual([]);
    draft = addClickPoint(draft, { x: 3, y: 4.004 });
    expect(sketchPreview(draft)).toHaveLength(1);
    const done = finishShape(draft);
    expect(done.shapes).toEqual([{ kind: "AREA", style: "MARKING", intent: null, points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 4 }] }]);
    // Ett streck efter klicken avslutar dem först.
    const line = setSketchOptions(createSketch(), { shape: "LINE" });
    const mixed = stroke(addClickPoint(addClickPoint(line, { x: 0, y: 0 }), { x: 2, y: 0 }), [{ x: 5, y: 5 }, { x: 9, y: 5 }]);
    expect(mixed.shapes.map(shape => shape.points.length)).toEqual([2, 2]);
  });

  it("ett andra finger kastar strecket som pågår; ångra tar senaste punkten och sedan senaste delen", () => {
    let draft = stroke(createSketch(), [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    draft = extendStroke(startStroke(draft, { x: 10, y: 10 }), { x: 12, y: 10 }, 0.1);
    expect(cancelStroke(draft)).toMatchObject({ current: undefined, shapes: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }] });
    let clicks = addClickPoint(addClickPoint(cancelStroke(draft), { x: 1, y: 1 }), { x: 2, y: 2 });
    clicks = undoSketch(clicks);
    expect(clicks.current?.points).toEqual([{ x: 1, y: 1 }]);
    clicks = undoSketch(undoSketch(clicks));
    expect(clicks).toMatchObject({ current: undefined, shapes: [] });
    expect(sketchShapes(clicks)).toBeUndefined();
  });

  it("högst 1000 punkter: ett långt streck förenklas mer tills det får plats, sedan är ritningen full", () => {
    let draft = createSketch();
    for (let round = 0; round < 30; round += 1) {
      const points = Array.from({ length: 400 }, (_, i) => ({ x: i * 0.05, y: round + ((i * 7919) % 13) / 10 }));
      draft = stroke(draft, points, 0.01, 0.001);
    }
    expect(sketchPointCount(draft)).toBeLessThanOrEqual(COURSE_SETTING_SKETCH_MAX_POINTS);
    expect(draft.shapes.length).toBeLessThanOrEqual(20);
    expect(sketchFull(draft)).toBe(true);
    expect(courseSettingSketchSchema.safeParse(sketchShapes(draft)).success).toBe(true);
    expect(addClickPoint(draft, { x: 1, y: 1 })).toBe(draft);
  });

  it("träff-test: nära linjen eller inne i ytan väljer notisen", () => {
    const line = { id: "a", shapes: [{ kind: "LINE" as const, style: "GENERAL" as const, intent: null, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
    const area = { id: "b", shapes: [{ kind: "AREA" as const, style: "MAP_ERROR" as const, intent: null,
      points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] }] };
    expect(distanceToSketch(line.shapes, { x: 5, y: 1 })).toBeCloseTo(1);
    expect(hitSketch([line, area], { x: 5, y: 0.5 }, 1)?.id).toBe("a");
    expect(hitSketch([line, area], { x: 25, y: 5 }, 0.5)?.id).toBe("b");
    expect(hitSketch([line, area], { x: 15, y: 5 }, 1)).toBeUndefined();
  });

  it("Douglas–Peucker behåller ändpunkterna och hörnen", () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 5, y: 0.01 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });
});
