import { describe, expect, it } from "vitest";
import { courseSettingEditSchema } from "../src/course-setting-collaboration";

/** Steg 66: åtgärderna som sparas en och en; ringklippens val och fasta klipp (ADR-0180 beslut 10) ska gå igenom. */
describe("banläggningens åtgärder", () => {
  it("tar ringklippens val och fasta klipp", () => {
    expect(courseSettingEditSchema.safeParse({ type: "SET_EVENT", changes: { circleCutting: { overlap: true, details: false } } }).success).toBe(true);
    expect(courseSettingEditSchema.safeParse({ type: "SET_CIRCLE_GAPS", control: "1",
      gaps: [{ scale: null, startDegrees: 10, endDegrees: 40 }, { scale: 10000, startDegrees: 200, endDegrees: 220 }] }).success).toBe(true);
  });

  it("avvisar okända fält", () => {
    expect(courseSettingEditSchema.safeParse({ type: "SET_EVENT", changes: { circleCutting: { overlap: true, details: false, extra: 1 } } }).success)
      .toBe(false);
    expect(courseSettingEditSchema.safeParse({ type: "SET_EVENT", changes: { colour: "red" } }).success).toBe(false);
  });

  it("tar specialobjekten och tryckytan (steg 64)", () => {
    const ok = (edit: unknown) => expect(courseSettingEditSchema.safeParse(edit).success, JSON.stringify(edit)).toBe(true);
    ok({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], courses: ["1"] } });
    ok({ type: "ADD_SPECIAL", special: { kind: "text", points: [{ x: 0, y: 10 }, { x: 40, y: 0 }], text: "$(CourseName)",
      font: { name: "Arial", bold: true, italic: false, height: 4 }, color: "black" } });
    ok({ type: "MOVE_SPECIAL", special: "3", points: [{ x: 1, y: 2 }] });
    ok({ type: "UPDATE_SPECIAL", special: "3", changes: { courses: ["0", "2"], line: { kind: "dashed", width: 0.35, gapSize: 1, dashSize: 2 } } });
    ok({ type: "DELETE_SPECIAL", special: "3" });
    ok({ type: "SET_PRINT_AREA", course: "ALL_CONTROLS", area: { automatic: false, restrictToPageSize: true,
      rect: { minX: -10, minY: 0, maxX: 100, maxY: 80 }, page: { width: 1169, height: 827, margins: 28, landscape: true } } });
    ok({ type: "SET_PRINT_AREA", course: "2", area: null });
    ok({ type: "SET_EVENT", changes: { allControlsPrintScale: 10000, printProfileId: "kontoret" } });
    ok({ type: "PUT_PRINT_PROFILE", profile: { schemaVersion: 1, id: "kontoret", name: "Kontoret", mapColors: [] } });
    ok({ type: "DELETE_LAYOUT_TEMPLATE", id: "mina" });
    expect(courseSettingEditSchema.safeParse({ type: "ADD_SPECIAL", special: { kind: "unicorn", points: [{ x: 0, y: 0 }] } }).success).toBe(false);
  });

  it("tar passagens vinkel och kopian av en bana (ADR-0180 beslut 14)", () => {
    const parse = (edit: unknown) => courseSettingEditSchema.safeParse(edit).success;
    expect(parse({ type: "SET_CONTROL_ORIENTATION", control: "4", orientation: 37.5 })).toBe(true);
    expect(parse({ type: "SET_CONTROL_ORIENTATION", control: "4", orientation: "37" })).toBe(false);
    expect(parse({ type: "DUPLICATE_COURSE", course: "2", name: "Lång (kopia)" })).toBe(true);
    expect(parse({ type: "DUPLICATE_COURSE", course: "2" })).toBe(false);
  });

  it("tar banans utseende och etiketten (ADR-0180 beslut 12)", () => {
    const parse = (edit: unknown) => courseSettingEditSchema.safeParse(edit).success;
    expect(parse({ type: "SET_APPEARANCE", changes: { circleSize: 1.12, lineWidth: 1, numberSize: 0.75, itemScaling: "RelativeTo15000",
      autoLegGap: 0, circleGapsScaled: true } })).toBe(true);
    expect(parse({ type: "SET_APPEARANCE", changes: {} })).toBe(true);
    expect(parse({ type: "SET_APPEARANCE", changes: { itemScaling: "Twice" } })).toBe(false);
    expect(parse({ type: "SET_APPEARANCE", changes: { centerDot: 0.3 } })).toBe(false);
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { labelKind: "SEQUENCE_AND_CODE" } })).toBe(true);
  });

  it("tar banans egenskaper, poängen och ordningen (ADR-0190)", () => {
    const parse = (edit: unknown) => courseSettingEditSchema.safeParse(edit).success;
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { climbMeters: 85, lengthOverrideMeters: null, kind: "SCORE", order: 2 } })).toBe(true);
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { climbMeters: null } })).toBe(true);
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { kind: "RELAY" } })).toBe(false);
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { order: 0 } })).toBe(false);
    expect(parse({ type: "SET_POINTS", course: "3", courseControl: "7", points: 30 })).toBe(true);
    expect(parse({ type: "SET_POINTS", course: "3", courseControl: "7", points: null })).toBe(true);
    expect(parse({ type: "SET_POINTS", course: "3", courseControl: "7", points: 2.5 })).toBe(false);
    expect(parse({ type: "PUT_OBJECTS", courseOrder: { "1": 2, "2": 1 } })).toBe(true);
    expect(parse({ type: "PUT_OBJECTS", courseOrder: { "1": 1.5 } })).toBe(false);
  });

  it("tar träningens delar och ångra med träningen (ADR-0192 beslut 11)", () => {
    const parse = (edit: unknown) => courseSettingEditSchema.safeParse(edit).success;
    expect(parse({ type: "PUT_TRAINING", courses: { "1": { outside: { kind: "WHITE" }, sections: [] } }, attackStyle: { sizeRatio: 0.6, style: "SOLID" } })).toBe(true);
    expect(parse({ type: "PUT_TRAINING", areas: { t1: null }, attackPoints: { t2: null }, attackStyle: null })).toBe(true);
    expect(parse({ type: "PUT_TRAINING", courses: { "1": "korridor" } })).toBe(false);
    expect(parse({ type: "PUT_TRAINING", other: {} })).toBe(false);
    expect(parse({ type: "PUT_OBJECTS", training: { courses: { "1": null } } })).toBe(true);
    expect(parse({ type: "PUT_OBJECTS", training: { lines: {} } })).toBe(false);
  });

  it("tar Layout-flikens ändringar (ADR-0217)", () => {
    const ok = (edit: unknown) => expect(courseSettingEditSchema.safeParse(edit).success, JSON.stringify(edit)).toBe(true);
    const page = { width: 1169, height: 1654, margins: 28, landscape: true };
    ok({ type: "ADD_LAYOUT", layout: { id: "elit", name: "Elit A3", scale: 15000, page } });
    ok({ type: "UPDATE_LAYOUT", layout: "MAIN", changes: { name: "Huvud", layoutTemplate: null } });
    ok({ type: "UPDATE_LAYOUT", layout: "elit", changes: { scale: 10000, page, paperTemplate: "mall" } });
    ok({ type: "DELETE_LAYOUT", layout: "elit" });
    ok({ type: "PUT_LAYOUT_SHEET", layout: "elit", course: "3", sheet: {} });
    ok({ type: "SET_LAYOUT_CIRCLE_GAPS", layout: "elit", control: "4", gaps: [{ startDegrees: 10, endDegrees: 40 }] });
    ok({ type: "CLEAR_LAYOUT_ADJUSTMENTS", layout: "elit", course: "3" });
    ok({ type: "SET_LAYOUT_LEG_GAPS", layout: "elit", from: "4", to: "5", gaps: [{ start: 3, length: 1.5 }] });
    ok({ type: "SET_CLASS_LAYOUTS", classes: { H21: "elit", D21: null } });
    ok({ type: "SAVE_LAYOUT_STATE", id: "s1", name: "Före provtryck", savedAt: "2026-11-07T10:00:00.000Z" });
    ok({ type: "RESTORE_LAYOUT_STATE", id: "s1" });
    ok({ type: "DELETE_LAYOUT_STATE", id: "s1" });
    ok({ type: "MOVE_NUMBER", course: "3", courseControl: "7", at: { x: 1, y: 2 }, printLayout: "elit" });
    ok({ type: "SET_PRINT_AREA", course: "3", area: null, printLayout: "elit" });
    ok({ type: "SET_PAPER_LAYOUT", course: "3", layout: null, part: 1, printLayout: "elit" });
    expect(courseSettingEditSchema.safeParse({ type: "SET_LAYOUT_CIRCLE_GAPS", layout: "elit", control: "4", gaps: [{ scale: 1, startDegrees: 1, endDegrees: 2 }] }).success).toBe(false);
  });
});
