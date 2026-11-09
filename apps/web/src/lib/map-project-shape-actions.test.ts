import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { circleFor, shapeActions, withRecent } from "./map-project-shape-actions";

describe("formens åtgärder", () => {
  it("förenklar en tät höjdkurva, gör den mjuk och har rak först när den har kurvor", () => {
    const dense: MapObject = { kind: "line", symbol: "101", path: Array.from({ length: 300 }, (_, i) => ({ type: i === 0 ? "M" as const : "L" as const,
      x: i * 0.04, y: Math.sin(i / 50) * 3 + (i % 2) * 0.01 })) };
    const actions = shapeActions(dense);
    expect(actions.map(action => action.id)).toEqual(["simplify", "simplifyMore", "smooth"]);
    expect(actions[0]!.message).toMatch(/^Förenklad: 300 → \d+ punkter\.$/);
    const smooth = actions.find(action => action.id === "smooth")!.result!;
    expect(shapeActions(smooth).map(action => action.id)).toContain("straighten");
    expect(shapeActions({ kind: "point", symbol: "1", at: { x: 0, y: 0 }, angle: 0 })).toEqual([]);
  });

  it("ritar cirklar med linje- och ytsymboler och minns de senaste symbolerna", () => {
    expect(circleFor("area", "406", { x: 0, y: 0 }, { x: 3, y: 4 })?.kind).toBe("area");
    expect(circleFor("point", "1", { x: 0, y: 0 }, { x: 3, y: 4 })).toBeUndefined();
    expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withRecent(Array.from({ length: 9 }, (_, i) => `s${i}`), "x")).toHaveLength(9);
  });
});
