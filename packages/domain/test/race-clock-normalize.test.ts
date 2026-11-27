import { describe, expect, it, vi } from "vitest";
import { localRaceDate, moveToRaceDate, normalizeClock, parseRaceClock } from "../src/race-clock";

describe("normalizeClock (användartest 2026-11-12)", () => {
  it("godtar kolon, punkt och entydiga siffror", () => {
    expect(normalizeClock("07:25")).toBe("07:25");
    expect(normalizeClock("7.25")).toBe("07:25");
    expect(normalizeClock("0725")).toBe("07:25");
    expect(normalizeClock("725")).toBe("07:25");
    expect(normalizeClock(" 18 ")).toBe("18:00");
    expect(normalizeClock("7")).toBe("07:00");
    expect(normalizeClock("18:30:15")).toBe("18:30:15");
  });

  it("ger null för det som inte är ett klockslag", () => {
    for (const value of ["", "24", "2400", "760", "18:60", "18:3", "12345", "kl 18", "7,25"]) expect(normalizeClock(value)).toBeNull();
  });

  it("parseRaceClock tolkar samma former", () => {
    const expected = parseRaceClock("2026-11-12", "07:25", "Europe/Stockholm");
    expect(expected).toBe("2026-11-12T06:25:00.000Z");
    for (const value of ["0725", "725", "7.25"]) expect(parseRaceClock("2026-11-12", value, "Europe/Stockholm")).toBe(expected);
    expect(parseRaceClock("2026-11-12", "18", "Europe/Stockholm")).toBe("2026-11-12T17:00:00.000Z");
  });

  it("hanterar sommar-/vintertid och återanvänder cachad Intl.DateTimeFormat per nyckel", () => {
    // Sommartidsövergång i Stockholm 2026-03-29 (02:30 finns inte); vintertid 2026-10-25 (02:30 ger första tolkningen CEST).
    expect(parseRaceClock("2026-03-29", "02:30", "Europe/Stockholm")).toBeNull();
    expect(parseRaceClock("2026-10-25", "02:30", "Europe/Stockholm")).toBe("2026-10-25T00:30:00.000Z");
    expect(localRaceDate(new Date("2026-06-15T22:30:00.000Z"), "Europe/Stockholm")).toBe("2026-06-16");
    // moveToRaceDate till sommartidsövergång flyttar saknat klockslag 02:30 till 03:30.
    const moved = moveToRaceDate(new Date("2026-03-28T01:30:00.500Z"), "2026-03-28", "2026-03-29", "Europe/Stockholm");
    expect(moved?.toISOString()).toBe("2026-03-29T01:30:00.500Z");
    // Cachning: upprepade anrop för en ny tidszon skapar DateTimeFormat bara en gång per formatnyckel.
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation((...args) => new OriginalDateTimeFormat(...args));
    try {
      const tz = "America/Chicago";
      for (let i = 0; i < 200; i += 1) {
        expect(parseRaceClock("2026-07-04", "10:15:00", tz)).toBe("2026-07-04T15:15:00.000Z");
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
