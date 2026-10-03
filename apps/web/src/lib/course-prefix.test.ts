import { describe, expect, it } from "vitest";
import { isStrictCoursePrefix } from "./course-prefix";

describe("TASK097 avkortad bana-gräns", () => {
  it("känner igen bara ett strikt, icke-tomt prefix inklusive upprepade kontrollkoder", () => {
    expect(isStrictCoursePrefix([31, 31, 42], [31, 31])).toBe(true);
    expect(isStrictCoursePrefix([31, 31, 42], [31, 42])).toBe(false);
    expect(isStrictCoursePrefix([31, 31, 42], [31, 31, 42])).toBe(false);
    expect(isStrictCoursePrefix([31, 31, 42], [])).toBe(false);
  });
});
