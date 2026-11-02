import { describe, expect, it } from "vitest";
import { rogainingScoreSchema } from "../src/rogaining";

/** ADR-0190 beslut 7: resultatets poäng kan visa stämplingar efter målet som ignorerade; äldre resultat saknar fältet. */
describe("rogainingens poäng i resultatet", () => {
  const score = { controlPoints: 7, penalty: 0, total: 7, timeLimitMs: 3_600_000, penaltyPointsPerMinute: 2, overtimeMinutes: 0,
    controls: [{ controlCode: 45, points: 4 }, { controlCode: 31, points: 3 }] };
  it("tar stämplingarna efter målet och äldre resultat utan dem", () => {
    expect(rogainingScoreSchema.safeParse(score).success).toBe(true);
    expect(rogainingScoreSchema.safeParse({ ...score, ignoredAfterFinish: [102, 99] }).success).toBe(true);
    expect(rogainingScoreSchema.safeParse({ ...score, ignoredAfterFinish: ["102"] }).success).toBe(false);
  });
});
