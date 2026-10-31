import { describe, expect, it } from "vitest";
import { CourseSettingEditError } from "../src";

describe("kontraktet", () => {
  it("har felklassen", () => {
    expect(new CourseSettingEditError("INVALID", "x").code).toBe("INVALID");
  });
});
