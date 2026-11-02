import { describe, expect, it } from "vitest";
import { applyDrawCommon, drawClassSummary, drawSelection, DRAW_COMMON_DEFAULT } from "./start-draw-common";
import type { DrawAdvanced } from "./start-draw-advanced";
import type { DrawRow } from "./start-draw";

const row = (selected: boolean): DrawRow => ({ method: "FREE", interval: "2", vacancies: "0", vacancyKind: "COUNT", selected });
const advanced: DrawAdvanced = { groupControls: "1", maxPerMinute: "", maxPerMinutePerPen: "", lastStart: "", seeding: "LAST",
  classOrder: null, laterStarts: { b: { kind: "OFFSET", value: "30" } }, seeds: {} };

describe("lottningens gemensamma inställningar (ADR-0188 beslut 1)", () => {
  it("lägger värdena på alla klasser och kryssar i dem", () => {
    const result = applyDrawCommon({ a: row(false), b: row(true) }, advanced,
      { ...DRAW_COMMON_DEFAULT, interval: " 3 ", vacancies: "2" }, "ALL");
    expect(result.count).toBe(2);
    expect(result.rows.a).toEqual({ method: "MINUTE", interval: "3", vacancies: "2", vacancyKind: "COUNT", selected: true });
    expect(result.rows.b!.selected).toBe(true);
    // Tom första start lämnar klassernas senare start orörd.
    expect(result.advanced).toBe(advanced);
  });

  it("lägger värdena bara på de ikryssade och sätter deras första start", () => {
    const result = applyDrawCommon({ a: row(false), b: row(true) }, advanced,
      { ...DRAW_COMMON_DEFAULT, method: "MASS", laterStart: "11:00" }, "SELECTED");
    expect(result.count).toBe(1);
    expect(result.rows.a).toEqual(row(false));
    expect(result.rows.b!.method).toBe("MASS");
    expect(result.advanced.laterStarts).toEqual({ b: { kind: "CLOCK", value: "11:00" } });
  });

  it("räknar ut kryssrutan för alla", () => {
    expect(drawSelection({ a: row(true), b: row(true) })).toBe("ALL");
    expect(drawSelection({ a: row(true), b: row(false) })).toBe("SOME");
    expect(drawSelection({ a: row(false) })).toBe("NONE");
  });

  it("sammanfattar en klass i förhandsvisningen", () => {
    const entry = { entryId: "e", name: "Alva Test", club: null, card: null, variantCode: null, seedRank: null };
    const summary = drawClassSummary({ classId: "a", className: "H21", method: "MINUTE", firstStartTime: "2026-12-02T09:00:00.000Z",
      intervalMinutes: 2, vacancyCount: 1, replacesStartTimes: false,
      slots: [{ startTime: "2026-12-02T09:04:00.000Z", entry }, { startTime: "2026-12-02T09:00:00.000Z", entry },
        { startTime: "2026-12-02T09:02:00.000Z", entry: null }] } as never);
    expect(summary).toMatchObject({ runners: 2, vacant: 1, firstStartTime: "2026-12-02T09:00:00.000Z", lastStartTime: "2026-12-02T09:04:00.000Z" });
  });
});
