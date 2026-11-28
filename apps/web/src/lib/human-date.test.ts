import { describe, expect, it } from "vitest";
import { dateTileParts, daysBefore, humanDate, monthHeading, recentDay } from "./human-date";

const ZONE = "Europe/Stockholm";

describe("humanDate", () => {
  it("säger datumet som människor gör, utan år i innevarande år", () => {
    expect(humanDate("2026-12-09", "sv", "2026-11-28")).toBe("ons 9 dec");
    expect(humanDate("2026-12-09", "en", "2026-11-28")).toBe("Wed 9 Dec");
    expect(humanDate("2026-05-14", "sv", "2026-11-28")).toBe("tors 14 maj");
  });

  it("lägger till året när det är ett annat år", () => {
    expect(humanDate("2024-10-15", "sv", "2026-11-28")).toBe("tis 15 okt 2024");
    expect(humanDate("2024-10-15", "en", "2026-11-28")).toBe("Tue 15 Oct 2024");
  });

  it("utan veckodag, och något som inte är ett datum kommer tillbaka orört", () => {
    expect(humanDate("2026-11-27", "sv", "2026-11-28", { weekday: false })).toBe("27 nov");
    expect(humanDate("2026-02-30", "sv", "2026-11-28")).toBe("2026-02-30");
    expect(humanDate("i går", "sv", "2026-11-28")).toBe("i går");
  });
});

describe("recentDay", () => {
  const now = new Date("2026-11-28T10:00:00Z");
  it("i dag, i går och annars datumet, räknat i tidszonen", () => {
    expect(recentDay("2026-11-28T06:00:00Z", "sv", ZONE, now)).toEqual({ kind: "today" });
    expect(recentDay("2026-11-27T08:00:00Z", "sv", ZONE, now)).toEqual({ kind: "yesterday" });
    expect(recentDay("2026-11-20T08:00:00Z", "sv", ZONE, now)).toEqual({ kind: "date", text: "20 nov" });
    expect(recentDay("2025-11-20T08:00:00Z", "en", ZONE, now)).toEqual({ kind: "date", text: "20 Nov 2025" });
  });

  it("strax efter midnatt svensk tid är det i dag, fast UTC-datumet är i går", () => {
    const justAfterMidnight = new Date("2026-11-27T23:30:00Z");
    expect(recentDay("2026-11-27T23:10:00Z", "sv", ZONE, justAfterMidnight)).toEqual({ kind: "today" });
    expect(recentDay("2026-11-27T22:50:00Z", "sv", ZONE, justAfterMidnight)).toEqual({ kind: "yesterday" });
  });
});

describe("daysBefore, dateTileParts och monthHeading", () => {
  it("räknar hela dagar över månadsskiften", () => {
    expect(daysBefore("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBefore("2026-11-01", "x")).toBeNull();
  });

  it("brickans delar och hela datumet för skärmläsare", () => {
    expect(dateTileParts("2026-12-09", "sv")).toEqual({ weekday: "ons", day: "9", month: "dec", year: "2026", full: "onsdag 9 december 2026" });
    expect(dateTileParts("2026-12-09", "en")?.full).toBe("Wednesday 9 December 2026");
    expect(dateTileParts("", "sv")).toBeNull();
  });

  it("månadens rubrik med stor bokstav", () => {
    expect(monthHeading("2026-11-03", "sv")).toBe("November 2026");
    expect(monthHeading("2026-05-03", "en")).toBe("May 2026");
  });
});
