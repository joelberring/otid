import { describe, expect, it } from "vitest";
import { formatClockTime, formatDayMonthTime, formatDuration, formatHourMinute, zonedDate } from "../src";

const ZONE = "Europe/Stockholm";

describe("formatDuration", () => {
  it("skriver m:ss under en timme och h:mm:ss från en timme, sekunder nedåt", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59_999)).toBe("0:59");
    expect(formatDuration(754_000)).toBe("12:34");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_723_900)).toBe("1:02:03");
  });
});

describe("klockslag och datum i tidszonen", () => {
  it("skriver klockslag med och utan sekunder med 24-timmarsklocka", () => {
    expect(formatClockTime("2026-10-05T22:30:15Z", ZONE)).toBe("00:30:15");
    expect(formatClockTime("inte en tid", ZONE)).toBe("–");
    expect(formatHourMinute("2026-10-05T22:30:15Z", ZONE)).toBe("00:30");
    expect(formatHourMinute(new Date("2026-10-05T16:02:00Z"), ZONE)).toBe("18:02");
  });

  it("skriver datum i tidszonen, och datum med klockslag", () => {
    expect(zonedDate("2026-10-05T22:30:00Z", ZONE)).toBe("2026-10-06");
    expect(zonedDate(new Date("2026-10-05T12:00:00Z"), "UTC")).toBe("2026-10-05");
    expect(formatDayMonthTime("2026-10-05T16:02:00Z", ZONE)).toBe("5 okt. 18:02");
    expect(formatDayMonthTime("2026-10-05T22:30:00Z", ZONE)).toBe("6 okt. 00:30");
    expect(formatDayMonthTime("x", ZONE)).toBe("–");
  });
});
