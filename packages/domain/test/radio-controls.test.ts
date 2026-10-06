import { describe, expect, it } from "vitest";
import { radioClassStandings, radioPassage, type RadioRunner } from "../src";

/** Start 18:00:00 (ms); sekunder efter start. */
const START = Date.UTC(2026, 9, 8, 16, 0, 0);
const at = (seconds: number) => START + seconds * 1_000;
const runner = (key: string, punches: [number, number][], extra: Partial<RadioRunner> = {}): RadioRunner =>
  ({ key, startMs: START, punches: punches.map(([controlCode, second]) => ({ controlCode, punchedAtMs: at(second) })), ...extra });
const view = (standings: ReturnType<typeof radioClassStandings>, code: number) =>
  standings.controls.find(row => row.controlCode === code)!.passages.map(row => [row.key, row.elapsedMs, row.place, row.source]);

describe("mellantider vid radiokontroll (ADR-0172 beslut 5)", () => {
  it("ger tid sedan start från startlistan och placering i klassen", () => {
    const standings = radioClassStandings([runner("a", [[31, 450]]), runner("b", [[31, 440]]),
      runner("c", [[31, 500]], { startMs: at(-120) })], [31]);
    expect(view(standings, 31)).toEqual([["b", 440_000, 1, "RADIO"], ["a", 450_000, 2, "RADIO"], ["c", 620_000, 3, "RADIO"]]);
    expect(standings.onTheWay.map(row => [row.key, row.controlCode, row.place])).toEqual([["b", 31, 1], ["a", 31, 2], ["c", 31, 3]]);
  });

  it("delar placering vid lika tid på hela sekunder", () => {
    const tied = radioClassStandings([runner("a", [[31, 450]]), { ...runner("b", []), punches: [{ controlCode: 31, punchedAtMs: at(450) + 400 }] },
      runner("c", [[31, 451]])], [31]);
    expect(view(tied, 31).map(row => [row[0], row[2]])).toEqual([["a", 1], ["b", 1], ["c", 3]]);
  });

  it("räknar avlästa med avläsningens tid och placerar bara godkända", () => {
    const finished = (status: string, splits: [number, number][]) =>
      ({ finished: { status, splits: splits.map(([controlCode, second]) => ({ controlCode, elapsedMs: second * 1_000 })) } });
    const standings = radioClassStandings([
      runner("klar", [[31, 455]], finished("OK", [[31, 452], [32, 900]])),
      runner("felst", [[31, 400]], finished("MP", [[31, 400]])),
      runner("ute", [[31, 460]]),
      // Avläst utan stämpling vid 31 men med radiostämpling: radiotiden används.
      runner("radio", [[31, 470]], finished("OK", [[32, 950]]))], [31]);
    expect(view(standings, 31)).toEqual([["klar", 452_000, 1, "READOUT"], ["ute", 460_000, 2, "RADIO"], ["radio", 470_000, 3, "RADIO"],
      ["felst", 400_000, null, "READOUT"]]);
    // Bara den som inte är avläst är på väg in.
    expect(standings.onTheWay.map(row => row.key)).toEqual(["ute"]);
  });

  it("hoppar över stämplingar före start och tar den första efter start", () => {
    expect(radioPassage(runner("a", [[31, -30], [31, 500], [31, 450]]), 31)).toMatchObject({ elapsedMs: 450_000, passedAtMs: at(450) });
    expect(radioPassage(runner("a", [[31, -30]]), 31)).toBeUndefined();
    expect(radioPassage(runner("a", [[32, 30]]), 31)).toBeUndefined();
  });

  it("visar passagen utan tid och placering när starttiden saknas", () => {
    const standings = radioClassStandings([runner("fri", [[31, 300]], { startMs: null }), runner("a", [[31, 450]])], [31]);
    expect(view(standings, 31)).toEqual([["a", 450_000, 1, "RADIO"], ["fri", null, null, "RADIO"]]);
    expect(standings.onTheWay.find(row => row.key === "fri")).toMatchObject({ passedAtMs: at(300), elapsedMs: null, place: null });
  });

  it("visar den senaste passagen för den som är på väg, längst fram på banan först", () => {
    const standings = radioClassStandings([runner("a", [[31, 450], [50, 1200]]), runner("b", [[31, 400]]),
      runner("c", [[31, 430], [50, 1300]])], [31, 50]);
    expect(standings.onTheWay.map(row => [row.key, row.controlCode, row.place])).toEqual([["a", 50, 1], ["c", 50, 2], ["b", 31, 1]]);
    expect(view(standings, 50).map(row => row[0])).toEqual(["a", "c"]);
    // Samma kod två gånger i listan räknas en gång.
    expect(radioClassStandings([runner("a", [[31, 450]])], [31, 31]).controls).toHaveLength(1);
  });
});
