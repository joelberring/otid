import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEO_WORKER_VERSION, geoJobMemoryGb } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";
import { geoSplitKm2, splitClip } from "../src/map-project-geo-jobs";

/**
 * Ägaren 2026-11-11: servern ger inga jobb till en äldre geo-arbetare; talen i arbetaren och i contracts ska vara lika.
 * Arbetaren läses som text eller laddas dynamiskt (den körs fristående av Node med `.ts`-importer och ingår i `scripts/tsconfig.json`).
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
    expect([clip(2200, 2200), clip(4600, 3950), clip(3800, 5350), clip(5000, 5000), clip(8000, 7000), { tiles: [1] }, { tiles: [1, 2, 3, 4] }].map(geoJobMemoryGb))
      .toEqual([4, 8, 8, 8, 16, 4, 8]);
  });
  it("har förvald etappgräns 25 km² (Etapp G5) och behåller 25 km² odelad på 8 GB", () => {
    expect(geoSplitKm2({})).toBe(25);
    expect(geoSplitKm2({ OTID_GEO_SPLIT_KM2: "0" })).toBe(0);
    expect(geoSplitKm2({ OTID_GEO_SPLIT_KM2: "16" })).toBe(16);
    const clip25 = { minX: 0, minY: 0, maxX: 5000, maxY: 5000 };
    expect(splitClip(clip25, geoSplitKm2({}))).toEqual([clip25]);
    expect(geoJobMemoryGb({ clip: clip25, tiles: [] })).toBe(8);
    const clip30 = { minX: 0, minY: 0, maxX: 5000, maxY: 6000 };
    expect(splitClip(clip30, geoSplitKm2({}))).toEqual([
      { minX: 0, minY: 0, maxX: 5000, maxY: 3000 },
      { minX: 0, minY: 3000, maxX: 5000, maxY: 6000 }
    ]);
  });
  it("mäter stegtider per fas, summerar återkommande faser och behåller topp-RSS", async () => {
    const workerUrl = new URL("../../../scripts/geo-worker.ts", import.meta.url).href;
    const { createJobTelemetry } = await import(/* @vite-ignore */ workerUrl) as {
      createJobTelemetry: (now?: () => number, rssBytes?: () => number) => {
        sample: () => number; phase: (next?: string) => void; summary: () => Record<string, number>;
      };
    };
    let clock = 1000;
    let rss = 120_000_000;
    const telemetry = createJobTelemetry(() => clock, () => rss);
    telemetry.phase("msFetchClip");
    clock += 250; rss = 450_000_000;
    expect(telemetry.sample()).toBe(450);
    clock += 150;
    telemetry.phase("msPullauta");
    clock += 1200; rss = 980_000_000;
    expect(telemetry.sample()).toBe(980);
    telemetry.phase("msPngMerge");
    clock += 300; rss = 310_000_000;
    telemetry.phase(); // pausad mellan steg
    clock += 50;
    telemetry.phase("msPngMerge"); // återkommande fas i sammanslagning summeras
    clock += 100;
    expect(telemetry.summary()).toEqual({ msFetchClip: 400, msPullauta: 1200, msPngMerge: 400, msTotal: 2050, peakRssMb: 980 });
  });
});
