import { describe, expect, it } from "vitest";
import { MCP_OBJECTS_MAX_POINTS, MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS } from "@o-tid/contracts";
import { newMapFile, type MapObject } from "@o-tid/map-file";
import { newObject } from "@o-tid/map-revision";
import { loadProjectMap, runObjects, runPropose, type StoredObjectRow } from "../src/map-project-job-run";
import { mcpText } from "../src/mcp-text";

/**
 * Ägaren 2026-11-16: en starkare AI-koppling (hela geometrin på begäran, ytor med hål, klippning utan koordinater, större
 * ändringar i läget självständigt) som inte drar mer än den behöver (kompakta svar, tak för punkter per svar).
 */
const bytes = newMapFile({ symbolSet: "ISOM2017-2", scale: 15000, refPoint: { easting: 668000, northing: 6524000 }, declinationDegrees: 0 });
const empty = loadProjectMap(bytes, "ny.omap", "0".repeat(64), []);
const idOf = (code: string) => empty.symbolsByCode.get(code)!.id;
const square = (x: number, y: number, side: number) => [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];
const circle = (cx: number, cy: number, r: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(2 * Math.PI * i / n), y: cy + r * Math.sin(2 * Math.PI * i / n) }));
const row = (key: string, object: MapObject | undefined): StoredObjectRow => ({ objectKey: `n:${key}`, ref: null, state: { kind: "OBJECT", object: object! }, lastEditId: `edit-${key}` });
const now = new Date("2026-11-16T12:00:00Z");
const loaded = loadProjectMap(bytes, "ny.omap", "0".repeat(64), [
  row("berg", newObject("area", idOf("214"), circle(0, 0, 5, 400))),
  row("tomt", newObject("area", idOf("520"), square(0, -10, 20))),
  row("sjo", newObject("area", idOf("301"), circle(40, 0, 5, 3000))),
  row("sten", newObject("point", idOf("204"), [{ x: 1, y: 1 }]))
]);
type Listed = { key: string; rings?: number[][][]; vertices?: number; boxMm?: unknown; symbolName?: unknown };

describe("mcpText: koordinater på en rad", () => {
  it("är giltig JSON med samma innehåll och mycket kortare än indragen JSON för geometri", () => {
    const value = { total: 1, objects: [{ key: "n:a", rings: [[[1.5, 2], [3, 4], [5, 6]], [[7, 8], [9, 10], [11, 12]]], at: [1, 2], name: null, tags: ["a", "b"], empty: [], nested: {} }] };
    const out = mcpText(value);
    expect(JSON.parse(out)).toEqual(value);
    expect(out).toContain("[[1.5,2],[3,4],[5,6]]");
    expect(out).toContain('"at": [1,2]');
    const long = { rings: [circle(0, 0, 5, 500).map(point => [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100])] };
    expect(mcpText(long).length).toBeLessThan(JSON.stringify(long, null, 1).length / 2);
    expect(mcpText("text")).toBe("text");
    expect(JSON.parse(mcpText({ a: undefined, b: [undefined, { c: 1 }] }))).toEqual({ b: [null, { c: 1 }] });
  });
});

describe("list_objects: hela geometrin bara på begäran", () => {
  it("glesar till 40 punkter som förut och ger hela geometrin med max_points och keys", () => {
    const all = runObjects(loaded, {}).objects as Listed[];
    expect(all.find(object => object.key === "n:berg")!.rings![0]).toHaveLength(40);
    const exact = runObjects(loaded, { keys: ["n:berg"], maxPoints: 2000, brief: true });
    expect(exact).toMatchObject({ total: 1, returned: 1 });
    const berg = (exact.objects as Listed[])[0]!;
    expect(berg.rings![0]).toHaveLength(400);
    expect(berg.vertices).toBe(400);
    expect(berg.boxMm).toBeUndefined();
    expect(berg.symbolName).toBeUndefined();
  });
  it("håller svaret under punkttaket och säger var nästa anrop fortsätter", () => {
    const first = runObjects(loaded, { symbols: ["214", "301", "520"], maxPoints: 2000 });
    // Sjön (3000 punkter, glesad till 1500) och berghällen ryms; minst ett objekt kommer alltid med.
    const points = (first.objects as Listed[]).reduce((sum, object) => sum + (object.rings?.[0]?.length ?? 0), 0);
    expect(points).toBeLessThanOrEqual(MCP_OBJECTS_MAX_POINTS);
    expect(first.returned).toBe(3);
    const tight = runObjects(loaded, { symbols: ["214", "301"], maxPoints: 2000, limit: 1 });
    expect(tight).toMatchObject({ returned: 1, truncated: true, nextOffset: 1 });
  });
});

