import { describe, expect, it } from "vitest";
import { buildSplitTable, sortByTotalLoss, sortSplitRows, splitTablesByVariant, type SplitTableRunner } from "../src";

/** En löpare med sträckor [kontroll, sträcktid] och tid sista kontroll–mål. */
const runner = (key: string, ok: boolean, legs: [number, number][], finishMs?: number): SplitTableRunner => {
  let elapsed = 0;
  const splits = legs.map(([controlCode, legMs]) => { elapsed += legMs; return { controlCode, occurrence: 1, legMs, elapsedMs: elapsed }; });
  return { key, ok, splits, ...(finishMs === undefined ? {} : { elapsedMs: elapsed + finishMs }) };
};
const places = (table: ReturnType<typeof buildSplitTable>) => table.rows.map(row => row.cells.map(cell => cell?.place ?? null));

describe("sträcktidsanalys", () => {
  it("ger sträcktid, placering, totaltid med placering, bästa sträcka och förlust", () => {
    const table = buildSplitTable([
      runner("a", true, [[31, 60_000], [32, 90_000]], 20_000),
      runner("b", true, [[31, 50_000], [32, 90_000]], 25_000),
      runner("c", true, [[31, 70_000], [32, 80_000]], 20_000)
    ]);
    expect(table.columns.map(column => column.leg)).toEqual(["S-31.1", "31.1-32.1", "32.1-F"]);
    expect(table.columns.map(column => column.bestLegMs)).toEqual([50_000, 80_000, 20_000]);
    // Delad plats vid lika tid (1, 1, 3), både på sträckan och totalt.
    expect(places(table)).toEqual([[2, 2, 1], [1, 2, 3], [3, 1, 1]]);
    expect(table.rows.map(row => row.cells[1]!.elapsedPlace)).toEqual([2, 1, 2]);
    expect(table.rows[1]!.cells[0]).toEqual({ legMs: 50_000, elapsedMs: 50_000, place: 1, elapsedPlace: 1, best: true, lossMs: 0 });
    expect(table.rows[0]!.cells[2]).toMatchObject({ legMs: 20_000, elapsedMs: 170_000, place: 1, best: true, lossMs: 0 });
    expect(table.rows[0]!.cells[0]!.lossMs).toBe(10_000);
    // Tidsförlust: a 10 + 10 + 0 = 20 s, b 0 + 10 + 5 = 15 s, c 20 + 0 + 0 = 20 s. Idealtid 50 + 80 + 20.
    expect(table.rows.map(row => row.totalLossMs)).toEqual([20_000, 15_000, 20_000]);
    expect(table.idealMs).toBe(150_000);
    expect(sortByTotalLoss(table)).toEqual([1, 0, 2]);
  });

  it("delar bästa sträcka vid lika tid och märker båda", () => {
    const table = buildSplitTable([runner("a", true, [[31, 60_000]], 10_000), runner("b", true, [[31, 60_000]], 12_000)]);
    expect(table.rows.map(row => [row.cells[0]!.place, row.cells[0]!.best])).toEqual([[1, true], [1, true]]);
    expect(table.rows[1]!.cells[1]).toMatchObject({ place: 2, best: false, lossMs: 2_000 });
  });

  it("felstämplad: inga placeringar, tider och förlust visas, okänd sträcka efter missad kontroll", () => {
    const table = buildSplitTable([
      runner("ok", true, [[31, 60_000], [32, 60_000], [33, 60_000]], 20_000),
      // Missade 32: tiden vid 33 finns men sträckan 32–33 är okänd; sträckan 33–mål räknas.
      { key: "mp", ok: false, elapsedMs: 160_000, splits: [
        { controlCode: 31, occurrence: 1, legMs: 50_000, elapsedMs: 50_000 },
        { controlCode: 33, occurrence: 1, legMs: 90_000, elapsedMs: 140_000 }] }
    ]);
    expect(table.columns.map(column => column.leg)).toEqual(["S-31.1", "31.1-32.1", "32.1-33.1", "33.1-F"]);
    const mp = table.rows[1]!;
    expect(mp.cells[0]).toEqual({ legMs: 50_000, elapsedMs: 50_000, place: null, elapsedPlace: null, best: false, lossMs: -10_000 });
    expect(mp.cells[1]).toBeNull();
    expect(mp.cells[2]).toMatchObject({ legMs: null, elapsedMs: 140_000, place: null, lossMs: null });
    expect(mp.cells[3]).toMatchObject({ legMs: 20_000, lossMs: 0 });
    expect(mp.totalLossMs).toBeNull();
    // Den felstämplade är snabbast på första sträckan men påverkar inte bästa sträcka.
    expect(table.rows[0]!.cells[0]).toMatchObject({ place: 1, best: true, lossMs: 0 });
    expect(table.columns[0]!.bestLegMs).toBe(60_000);
  });

  it("stämpling före start: kontrollen saknar tid och nästa sträcka är okänd även för en godkänd", () => {
    const table = buildSplitTable([
      runner("a", true, [[31, 60_000], [32, 60_000]], 20_000),
      { key: "b", ok: true, elapsedMs: 150_000, splits: [{ controlCode: 32, occurrence: 1, legMs: 130_000, elapsedMs: 130_000 }] }
    ]);
    expect(table.rows[1]!.cells[0]).toBeNull();
    expect(table.rows[1]!.cells[1]).toMatchObject({ legMs: null, elapsedMs: 130_000, place: null, elapsedPlace: 2 });
    expect(table.rows[0]!.cells[1]).toMatchObject({ legMs: 60_000, place: 1, best: true });
  });

  it("lägger en kontroll som bara en löpare har efter sin föregångare och skiljer på upprepad kontroll", () => {
    const table = buildSplitTable([
      { key: "a", ok: true, elapsedMs: 40_000, splits: [
        { controlCode: 31, occurrence: 1, legMs: 10_000, elapsedMs: 10_000 }, { controlCode: 33, occurrence: 1, legMs: 20_000, elapsedMs: 30_000 }] },
      { key: "b", ok: false, splits: [
        { controlCode: 31, occurrence: 1, legMs: 10_000, elapsedMs: 10_000 }, { controlCode: 32, occurrence: 1, legMs: 10_000, elapsedMs: 20_000 },
        { controlCode: 31, occurrence: 2, legMs: 10_000, elapsedMs: 30_000 }] }
    ]);
    expect(table.columns.map(column => column.leg)).toEqual(["S-31.1", "31.1-32.1", "32.1-31.2", "31.2-33.1", "33.1-F"]);
    expect(table.rows[1]!.cells[4]).toBeNull();
  });

  it("sorterar på en sträcka eller totaltid bland alla med tiden; lika tid och rader utan tid behåller ordningen", () => {
    const table = buildSplitTable([
      runner("a", true, [[31, 60_000], [32, 50_000]], 20_000),
      runner("b", true, [[31, 50_000], [32, 70_000]], 20_000),
      { key: "c", ok: false, elapsedMs: 100_000, splits: [{ controlCode: 32, occurrence: 1, legMs: 80_000, elapsedMs: 80_000 }] },
      runner("d", true, [[31, 50_000], [32, 80_000]], 20_000)
    ]);
    expect(sortSplitRows(table, null)).toEqual([0, 1, 2, 3]);
    expect(sortSplitRows(table, { column: 0, by: "LEG" })).toEqual([1, 3, 0, 2]);
    expect(sortSplitRows(table, { column: 1, by: "LEG" })).toEqual([0, 1, 3, 2]);
    // Den felstämplade (c) har ingen tid vid 31 och därför ingen sträcka 31–32, men totaltiden vid 32 sorteras med.
    expect(sortSplitRows(table, { column: 1, by: "ELAPSED" })).toEqual([2, 0, 1, 3]);
    expect(sortSplitRows(table, { column: 2, by: "LEG" })).toEqual([0, 1, 2, 3]);
  });

  it("gafflad klass: en tabell per variant, sträckor jämförs bara inom varianten", () => {
    const groups = splitTablesByVariant([
      { ...runner("a", true, [[31, 60_000], [33, 60_000]], 10_000), variant: "AB" },
      { ...runner("b", true, [[32, 40_000], [33, 90_000]], 10_000), variant: "BA" },
      { ...runner("c", true, [[31, 50_000], [33, 70_000]], 10_000), variant: "AB" }
    ]);
    expect(groups.map(group => [group.variant, group.keys])).toEqual([["AB", ["a", "c"]], ["BA", ["b"]]]);
    expect(groups[0]!.table.columns.map(column => column.leg)).toEqual(["S-31.1", "31.1-33.1", "33.1-F"]);
    expect(groups[1]!.table.columns.map(column => column.leg)).toEqual(["S-32.1", "32.1-33.1", "33.1-F"]);
    // 31–33 och 32–33 slutar på samma kontroll men är olika sträckor: b är bäst på sin.
    expect(groups[1]!.table.rows[0]!.cells[1]).toMatchObject({ place: 1, best: true });
    expect(groups[0]!.table.rows[1]!.cells[0]).toMatchObject({ place: 1, best: true });
  });

  it("utan sträcktider: bara mål, och ingen idealtid när ingen godkänd finns", () => {
    const table = buildSplitTable([{ key: "a", ok: false, splits: [] }]);
    expect(table.columns).toEqual([{ kind: "FINISH", leg: "S-F", bestLegMs: null }]);
    expect(table.rows[0]!.cells).toEqual([null]);
    expect(table.idealMs).toBeNull();
  });
});
