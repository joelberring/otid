import { describe, expect, it } from "vitest";
import { shownHandles, stageAge } from "./map-project-overlay";

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

describe("punkthandtagen (ägaren 2026-11-23)", () => {
  it("glesar ut täta punkter men visar ändarna, den aktiva och den pekaren är nära", () => {
    // 50 punkter med 2 px mellanrum i en del, sedan en andra del med två punkter långt isär.
    const points = [...Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 0, part: 0 })), { x: 0, y: 100, part: 1 }, { x: 100, y: 100, part: 1 }];
    const { shown, dense } = shownHandles(points, index => index === 21, 14);
    expect(dense).toBe(true);
    expect(shown[0]).toBe(true);
    expect(shown[49]).toBe(true);
    expect(shown[21]).toBe(true);
    expect(shown[1]).toBe(false);
    expect(shown.slice(0, 50).filter(Boolean).length).toBeLessThan(12);
    expect(shown.slice(50)).toEqual([true, true]);
  });
  it("glesa punkter visas alla", () => {
    const { shown, dense } = shownHandles([{ x: 0, y: 0, part: 0 }, { x: 20, y: 0, part: 0 }, { x: 40, y: 0, part: 0 }], () => false);
    expect(shown).toEqual([true, true, true]);
    expect(dense).toBe(false);
  });
});
