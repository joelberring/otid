import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { objectBox, type ObjectKey } from "@o-tid/map-revision";
import { clearsUnder, underChanges } from "./map-project-fill-under";

/** Ägaren 2026-11-22 («berg hamnar ovanpå kvartersmark»). */
const symbol = (id: string, main: number) => [id, { id, code: { main, text: String(main) }, name: id } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("berg", 214), symbol("grönt", 406), symbol("kurva", 101), symbol("brant", 201), symbol("tomt", 520), symbol("sten", 204)]);
const square = (x: number, y: number, size: number): Path => [{ type: "M", x, y }, { type: "L", x: x + size, y }, { type: "L", x: x + size, y: y + size }, { type: "L", x, y: y + size }];
const area = (id: string, x: number, y: number, size: number): MapObject => ({ kind: "area", symbol: id, angle: 0, rings: [square(x, y, size)] });

describe("rensningen under tomtmark", () => {
  it("tar bort berg och grönt inuti, klipper det som sticker ut och lämnar kurvor och branter", () => {
    const objects: MapObject[] = [area("berg", 2, 2, 2), area("grönt", 5, 0, 10), { kind: "line", symbol: "kurva", path: [{ type: "M", x: 0, y: 5 }, { type: "L", x: 10, y: 5 }] },
      { kind: "line", symbol: "brant", path: [{ type: "M", x: 1, y: 1 }, { type: "L", x: 9, y: 1 }] }, { kind: "point", symbol: "sten", angle: 0, at: { x: 8, y: 8 } }];
    const keys: ObjectKey[] = objects.map((_, index) => `k${index}`);
    const changes = underChanges({ objects, boxes: objects.map(objectBox), keys, refs: new Map(), symbols },
      [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]]);
    expect(changes.map(change => [change.key, change.objects.length])).toEqual([["k0", 0], ["k1", 1], ["k4", 0]]);
    const clipped = changes[1]!.objects[0]!;
    expect(clipped.kind === "area" && Math.min(...clipped.rings[0]!.map(point => point.x))).toBeCloseTo(10, 6);
    expect(clearsUnder(symbols.get("tomt"))).toBe(true);
    expect(clearsUnder(symbols.get("grönt"))).toBe(false);
  });
});
