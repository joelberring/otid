import { describe, expect, it } from "vitest";
import { formatStartListTime } from "./start-list-time";

describe("startlistans tävlingstid", () => {
  it("visar datum, offset och millisekunder även vid dygnsskifte och upprepad sommartidstimme", () => {
    const midnight = formatStartListTime("2026-09-04T22:00:00.123Z", "Europe/Stockholm");
    expect(midnight).toContain("2026-09-05");
    expect(midnight).toContain("00:00:00,123");
    expect(midnight).toContain("GMT+02:00");
    const summer = formatStartListTime("2026-10-25T00:30:00Z", "Europe/Stockholm");
    const winter = formatStartListTime("2026-10-25T01:30:00Z", "Europe/Stockholm");
    expect(summer).toContain("02:30:00 GMT+02:00");
    expect(winter).toContain("02:30:00 GMT+01:00");
    expect(formatStartListTime("2026-09-04T22:00:00Z", "UTC")).toContain("22:00:00 GMT");
  });
});
