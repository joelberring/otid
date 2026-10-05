import { describe, expect, it } from "vitest";
import { deriveRasterGeoreference, projectRoute, routeLegs, routeSegment, runnerLegs, timedRoutePoints, type RoutePoint } from "../src";

const T = Date.parse("2026-10-08T17:00:00Z");
/** Rutt med en punkt var tionde sekund längs latituden, från T−60 s till T+600 s. */
const route: RoutePoint[] = Array.from({ length: 67 }, (_, index) => [T - 60_000 + index * 10_000, 59 + index * 0.0001, 18]);

describe("vägval", () => {
  it("delar löparens tid i sträckor med samma identitet som sträcktidstabellen", () => {
    expect(runnerLegs([{ controlCode: 31, occurrence: 1, elapsedMs: 100_000 }, { controlCode: 33, occurrence: 1, elapsedMs: 250_000 }], 300_000))
      .toEqual([{ leg: "S-31.1", fromElapsedMs: 0, toElapsedMs: 100_000 }, { leg: "31.1-33.1", fromElapsedMs: 100_000, toElapsedMs: 250_000 },
        { leg: "33.1-F", fromElapsedMs: 250_000, toElapsedMs: 300_000 }]);
    // Utan målstämpel ingen sista sträcka.
    expect(runnerLegs([{ controlCode: 31, occurrence: 1, elapsedMs: 100_000 }], null)).toHaveLength(1);
  });

  it("klipper ut ruttens del för en sträcka och interpolerar ändpunkterna", () => {
    const segment = routeSegment(route, T + 15_000, T + 45_000);
    expect(segment.map(point => point[0] - T)).toEqual([15_000, 20_000, 30_000, 40_000, 45_000]);
    expect(segment[0]![1]).toBeCloseTo(59 + 7.5 * 0.0001, 10);
    // Exakt på en punkt: ingen extra punkt.
    expect(routeSegment(route, T, T + 20_000).map(point => point[0] - T)).toEqual([0, 10_000, 20_000]);
  });

  it("ger bara den täckta delen, eller inget när rutten inte täcker sträckan", () => {
    expect(routeSegment(route, T - 120_000, T - 40_000).map(point => point[0] - T)).toEqual([-60_000, -50_000, -40_000]);
    expect(routeSegment(route, T + 590_000, T + 700_000).map(point => point[0] - T)).toEqual([590_000, 600_000]);
    expect(routeSegment(route, T + 700_000, T + 800_000)).toEqual([]);
    expect(routeSegment(route, T - 300_000, T - 200_000)).toEqual([]);
    expect(routeSegment(route, T + 20_000, T + 20_000)).toEqual([]);
  });

  it("anger sträckorna som har ett vägval", () => {
    const legs = runnerLegs([{ controlCode: 31, occurrence: 1, elapsedMs: 300_000 }, { controlCode: 32, occurrence: 1, elapsedMs: 700_000 }], 900_000);
    // Rutten slutar T+600 s: start–31 och en del av 31–32 täcks, 32–mål inte.
    expect(routeLegs(route, T, legs)).toEqual(["S-31.1", "31.1-32.1"]);
  });

  it("projicerar punkterna till kartans pixlar", () => {
    const { transform } = deriveRasterGeoreference({ imageWidth: 1001, imageHeight: 1001, tiePoints: [
      { pixelX: 0, pixelY: 0, longitude: 17.99, latitude: 59.01 }, { pixelX: 1000, pixelY: 0, longitude: 18.01, latitude: 59.01 },
      { pixelX: 0, pixelY: 1000, longitude: 17.99, latitude: 58.99 }] });
    expect(projectRoute(transform, [[T, 59, 18]])).toEqual([[500, 500]]);
  });

  it("tar bara punkter med tid, i tidsordning och utan dubbletter", () => {
    expect(timedRoutePoints([
      { latitude: 59.2, longitude: 18, recordedAt: "2026-10-08T17:00:10Z" }, { latitude: 59.1, longitude: 18, recordedAt: "2026-10-08T17:00:00Z" },
      { latitude: 59.3, longitude: 18 }, { latitude: 59.4, longitude: 18, recordedAt: "2026-10-08T17:00:10Z" }
    ])).toEqual([[T, 59.1, 18], [T + 10_000, 59.2, 18]]);
    expect(timedRoutePoints([{ latitude: 59, longitude: 18 }, { latitude: 59.1, longitude: 18 }])).toEqual([]);
  });
});
