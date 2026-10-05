import { describe, expect, it } from "vitest";
import { buildSplitTable, type SplitTableRunner } from "../src";

const runner = (key: string, ok: boolean, legs: [number, number][], finishMs?: number): SplitTableRunner => {
  let elapsed = 0;
  const splits = legs.map(([controlCode, legMs]) => { elapsed += legMs; return { controlCode, occurrence: 1, legMs, elapsedMs: elapsed }; });
  return { key, ok, splits, ...(finishMs === undefined ? {} : { elapsedMs: elapsed + finishMs }) };
};

describe("sträcktidstabell", () => {
  it("ger placering per sträcka, delad plats vid lika tid och bästa sträcka", () => {
    const table = buildSplitTable([
      runner("a", true, [[31, 60_000], [32, 90_000]], 20_000),
      runner("b", true, [[31, 50_000], [32, 90_000]], 25_000),
      runner("c", true, [[31, 70_000], [32, 80_000]], 20_000)
    ]);
    expect(table.columns).toEqual([
      { kind: "CONTROL", controlCode: 31, occurrence: 1 }, { kind: "CONTROL", controlCode: 32, occurrence: 1 }, { kind: "FINISH" }]);
    expect(table.rows.map(row => row.cells.map(cell => cell?.place))).toEqual([[2, 2, 1], [1, 2, 3], [3, 1, 1]]);
    expect(table.rows[1]!.cells[0]).toEqual({ legMs: 50_000, elapsedMs: 50_000, place: 1, best: true });
    expect(table.rows[0]!.cells[2]).toEqual({ legMs: 20_000, elapsedMs: 170_000, place: 1, best: true });
  });

  it("jämför bara godkända; en felstämplad visar sina tider utan placering och tom ruta för missad kontroll", () => {
    const table = buildSplitTable([
      runner("mp", false, [[31, 40_000]], 30_000),
      runner("ok", true, [[31, 60_000], [32, 60_000]], 20_000)
    ]);
    expect(table.columns.map(column => column.kind === "CONTROL" ? column.controlCode : "MÅL")).toEqual([31, 32, "MÅL"]);
    expect(table.rows[0]!.cells).toEqual([{ legMs: 40_000, elapsedMs: 40_000, place: null, best: false }, null,
      { legMs: 30_000, elapsedMs: 70_000, place: null, best: false }]);
    expect(table.rows[1]!.cells[0]!.place).toBe(1);
  });

  it("skiljer på upprepad kontroll och saknar mål utan totaltid", () => {
    const table = buildSplitTable([{ key: "a", ok: false, splits: [
      { controlCode: 31, occurrence: 1, legMs: 10_000, elapsedMs: 10_000 },
      { controlCode: 31, occurrence: 2, legMs: 20_000, elapsedMs: 30_000 }] }]);
    expect(table.columns).toHaveLength(3);
    expect(table.rows[0]!.cells[2]).toBeNull();
  });
});
