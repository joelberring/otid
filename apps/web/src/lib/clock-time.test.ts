import { describe, expect, it } from "vitest";
import { formatClockTime, formatDuration, parseRaceClock, zonedDate } from "./clock-time";

describe("klockslag", () => {
  it("visar tiden i tävlingens tidszon som HH:MM:SS", () => {
    expect(formatClockTime("2026-10-08T16:05:09.000Z", "Europe/Stockholm")).toBe("18:05:09");
    expect(formatClockTime("2026-12-08T23:30:00.000Z", "Europe/Stockholm")).toBe("00:30:00");
    expect(formatClockTime("inte en tid", "Europe/Stockholm")).toBe("–");
  });

  it("ger datumet i tävlingens tidszon", () => {
    expect(zonedDate("2026-12-08T23:30:00.000Z", "Europe/Stockholm")).toBe("2026-12-09");
  });

  it("tolkar ett klockslag på tävlingsdagen i tävlingens tidszon", () => {
    expect(parseRaceClock("2026-10-08", "18:00", "Europe/Stockholm")).toBe("2026-10-08T16:00:00.000Z");
    expect(parseRaceClock("2026-12-08", "18:00:30", "Europe/Stockholm")).toBe("2026-12-08T17:00:30.000Z");
    expect(parseRaceClock(" 2026-12-08 ", " 9.05 ", "Europe/Stockholm")).toBe("2026-12-08T08:05:00.000Z");
    expect(parseRaceClock("2026-10-08", "18:00", "UTC")).toBe("2026-10-08T18:00:00.000Z");
  });

  it("hanterar övergångarna till sommar- och vintertid", () => {
    expect(parseRaceClock("2026-03-29", "02:30", "Europe/Stockholm")).toBeNull();
    expect(parseRaceClock("2026-10-25", "02:30", "Europe/Stockholm")).toBe("2026-10-25T00:30:00.000Z");
  });

  it("avvisar ogiltiga klockslag", () => {
    for (const clock of ["", "24:00", "12:60", "12", "kl 12", "12:00:61"]) {
      expect(parseRaceClock("2026-10-08", clock, "Europe/Stockholm")).toBeNull();
    }
    expect(parseRaceClock("08-10-2026", "12:00", "Europe/Stockholm")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("visar m:ss eller h:mm:ss utan millisekunder", () => {
    expect(formatDuration(257_000)).toBe("4:17");
    expect(formatDuration(257_999)).toBe("4:17");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(3_725_400)).toBe("1:02:05");
  });
});
