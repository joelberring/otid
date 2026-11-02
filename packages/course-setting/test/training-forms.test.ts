import { describe, expect, it } from "vitest";
import {
  applyEdit, courseSummaries, layoutOverprint, presetFilter, readPpen, sectionRegion, trainingMapPasses, variations, writePpen, type TrainingSection
} from "../src";
import { Builder } from "./build";
import { ccOf, inside, lineCourse, training } from "./training-helpers";

const corridor = (shape: "ANGULAR" | "SMOOTH", extra: Partial<TrainingSection> = {}): TrainingSection => ({ id: "k", from: null, to: null, form: "CORRIDOR",
  corridor: { shape, widthMeters: 60, smoothing: 0 }, filter: presetFilter("ALL"), marker: { kind: "NONE" }, ...extra });

describe("korridor, bälte och fönster (ADR-0192 beslut 2)", () => {
  it("kantig: rak buffert med spetsigt hörn och rak ände; mjuk: rundade hörn", () => {
    const { b, course } = lineCourse();
    const angular = sectionRegion(b.document, course, undefined, corridor("ANGULAR"));
    // 60 m = 6 mm bred i 1:10 000: vinkelrätt från mitten av 31–32 är 2,8 mm inne och 3,4 mm ute.
    expect(inside(angular, { x: 15, y: 5 })).toBe(true);
    expect(inside(angular, { x: 15 - 2.0, y: 5 + 2.0 })).toBe(true);
    expect(inside(angular, { x: 15 - 2.4, y: 5 + 2.4 })).toBe(false);
    // Hörnet vid 32 (20,10): spetsen når 3/sin(45°) ≈ 4,2 mm upp, den rundade bara 3 mm.
    expect(inside(angular, { x: 20, y: 13.8 })).toBe(true);
    const smooth = sectionRegion(b.document, course, undefined, corridor("SMOOTH"));
    expect(inside(smooth, { x: 20, y: 13.8 })).toBe(false);
    expect(inside(smooth, { x: 20, y: 12.8 })).toBe(true);
    // Ändarna: kantig rak och förlängd en halv bredd förbi starten, mjuk rund.
    expect(inside(angular, { x: -2.6, y: 2.6 })).toBe(true);
    expect(inside(smooth, { x: -2.6, y: 2.6 })).toBe(false);
  });

  it("bredd per sträcka och utjämning", () => {
    const { b, course, controls } = lineCourse();
    const wide = sectionRegion(b.document, course, undefined, corridor("ANGULAR", { corridor: { shape: "ANGULAR", widthMeters: 60, smoothing: 0,
      legWidths: { [`${controls[3]}-${controls[4]}`]: 200 } } }));
    expect(inside(wide, { x: 35, y: 9 })).toBe(true);
    expect(inside(wide, { x: 15, y: -6 })).toBe(false);
    const smoothed = sectionRegion(b.document, course, undefined, corridor("SMOOTH", { corridor: { shape: "SMOOTH", widthMeters: 60, smoothing: 1 } }));
    expect(inside(smoothed, { x: 10, y: 0 })).toBe(true);
    expect(inside(smoothed, { x: 20, y: 10 })).toBe(true);
  });

  it("avsnitt i följd: det tidigare gäller där ytorna möts, vitt utanför, markering vid bytet", () => {
    const { b, course, controls } = lineCourse();
    const at32 = ccOf(b.document, controls[2]!);
    const band: TrainingSection = { id: "b", from: at32, to: null, form: "BAND", bandMeters: 200, filter: presetFilter("CONTOURS"), marker: { kind: "TEXT" } };
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ outside: { kind: "WHITE" }, sections: [corridor("ANGULAR", { to: at32 }), band] }) } });
    const passes = trainingMapPasses(b.document, { course })!;
    expect(passes).toHaveLength(3);
    expect(passes[0]!.filters).toEqual([]);
    expect(passes[1]!.filters.map(f => f.preset)).toEqual(["CONTOURS"]);
    expect(passes[1]!.without).toHaveLength(1);
    expect(passes[2]!.white).toBe(true);
    expect(passes[2]!.without).toHaveLength(2);
    // Korridoren slutar vid 32: sträckan 32–33 är bara i bältet.
    expect(inside(passes[0]!.within[0]!, { x: 25, y: 5 })).toBe(false);
    expect(inside(passes[1]!.within[0]!, { x: 25, y: 5 })).toBe(true);
    const marker = layoutOverprint(b.document, { course }).find(f => f.role === "TRAINING" && f.kind === "text");
    expect(marker?.kind === "text" ? marker.text : "").toBe("Kurvbild");
    // Pilen är två linjer (skaft och spets), så att den syns i alla typsnitt.
    expect(layoutOverprint(b.document, { course }).filter(f => f.role === "TRAINING" && f.kind === "polyline")).toHaveLength(2);
    // Tvärstreck i stället för text; utan träningen (före) inga figurer.
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ sections: [corridor("ANGULAR", { to: at32 }), { ...band, marker: { kind: "BAR" } }] }) } });
    expect(layoutOverprint(b.document, { course }).filter(f => f.role === "TRAINING").map(f => f.kind)).toEqual(["polyline"]);
    expect(layoutOverprint(b.document, { course, training: { off: true } }).some(f => f.role === "TRAINING")).toBe(false);
  });

  it("tonat och filter utanför", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ outside: { kind: "TINT", lighten: 0.7 }, sections: [corridor("SMOOTH")] }) } });
    expect(trainingMapPasses(b.document, { course })![1]!.lighten).toBe(0.7);
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ outside: { kind: "FILTER", filter: presetFilter("CONTOURS") }, sections: [corridor("SMOOTH")] }) } });
    expect(trainingMapPasses(b.document, { course })![1]!.filters.map(f => f.preset)).toEqual(["CONTOURS"]);
  });

  it("följer gafflingens varianter: en variant har sin korridor, alla grenar unionen", () => {
    const b = new Builder();
    b.control("START", 0, 0);
    const fork = b.control("NORMAL", 10, 0, "31");
    const left = b.control("NORMAL", 20, 10, "32");
    const right = b.control("NORMAL", 20, -10, "33");
    const join = b.control("NORMAL", 30, 0, "34");
    b.control("FINISH", 40, 0);
    const course = b.course("Gafflad");
    b.insert(course, fork);
    b.insert(course, join);
    const forkCc = ccOf(b.document, fork);
    b.edit({ type: "ADD_SPLIT", course, at: forkCc, kind: "FORK", branches: 2 });
    const branches = b.document.courseControls[forkCc]!.split!.branches;
    b.insert(course, left, branches[0]);
    b.insert(course, right, branches[1]);
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ outside: { kind: "WHITE" }, sections: [corridor("ANGULAR")] }) } });
    const all = trainingMapPasses(b.document, { course })![0]!.within[0]!;
    expect(inside(all, { x: 20, y: 10 })).toBe(true);
    expect(inside(all, { x: 20, y: -10 })).toBe(true);
    const codes = variations(b.document, course).map(v => v.code);
    expect(codes).toHaveLength(2);
    const first = trainingMapPasses(b.document, { course, variant: codes[0] })![0]!.within[0]!;
    expect(inside(first, { x: 20, y: 10 }) !== inside(first, { x: 20, y: -10 })).toBe(true);
  });

  it("fönster: cirkel eller kvadrat runt kontrollerna", () => {
    const { b, course } = lineCourse();
    const windowSection: TrainingSection = { id: "f", from: null, to: null, form: "WINDOW", window: { shape: "SQUARE", radiusMeters: 40 },
      filter: presetFilter("ALL"), marker: { kind: "NONE" } };
    const square = sectionRegion(b.document, course, undefined, windowSection);
    expect(inside(square, { x: 13.8, y: 3.8 })).toBe(true);
    expect(inside(square, { x: 15, y: 5 })).toBe(false);
    const round = sectionRegion(b.document, course, undefined, { ...windowSection, window: { shape: "CIRCLE", radiusMeters: 40 } });
    expect(inside(round, { x: 13.8, y: 3.8 })).toBe(false);
    expect(inside(round, { x: 13.5, y: 0 })).toBe(true);
  });

  it("utan karta: bältet är vitt", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ sections: [{ id: "n", from: null, to: null, form: "NO_MAP", bandMeters: 100,
      filter: presetFilter("ALL"), marker: { kind: "NONE" } }] }) } });
    const passes = trainingMapPasses(b.document, { course })!;
    expect(passes[0]!.white).toBe(true);
    expect(passes[1]!.white).toBeUndefined();
  });
});

