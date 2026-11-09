import { describe, expect, it } from "vitest";
import { inTerm, isoWeek, suggestedTerm, termWeeks } from "../src";

describe("ADR-0221: terminens veckor", () => {
  it("ISO-veckan, också vid årsskiftet", () => {
    expect(isoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeek("2027-01-03")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2026-12-28")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 });
    expect(isoWeek("2026-11-09")).toEqual({ year: 2026, week: 46 });
  });

  it("veckorna från veckan med första dagen till veckan med sista", () => {
    const weeks = termWeeks("2027-01-07", "2027-01-20");
    expect(weeks).toEqual([
      { year: 2027, week: 1, monday: "2027-01-04", sunday: "2027-01-10" },
      { year: 2027, week: 2, monday: "2027-01-11", sunday: "2027-01-17" },
      { year: 2027, week: 3, monday: "2027-01-18", sunday: "2027-01-24" }
    ]);
    expect(termWeeks("2027-01-01", "2027-06-30")).toHaveLength(27);
    expect(termWeeks("2027-02-01", "2027-01-01")).toEqual([]);
    expect(termWeeks("2027-01-01", "2028-12-31")).toEqual([]);
  });

  it("i terminen och förslaget på termin", () => {
    expect(inTerm("2027-06-30", { startsOn: "2027-01-01", endsOn: "2027-06-30" })).toBe(true);
    expect(inTerm("2027-07-01", { startsOn: "2027-01-01", endsOn: "2027-06-30" })).toBe(false);
    expect(suggestedTerm("2026-11-09", { name: "VT" }, { name: "HT" })).toEqual({ name: "VT 2027", startsOn: "2027-01-01", endsOn: "2027-06-30" });
    expect(suggestedTerm("2026-05-09", { name: "VT" }, { name: "HT" })).toEqual({ name: "HT 2026", startsOn: "2026-08-01", endsOn: "2026-12-31" });
    expect(suggestedTerm("2027-03-02", { name: "VT" }, { name: "HT" })).toEqual({ name: "VT 2027", startsOn: "2027-01-01", endsOn: "2027-06-30" });
  });
});
