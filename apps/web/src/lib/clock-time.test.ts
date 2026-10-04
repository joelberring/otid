import { describe, expect, it } from "vitest";
import { formatClockTime } from "./clock-time";

describe("klockslag", () => {
  it("visar tiden i tävlingens tidszon som HH:MM:SS", () => {
    expect(formatClockTime("2026-10-08T16:05:09.000Z", "Europe/Stockholm")).toBe("18:05:09");
    expect(formatClockTime("2026-12-08T23:30:00.000Z", "Europe/Stockholm")).toBe("00:30:00");
    expect(formatClockTime("inte en tid", "Europe/Stockholm")).toBe("–");
  });
});