describe("sista säkra (ADR-0192 beslut 5)", () => {
  it("en mindre ring i banans färg på sträckan; inte en kontroll (beskrivning, längd och kontroller orörda)", () => {
    const { b, course, controls } = lineCourse();
    const before = courseSummaries(b.document);
    const plain = layoutOverprint(b.document, { course });
    b.edit({ type: "PUT_TRAINING", attackPoints: { t1: { id: "t1", from: controls[2]!, to: controls[3]!, at: { x: 26, y: 4 } } },
      attackStyle: { sizeRatio: 0.6, style: "DASHED" } });
    const figures = layoutOverprint(b.document, { course });
    const ring = figures.find(f => f.ref === "attack:t1");
    const control = plain.find(f => f.role === "CONTROL" && f.kind === "circle");
    if (ring?.kind !== "circle" || control?.kind !== "circle") throw new Error("ringarna saknas");
    expect(ring.color).toBe("COURSE");
    expect(ring.diameter).toBeCloseTo(control.diameter * 0.6);
    expect(ring.lineWidth).toBeCloseTo(control.lineWidth);
    expect(ring.gaps).toHaveLength(12);
    expect(figures.length).toBe(plain.length + 1);
    expect(courseSummaries(b.document)).toEqual(before);
    expect(Object.keys(b.document.controls)).toHaveLength(5);
    b.edit({ type: "PUT_TRAINING", attackStyle: { sizeRatio: 0.5, style: "THIN" } });
    const thin = layoutOverprint(b.document, { course }).find(f => f.ref === "attack:t1");
    expect(thin?.kind === "circle" ? thin.lineWidth : 0).toBeCloseTo(control.lineWidth / 2);
    // En annan bana utan sträckan har ingen ring.
    const other = b.course("Kort");
    b.insert(other, controls[1]!);
    expect(layoutOverprint(b.document, { course: other }).some(f => f.ref === "attack:t1")).toBe(false);
    // Kontrollen tas bort: delen skrivs inte till .ppen.
    const removed = applyEdit(b.document, { type: "DELETE_CONTROL", control: controls[3]! }).document;
    expect(readPpen(writePpen(removed)).document.training?.attackPoints ?? {}).toEqual({});
  });
});
