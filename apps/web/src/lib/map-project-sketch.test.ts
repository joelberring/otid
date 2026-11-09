import { describe, expect, it } from "vitest";
import { simplifyStroke } from "./map-project-sketch";

/** ADR-0219 lagren fas 2: en linje på fri hand förenklas innan den sparas. */
describe("skisser", () => {
  it("behåller ändarna och hörnen, tar bort punkter på en nästan rak sträcka", () => {
    const wobble = Array.from({ length: 21 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 0.05 }));
    expect(simplifyStroke(wobble, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0.01 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    expect(simplifyStroke(corner, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(simplifyStroke([{ x: 1, y: 1 }], 0.1)).toEqual([{ x: 1, y: 1 }]);
  });
});
