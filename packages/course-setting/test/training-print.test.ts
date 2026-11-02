import { describe, expect, it } from "vitest";
import { controlSequences, expandTrainingItems, layoutOverprint, printSheetGroups, starSpokes, type OverprintPrimitive } from "../src";
import { ccOf, lineCourse, training } from "./training-helpers";

const texts = (figures: readonly OverprintPrimitive[]) => figures.flatMap(f => f.kind === "text" && f.role === "NUMBER" ? [f.text] : []);

describe("stjärna, linje, keps och kartbitar (ADR-0192 beslut 6–7)", () => {
  it("stjärnan: en karta per udd (ut och tillbaka), start och mål med den första och sista", () => {
    const { b, controls } = lineCourse();
    const center = controls[1]!;
    const star = b.course("Stjärna");
    for (const spoke of [controls[2]!, controls[3]!]) { b.insert(star, center); b.insert(star, spoke); }
    b.insert(star, center);
    const sequence = controlSequences(b.document, star, undefined)[0]!;
    expect(starSpokes(b.document, sequence, center)).toEqual([{ from: 0, to: 3 }, { from: 3, to: sequence.length - 1 }]);
    b.edit({ type: "PUT_TRAINING", courses: { [star]: training({ star: { center, print: "PER_CONTROL" } }) } });
    const items = expandTrainingItems(b.document, [{ course: star }]);
    expect(items.map(item => item.training?.section)).toEqual([{ from: 0, to: 3 }, { from: 3, to: sequence.length - 1 }]);
    // Första udden: start, mitten och 32; inte 33.
    const first = layoutOverprint(b.document, { course: star, training: items[0]!.training });
    const shown = new Set(first.filter(f => f.role === "CONTROL").map(f => b.document.courseControls[f.ref!]?.control ?? f.ref));
    expect(shown.has(controls[2])).toBe(true);
    expect(shown.has(controls[3])).toBe(false);
    // Sidan för udden får automatisk tryckyta kring udden.
    const pages = printSheetGroups(b.document, { kind: "COURSE" }, items).flatMap(group => group.sheets);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.frames[0]!.mapArea).not.toEqual(pages[1]!.frames[0]!.mapArea);
  });

  it("linjeorientering: löparens karta har linjen men inte kontrollerna; kontrollantens allt", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ line: { points: [{ x: 0, y: 0 }, { x: 20, y: 5 }, { x: 40, y: 0 }] } }) } });
    const runner = layoutOverprint(b.document, { course });
    expect(runner.some(f => f.role === "CONTROL" || f.role === "NUMBER" || f.role === "LEG")).toBe(false);
    expect(runner.some(f => f.role === "START")).toBe(true);
    expect(runner.some(f => f.role === "FINISH")).toBe(true);
    expect(runner.find(f => f.ref === "line")?.kind).toBe("polyline");
    const controller = layoutOverprint(b.document, { course, training: { view: "CONTROLLER" } });
    expect(controller.filter(f => f.role === "CONTROL")).toHaveLength(3);
    expect(controller.some(f => f.ref === "line")).toBe(true);
    expect(expandTrainingItems(b.document, [{ course }], { controllerMaps: true }).map(item => item.training?.view)).toEqual([undefined, "CONTROLLER"]);
  });

  it("keps: 1a/1b på en gemensam karta utan sträckor; A och B med streckade ringar att ta in", () => {
    const { b, course, controls } = lineCourse();
    const pairs = [[ccOf(b.document, controls[1]!), ccOf(b.document, controls[2]!)] as const];
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ pairs: { pairs, legs: false, print: "COMMON" } }) } });
    const common = layoutOverprint(b.document, { course });
    expect(texts(common).sort()).toEqual(["1a", "1b", "3"]);
    expect(common.some(f => f.role === "LEG")).toBe(false);
    expect(expandTrainingItems(b.document, [{ course }])).toHaveLength(1);
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ pairs: { pairs, legs: true, print: "SEPARATE" } }) } });
    const items = expandTrainingItems(b.document, [{ course }]);
    expect(items.map(item => item.training?.pairMap)).toEqual(["A", "B"]);
    const ringOf = (figures: readonly OverprintPrimitive[], control: string) => figures.find(f => f.role === "CONTROL" && f.kind === "circle"
      && b.document.courseControls[f.ref!]?.control === control);
    const a = layoutOverprint(b.document, { course, training: { pairMap: "A" } });
    const ringA = ringOf(a, controls[1]!), ringB = ringOf(a, controls[2]!);
    expect(ringA?.kind === "circle" ? ringA.gaps?.length ?? 0 : -1).toBe(0);
    expect(ringB?.kind === "circle" ? ringB.gaps?.length ?? 0 : -1).toBe(12);
    expect(a.some(f => f.role === "LEG")).toBe(true);
    expect(a.find(f => f.ref === "pairs-legend")?.kind === "text").toBe(true);
    expect(common.some(f => f.ref === "pairs-legend")).toBe(false);
    const bMap = layoutOverprint(b.document, { course, training: { pairMap: "B" } });
    const bRing = ringOf(bMap, controls[1]!);
    expect(bRing?.kind === "circle" ? bRing.gaps?.length ?? 0 : -1).toBe(12);
  });

  it("kartbitar: en ram per sträcka med bara sträckans kontroller, blandad ordning likadan varje gång", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ pieces: { sizeMm: 50, marginMeters: 30, order: "SHUFFLED" } }) } });
    const sheets = printSheetGroups(b.document, { kind: "PIECES" }, [{ course }]).flatMap(group => group.sheets);
    const frames = sheets.flatMap(sheet => sheet.frames);
    expect(frames).toHaveLength(4);
    expect(sheets[0]!.texts.map(t => t.text).slice(1)).toEqual(["A", "B", "C", "D"]);
    const again = printSheetGroups(b.document, { kind: "PIECES" }, [{ course }]).flatMap(group => group.sheets);
    expect(again.flatMap(sheet => sheet.frames.map(frame => frame.mapArea))).toEqual(frames.map(frame => frame.mapArea));
    for (const frame of frames) expect(new Set(frame.figures.filter(f => f.role !== "NUMBER" && f.role !== "LEG").map(f => f.ref)).size).toBe(2);
  });
});
