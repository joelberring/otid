import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("ger singular för 1 och plural annars, med antalet först", () => {
    expect(plural(1, "bana", "banor")).toBe("1 bana");
    expect(plural(0, "bana", "banor")).toBe("0 banor");
    expect(plural(3, "bana", "banor")).toBe("3 banor");
  });
});
