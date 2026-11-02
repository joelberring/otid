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

  it("tar banans utseende och etiketten (ADR-0180 beslut 12)", () => {
    const parse = (edit: unknown) => courseSettingEditSchema.safeParse(edit).success;
    expect(parse({ type: "SET_APPEARANCE", changes: { circleSize: 1.12, lineWidth: 1, numberSize: 0.75, itemScaling: "RelativeTo15000",
      autoLegGap: 0, circleGapsScaled: true } })).toBe(true);
    expect(parse({ type: "SET_APPEARANCE", changes: {} })).toBe(true);
    expect(parse({ type: "SET_APPEARANCE", changes: { itemScaling: "Twice" } })).toBe(false);
    expect(parse({ type: "SET_APPEARANCE", changes: { centerDot: 0.3 } })).toBe(false);
    expect(parse({ type: "UPDATE_COURSE", course: "3", changes: { labelKind: "SEQUENCE_AND_CODE" } })).toBe(true);
  });
});
