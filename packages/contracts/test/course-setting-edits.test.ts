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
});
