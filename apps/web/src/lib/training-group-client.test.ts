import { describe, expect, it } from "vitest";
import { repetitionDates } from "@o-tid/domain";
import { groupFailure, repetitionCount, weekdayOf } from "./training-group-client";

/** Steg 68: formulärets räkning av upprepningen stämmer med serverns (domänens `repetitionDates`). */
describe("träningsgruppens klient", () => {
  it("räknar tillfällena som servern", () => {
    for (const [first, last] of [["2027-01-12", "2027-01-12"], ["2027-01-12", "2027-02-09"], ["2027-01-12", "2027-02-08"], ["2026-10-20", "2026-12-15"]] as const) {
      expect(repetitionCount(first, last), `${first}–${last}`).toBe(repetitionDates({ weekday: weekdayOf(first), firstDate: first, lastDate: last })!.length);
    }
    expect(repetitionCount("2027-02-09", "2027-01-12")).toBe(0);
    expect(weekdayOf("2027-01-17")).toBe(7);
  });

  it("ger begripliga fel", () => {
    expect(groupFailure(401)).toMatch(/inte inloggad/);
    expect(groupFailure(500)).toMatch(/500/);
  });
});
