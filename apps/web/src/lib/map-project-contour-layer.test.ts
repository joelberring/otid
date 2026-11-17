import { describe, expect, it } from "vitest";
import { contourLayerResolution } from "./map-project-contour-layer";

describe("contourLayerResolution", () => {
  it("en halv meter för ett vanligt utsnitt, grövre för en hel stor karta", () => {
    expect(contourLayerResolution(1678, 1559)).toBe(0.5);
    expect(contourLayerResolution(4000, 3500)).toBe(2);
    expect(contourLayerResolution(5000, 4000)).toBe(2);
    expect(contourLayerResolution(10000, 9000)).toBe(4);
  });
});
