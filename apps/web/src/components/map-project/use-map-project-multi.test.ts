import type { MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { multiShape } from "./use-map-project-multi";

const zigzag: MapObject = { kind: "line", symbol: "s", path: Array.from({ length: 40 }, (_, i) => ({ type: i ? "L" : "M", x: i * 0.2, y: Math.sin(i / 4) * 2 + (i % 2) * 0.02 })) } as MapObject;

describe("flera markerade: förenkla och gör mjuk", () => {
  it("gör en tät linje mjuk med färre punkter och bågar", () => {
    const smooth = multiShape(zigzag, "smooth");
    expect(smooth?.kind).toBe("line");
    const path = smooth?.kind === "line" ? smooth.path : [];
    expect(path.some(command => command.type === "C")).toBe(true);
    expect(path.length).toBeLessThan(40);
  });
  it("förenklar en tät linje", () => {
    const simple = multiShape(zigzag, "simplify");
    expect(simple?.kind === "line" && simple.path.length < 40).toBe(true);
  });
  it("lämnar punkter orörda", () => {
    expect(multiShape({ kind: "point", symbol: "p", at: { x: 0, y: 0 } } as MapObject, "smooth")).toBeUndefined();
  });
});
