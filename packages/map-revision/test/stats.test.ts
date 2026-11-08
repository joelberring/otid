import { describe, expect, it } from "vitest";
import { addStats, coveredHectares, earnedBadges, EMPTY_STATS, nightStart, type StoredTrackPoint } from "../src";

/** ADR-0219 K3b: rekad yta, summor, märken och natt. */
describe("statistiken (K3b)", () => {
  it("rekad yta: ett band 40 m brett längs spåret, överlapp räknas en gång", () => {
    // 1 km rakt österut (0,0175° longitud vid 59,3° ≈ 996 m): bandet ≈ 1 000 × 40 m + ändarna ≈ 4 ha.
    const line: StoredTrackPoint[] = Array.from({ length: 101 }, (_, i) => [59.3, 17.9 + i * 0.000175, i * 10, 5]);
    const hectares = coveredHectares([line]);
    expect(hectares).toBeGreaterThan(3.8);
    expect(hectares).toBeLessThan(4.4);
    expect(coveredHectares([line, line])).toBe(hectares);
    expect(coveredHectares([])).toBe(0);
    // En lucka på 1 km (tappad signal) räknas inte.
    const jump: StoredTrackPoint[] = [[59.3, 17.9, 0, 5], [59.3, 17.9175, 60, 5]];
    expect(coveredHectares([jump])).toBeLessThan(0.3);
  });

  it("summor, märken och natt", () => {
    const one = { ...EMPTY_STATS, projects: 1, tracks: 2, km: 12, hectares: 11, deleted: 60, night: true };
    const total = addStats(one, { ...EMPTY_STATS, projects: 1, checked: 120, areasDone: 1 });
    expect(total).toMatchObject({ projects: 2, km: 12, checked: 120, night: true });
    expect(earnedBadges(total)).toEqual(["FIRST_TRACK", "TEN_KM", "TEN_HECTARES", "NIGHT", "HUNDRED_CHECKED", "AREA_DONE", "GENERALIZER"]);
    expect(earnedBadges(EMPTY_STATS)).toEqual([]);
    expect(nightStart("2026-11-08T21:30:00Z")).toBe(true);
    expect(nightStart("2026-11-08T09:00:00Z")).toBe(false);
    expect(nightStart(null)).toBe(false);
  });
});
