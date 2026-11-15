import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { edgePlan, edgeSymbolFor } from "./map-project-edge";

const catalog = [{ id: "a501", code: "501.0", kind: "area" }, { id: "l501", code: "501.1", kind: "line" }, { id: "l501b", code: "501.2", kind: "line" },
  { id: "a401", code: "401", kind: "area" }, { id: "l505", code: "505", kind: "line" }, { id: "hidden", code: "401.1", kind: "line", fileHidden: true }];
const symbols = new Map(catalog.map(symbol => [symbol.id, symbol]));
const ring = (x: number) => [{ type: "M" as const, x, y: 0 }, { type: "L" as const, x: x + 10, y: 0 }, { type: "L" as const, x: x + 10, y: 10 }, { type: "L" as const, x, y: 0 }];
const area = (symbol: string, rings = 1): MapObject => ({ kind: "area", symbol, rings: Array.from({ length: rings }, (_, i) => ring(i * 20)), angle: 0 }) as MapObject;

describe("kantlinje på en yta", () => {
  it("tar linjesymbolen med ytans nummer, annars den valda linjesymbolen", () => {
    expect(edgeSymbolFor(symbols.get("a501"), catalog, symbols.get("l505"))?.id).toBe("l501");
    expect(edgeSymbolFor(symbols.get("a401"), catalog, symbols.get("l505"))?.id).toBe("l505");
    expect(edgeSymbolFor(symbols.get("a401"), catalog, symbols.get("a501"))).toBeUndefined();
  });
  it("ger en linje per ring för varje markerad yta och hoppar över linjer och ytor utan kantsymbol", () => {
    const line = { kind: "line", symbol: "l505", path: ring(0) } as MapObject;
    const plan = edgePlan([area("a501", 2), area("a401"), line], symbols, catalog, undefined);
    expect(plan.areas).toBe(1); expect(plan.codes).toEqual(["501.1"]);
    expect(plan.made.map(object => [object.kind, object.symbol])).toEqual([["line", "l501"], ["line", "l501"]]);
    expect(edgePlan([area("a501"), area("a401")], symbols, catalog, symbols.get("l505"))).toMatchObject({ areas: 2, codes: ["501.1", "505"] });
  });
});
