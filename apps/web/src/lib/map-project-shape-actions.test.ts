import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { vertexCount } from "@o-tid/map-revision";
import { circleFor, rememberSimplify, shapeActions, withRecent, type ShapeAction, type SimplifyMemory } from "./map-project-shape-actions";

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

  it("Förenkla mer går stegvis: varje tryck ger färre punkter tills beskedet säger att det inte går (ägaren 2026-11-23)", () => {
    let object: MapObject = { kind: "line", symbol: "101", path: Array.from({ length: 400 }, (_, i) => ({ type: i === 0 ? "M" as const : "L" as const,
      x: i * 0.02, y: Math.sin(i / 25) * 1.2 + Math.sin(i * 1.3) * 0.04 })) };
    const memory: SimplifyMemory = new Map(), counts = [vertexCount(object)];
    for (let press = 0; press < 30; press += 1) {
      const more: ShapeAction = shapeActions(object, undefined, { memory, key: "n:1" }).find(action => action.id === "simplifyMore")!;
      if (!more.result) { expect(more.message).toBe("Kan inte förenkla mer utan att ändra formen för mycket."); break; }
      rememberSimplify(memory, "n:1", more.step!);
      object = more.result; counts.push(vertexCount(object));
    }
    expect(counts.length).toBeGreaterThanOrEqual(3);
    counts.forEach((count, index) => { if (index > 0) expect(count).toBeLessThan(counts[index - 1]!); });
    // Ett objekt som ändrats på annat sätt (annat antal punkter) börjar om från grundsteget.
    expect(shapeActions(object, undefined, { memory, key: "n:2" })[0]!.step?.tolerance ?? 0.05).toBeGreaterThanOrEqual(0.05);
  });

  it("ritar cirklar med linje- och ytsymboler och minns de senaste symbolerna", () => {
    expect(circleFor("area", "406", { x: 0, y: 0 }, { x: 3, y: 4 })?.kind).toBe("area");
    expect(circleFor("point", "1", { x: 0, y: 0 }, { x: 3, y: 4 })).toBeUndefined();
    expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withRecent(Array.from({ length: 9 }, (_, i) => `s${i}`), "x")).toHaveLength(9);
  });
});
