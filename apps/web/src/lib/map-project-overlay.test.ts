import { describe, expect, it } from "vitest";
import { stageAge } from "./map-project-overlay";

/** Etapperna (0098): färgen efter hur länge sedan delområdet reviderades. */
describe("etappernas ålder", () => {
  it("delas i år", () => {
    const today = new Date("2026-11-08T12:00:00Z");
    expect(stageAge(null, today)).toBe("NEVER");
    expect(stageAge("2026-03-01", today)).toBe("YEAR");
    expect(stageAge("2024-05-31", today)).toBe("THREE");
    expect(stageAge("2021-06-01", today)).toBe("SIX");
    expect(stageAge("2015-06-01", today)).toBe("OLDER");
  });
});
