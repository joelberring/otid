import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicLegRoutes } from "@o-tid/contracts";
import { fitRouteBox, RouteMap } from "./route-map";

(globalThis as { React?: typeof React }).React = React;

const RACE = "10000000-0000-4000-8000-000000000002";

describe("RouteMap (Etapp P3: 150k-punkts-säker fitRouteBox & memoizerade polylinjer)", () => {
  it("beräknar utsnittet utan stack overflow på 150 000 punkter (50 löpare × 3 000 punkter)", () => {
    const runners: PublicLegRoutes["runners"] = Array.from({ length: 50 }, (_, runnerIndex) => ({
      publicResultId: `10000000-0000-4000-8000-${String(runnerIndex + 1).padStart(12, "0")}`,
      name: `Löpare ${runnerIndex + 1}`,
      className: "H21",
      legMs: 180_000 + runnerIndex * 1000,
      selected: runnerIndex === 0,
      points: Array.from({ length: 3_000 }, (__, pointIndex): [number, number] => [
        100 + (pointIndex / 2_999) * 600,
        200 + runnerIndex * 4 + (pointIndex % 10)
      ])
    }));

    const box = fitRouteBox(runners, 1000, 800);
    // X: 100..700 (span 600 → w = 780, cx = 400 → x = 10)
    expect(box.w).toBeCloseTo(600 * 1.3, 6);
    expect(box.x).toBeCloseTo(400 - (600 * 1.3) / 2, 6);
    // Y: 200..405 (span 205 → h = 266.5, cy = 302.5)
    expect(box.h).toBeCloseTo(205 * 1.3, 6);
    expect(box.y).toBeCloseTo(302.5 - (205 * 1.3) / 2, 6);

    // Även full SSR-rendering av <RouteMap> med 150 000 punkter går igenom utan RangeError.
    const data: PublicLegRoutes = {
      formatVersion: 1, raceId: RACE, leg: "31.1-32.1",
      map: { width: 1000, height: 800, version: "a".repeat(16) },
      runners
    };
    const html = renderToStaticMarkup(<RouteMap raceId={RACE} data={data} />);
    expect(html).toContain('data-testid="route-map"');
    expect(html).toContain('data-testid="selected-route"');
  });

  it("faller tillbaka på hela kartan när inga punkter finns", () => {
    expect(fitRouteBox([], 1200, 900)).toEqual({ x: 0, y: 0, w: 1200, h: 900 });
  });
});
