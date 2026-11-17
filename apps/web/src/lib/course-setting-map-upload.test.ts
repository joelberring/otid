import { describe, expect, it } from "vitest";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { controlsOutside } from "./course-setting-map-upload";

describe("controlsOutside", () => {
  it("räknar kontrollerna utanför den nya kartfilens yta", () => {
    const controls = { a: { at: { x: 10, y: 10 } }, b: { at: { x: 500, y: 10 } }, c: { at: { x: 50, y: -3 } } } as unknown as CourseSettingDocument["controls"];
    expect(controlsOutside({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { controls })).toBe(2);
    expect(controlsOutside({ minX: -10, minY: -10, maxX: 600, maxY: 100 }, { controls })).toBe(0);
  });
});
