import { describe, expect, it } from "vitest";
import type { RouteChoiceSettings } from "../src";

describe("RouteChoiceSettings", () => {
  it("har version 1", () => {
    const settings: RouteChoiceSettings = { version: 1 };
    expect(settings.version).toBe(1);
  });
});
