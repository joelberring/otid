import { describe, expect, it } from "vitest";
import { normalizeClock, parseRaceClock } from "../src/race-clock";

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
});
