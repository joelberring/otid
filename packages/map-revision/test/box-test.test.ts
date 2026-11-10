import type { MapObject, MapSymbol } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { boxTest } from "../src/hit";
import type { ObjectKey } from "../src/state";

const symbol = (hidden = false) => ({ hidden }) as unknown as MapSymbol;
const symbols = new Map<string, MapSymbol>([["s", symbol()], ["dold", symbol(true)]]);
const objects: MapObject[] = [
  { kind: "point", symbol: "s", at: { x: 5, y: 5 }, angle: 0 },
  { kind: "point", symbol: "s", at: { x: 50, y: 50 }, angle: 0 },
  // En linje som går tvärs igenom rutan utan att ha en punkt i den.
  { kind: "line", symbol: "s", path: [{ type: "M", x: -20, y: 6 }, { type: "L", x: 40, y: 6 }] },
  // En linje utanför.
  { kind: "line", symbol: "s", path: [{ type: "M", x: -20, y: 30 }, { type: "L", x: 40, y: 30 }] },
  // En stor yta som omsluter rutan (bakgrunden).
  { kind: "area", symbol: "s", angle: 0, rings: [[{ type: "M", x: -100, y: -100 }, { type: "L", x: 100, y: -100 }, { type: "L", x: 100, y: 100 }, { type: "L", x: -100, y: 100 }]] },
  // En liten yta vars sista kant (tillbaka till början) går genom rutan.
  { kind: "area", symbol: "s", angle: 0, rings: [[{ type: "M", x: 8, y: -5 }, { type: "L", x: 30, y: -5 }, { type: "L", x: 30, y: 20 }, { type: "L", x: 8, y: 20 }]] },
  { kind: "point", symbol: "dold", at: { x: 6, y: 6 }, angle: 0 }
];
const keys: ObjectKey[] = objects.map((_, index) => `b:${index}` as const);

describe("markera med en ruta", () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it("tar punkter i rutan och linjer och kanter som går genom den", () => {
    expect(boxTest({ objects, keys, symbols }, box)).toEqual(["b:0", "b:2", "b:5"]);
  });

  it("tar inte ytan som bara omsluter rutan, och inte dolda symboler", () => {
    const found = boxTest({ objects, keys, symbols }, box);
    expect(found).not.toContain("b:4");
    expect(found).not.toContain("b:6");
  });

  it("en ruta över allt tar allt som syns, upp till gränsen", () => {
    const all = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    expect(boxTest({ objects, keys, symbols }, all)).toHaveLength(6);
    expect(boxTest({ objects, keys, symbols }, all, 2)).toHaveLength(2);
  });
});