describe("propose_changes: hål, klippning och större ändringar", () => {
  it("lägger in en yta med hål", () => {
    const result = runPropose(loaded, [{ op: "add", symbol: "301", rings: [[[60, 0], [70, 0], [70, 10], [60, 10]], [[63, 3], [66, 3], [66, 6], [63, 6]]] }], now);
    if (result.status !== "ok") throw new Error(result.errors.join("; "));
    const state = result.edits[0]!.state;
    expect(state.kind === "OBJECT" && state.object.kind === "area" && state.object.rings.map(ring => ring.length)).toEqual([4, 4]);
  });
  it("avvisar både points och rings, och rings för en linje", () => {
    expect(runPropose(loaded, [{ op: "add", symbol: "301", points: [[0, 0], [1, 0], [1, 1]], rings: [[[0, 0], [1, 0], [1, 1]]] }], now)).toMatchObject({ status: "invalid" });
    expect(runPropose(loaded, [{ op: "add", symbol: "101", rings: [[[0, 0], [1, 0], [1, 1]]] }], now)).toMatchObject({ status: "invalid" });
    expect(runPropose(loaded, [{ op: "add", symbol: "301" }], now)).toMatchObject({ status: "invalid" });
  });
  it("subtract klipper en yta mot en annan utan koordinater", () => {
    const result = runPropose(loaded, [{ op: "subtract", key: "n:berg", by: ["n:tomt"] }], now);
    if (result.status !== "ok") throw new Error(result.errors.join("; "));
    expect(result.edits.map(edit => `${edit.key} ${edit.kind} ${edit.base}`)).toEqual(["n:berg RESHAPE edit-berg"]);
    const state = result.edits[0]!.state;
    if (state.kind !== "OBJECT" || state.object.kind !== "area") throw new Error("Ingen yta");
    // Tomten täcker x ≥ 0: kvar blir berghällens västra halva.
    expect(Math.max(...state.object.rings[0]!.map(point => point.x))).toBeCloseTo(0, 5);
    expect(Math.min(...state.object.rings[0]!.map(point => point.x))).toBeCloseTo(-5, 1);
  });
  it("subtract tar bort en yta som täcks helt och avvisar det som inte är ytor", () => {
    const inside = loadProjectMap(bytes, "ny.omap", "0".repeat(64), [row("litet", newObject("area", idOf("214"), square(2, 2, 2))), row("tomt", newObject("area", idOf("520"), square(0, 0, 10))),
      row("sten", newObject("point", idOf("204"), [{ x: 1, y: 1 }]))]);
    const gone = runPropose(inside, [{ op: "subtract", key: "n:litet", by: ["n:tomt"] }], now);
    expect(gone.status === "ok" && gone.edits.map(edit => edit.kind)).toEqual(["DELETE"]);
    expect(runPropose(inside, [{ op: "subtract", key: "n:litet", by: ["n:sten"] }], now)).toMatchObject({ status: "invalid" });
    expect(runPropose(inside, [{ op: "subtract", key: "n:sten", by: ["n:tomt"] }], now)).toMatchObject({ status: "invalid" });
    expect(runPropose(inside, [{ op: "subtract", key: "n:litet", by: ["n:litet"] }], now)).toMatchObject({ status: "invalid" });
  });
  it("500 m gäller för förslag, och läget självständigt får täcka mer men inte hur mycket som helst", () => {
    // 1:15 000: 100 mm är 1 500 m och 300 mm är 4 500 m.
    const wide = [{ op: "add" as const, symbol: "301", points: [[0, 0], [100, 0], [100, 100]] as [number, number][] }];
    expect(runPropose(loaded, wide, now)).toMatchObject({ status: "invalid", errors: [expect.stringContaining("500 × 500") as unknown] });
    expect(runPropose(loaded, wide, now, MCP_PROPOSAL_MAX_SIDE_M_AUTONOMOUS).status).toBe("ok");
    const huge = [{ op: "add" as const, symbol: "301", points: [[0, 0], [300, 0], [300, 300]] as [number, number][] }];
    expect(runPropose(loaded, huge, now, 1_000_000)).toMatchObject({ status: "invalid", errors: [expect.stringContaining("3000 × 3000") as unknown] });
  });
});
