import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEO_WORKER_VERSION, geoJobMemoryGb } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";

/**
 * Ägaren 2026-11-11: servern ger inga jobb till en äldre geo-arbetare; talen i arbetaren och i contracts ska vara lika.
 * Arbetaren läses som text (den körs fristående av Node och importeras inte här).
 */
describe("geo-arbetarens version", () => {
  it("är densamma i arbetaren och i servern", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../scripts/geo-worker.ts"), "utf8");
    expect(Number(/export const WORKER_VERSION = (\d+);/.exec(source)?.[1])).toBe(GEO_WORKER_VERSION);
  });
  it("räknar jobbets minnesbehov lika i arbetaren och i servern", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../scripts/geo-worker.ts"), "utf8");
    expect(source).toContain("return areaKm2 <= 8 ? 4 : areaKm2 <= 45 ? 8 : 16;");
    const clip = (width: number, height: number) => ({ clip: { minX: 0, minY: 0, maxX: width, maxY: height }, tiles: [] });
    expect([clip(2200, 2200), clip(4600, 3950), clip(3800, 5350), clip(8000, 7000), { tiles: [1] }, { tiles: [1, 2, 3, 4] }].map(geoJobMemoryGb))
      .toEqual([4, 8, 8, 16, 4, 8]);
  });
});
