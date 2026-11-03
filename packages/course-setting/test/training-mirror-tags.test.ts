import { describe, expect, it } from "vitest";
import { cleanCourseTraining, mirrorFigures, presetFilter, printSheetGroups, TRAINING_TAGS, trainingTags, type OverprintPrimitive } from "../src";
import { ccOf, lineCourse, training } from "./training-helpers";

const centers = (figures: readonly OverprintPrimitive[]) => figures.flatMap(f => f.kind === "circle" && f.role === "CONTROL" ? [f.center] : []);

describe("spegelvänd karta (ADR-0192 beslut 12)", () => {
  it("figurerna speglas kring ramens mitt och ramen märks; utan spegel som förut", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training() } });
    const plain = printSheetGroups(b.document, { kind: "COURSE" }, [{ course }]).flatMap(group => group.sheets)[0]!.frames[0]!;
    expect(plain.mirror).toBeUndefined();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ mirror: true }) } });
    const frame = printSheetGroups(b.document, { kind: "COURSE" }, [{ course }]).flatMap(group => group.sheets)[0]!.frames[0]!;
    expect(frame.mirror).toBe(true);
    expect(frame.mapArea).toEqual(plain.mapArea);
    const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
    expect(centers(frame.figures)).toEqual(centers(plain.figures).map(p => ({ x: 2 * axis - p.x, y: p.y })));
    // Texterna flyttas men vänds inte (samma text och storlek).
    const texts = frame.figures.filter(f => f.kind === "text");
    expect(texts.map(f => f.kind === "text" && f.text)).toEqual(plain.figures.filter(f => f.kind === "text").map(f => f.kind === "text" && f.text));
  });

  it("ringens avbrott speglas: [s, e] blir [180 − e, 180 − s]", () => {
    const ring: OverprintPrimitive = { kind: "circle", role: "CONTROL", color: "COURSE", center: { x: 10, y: 0 }, diameter: 6, lineWidth: 0.35,
      gaps: [{ startDegrees: 10, endDegrees: 40 }, { startDegrees: 170, endDegrees: 200 }] };
    const [mirrored] = mirrorFigures([ring], 0);
    expect(mirrored).toMatchObject({ center: { x: -10, y: 0 }, gaps: [{ startDegrees: 140, endDegrees: 170 }, { startDegrees: 340, endDegrees: 370 }] });
  });

  it("formen kontrolleras: bara sant eller falskt, falskt tas bort", () => {
    expect(cleanCourseTraining({ ...training(), mirror: true }).mirror).toBe(true);
    expect("mirror" in cleanCourseTraining({ ...training(), mirror: false })).toBe(false);
    expect(() => cleanCourseTraining({ ...training(), mirror: "ja" })).toThrow();
  });
});

describe("träningsformernas taggar (ADR-0192 beslut 13)", () => {
  it("namnen är svenska och stabila (samma ord som klubbarkivet föreslår)", () => {
    expect(Object.values(TRAINING_TAGS)).toEqual(["Korridor", "Kurvbild", "Fönster", "Utan karta", "Sista säkra", "Stjärna", "Linje", "Keps", "Minnes", "Spegel"]);
  });

  it("banans taggar i fast ordning ur avsnitten, filtren och formerna", () => {
    const { b, course, controls } = lineCourse();
    expect(trainingTags(b.document, course)).toEqual([]);
    const contours = presetFilter("CONTOURS");
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({
      sections: [
        { id: "t1", from: null, to: ccOf(b.document, controls[2]!), form: "WINDOW", window: { shape: "CIRCLE", radiusMeters: 100 }, filter: presetFilter("ALL"), marker: { kind: "NONE" } },
        { id: "t2", from: ccOf(b.document, controls[2]!), to: null, form: "BAND", bandMeters: 300, filter: contours, marker: { kind: "TEXT" } }
      ],
      pairs: { pairs: [[ccOf(b.document, controls[1]!), ccOf(b.document, controls[2]!)]], legs: false, print: "COMMON" }, mirror: true
    }) }, attackPoints: { t3: { id: "t3", from: controls[1]!, to: controls[2]!, at: { x: 15, y: 5 } } } });
    expect(trainingTags(b.document, course)).toEqual(["Kurvbild", "Fönster", "Sista säkra", "Keps", "Spegel"]);
  });
});
