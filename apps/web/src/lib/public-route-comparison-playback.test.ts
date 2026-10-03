import type { PublicParticipantRouteComparisonResponse } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";
import { publicRouteComparisonPlaybackDuration, publicRouteComparisonPlaybackMarkers } from "./public-route-comparison-playback";

type Route = PublicParticipantRouteComparisonResponse["routes"][number];

function timedRoute(points: Route["points"], pointElapsedMilliseconds: number[]): Route {
  const durationMilliseconds = pointElapsedMilliseconds[pointElapsedMilliseconds.length - 1] ?? 0;
  return {
    participant: { givenName: "Ada", familyName: "Route" },
    resultSplits: { status: "UNAVAILABLE" },
    points,
    metadata: {
      distanceMeters: 100,
      pointCount: points.length,
      segmentCount: new Set(points.map((point) => point.segment)).size,
      timing: {
        status: "AVAILABLE",
        startedAt: "2026-09-22T10:00:00.000Z",
        finishedAt: new Date(Date.parse("2026-09-22T10:00:00.000Z") + durationMilliseconds).toISOString(),
        durationMilliseconds
      }
    },
    playback: { status: "AVAILABLE", pointElapsedMilliseconds }
  };
}

describe("public route comparison playback", () => {
  it("börjar båda publicerade rutterna vid deras egna relativa nollpunkter", () => {
    const first = timedRoute([{ x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 0 }], [0, 60_000]);
    const second = timedRoute([{ x: 50, y: 60, segment: 0 }, { x: 70, y: 80, segment: 0 }], [0, 90_000]);
    const routes: [Route, Route] = [first, second];
    expect(publicRouteComparisonPlaybackDuration(routes)).toBe(90_000);
    expect(publicRouteComparisonPlaybackMarkers(routes, 0)).toEqual([{ x: 10, y: 20 }, { x: 50, y: 60 }]);
  });

  it("använder samma relativa tidsskala när en tredje jämförbar rutt läggs till", () => {
    const first = timedRoute([{ x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 0 }], [0, 60_000]);
    const second = timedRoute([{ x: 50, y: 60, segment: 0 }, { x: 70, y: 80, segment: 0 }], [0, 90_000]);
    const third = timedRoute([{ x: 90, y: 100, segment: 0 }, { x: 110, y: 120, segment: 0 }], [0, 120_000]);
    expect(publicRouteComparisonPlaybackDuration([first, second, third])).toBe(120_000);
    expect(publicRouteComparisonPlaybackMarkers([first, second, third], 0)).toEqual([{ x: 10, y: 20 }, { x: 50, y: 60 }, { x: 90, y: 100 }]);
    expect(publicRouteComparisonPlaybackMarkers([first, second, third], 90_000)).toEqual([null, { x: 70, y: 80 }, { x: 105, y: 115 }]);
  });

  it("döljer segmentgap och en avslutad kortare rutt utan att dölja den andra", () => {
    const first = timedRoute([
      { x: 10, y: 20, segment: 0 },
      { x: 20, y: 30, segment: 1 },
      { x: 30, y: 40, segment: 1 }
    ], [0, 20_000, 60_000]);
    const second = timedRoute([{ x: 50, y: 60, segment: 0 }, { x: 90, y: 100, segment: 0 }], [0, 90_000]);
    const routes: [Route, Route] = [first, second];
    expect(publicRouteComparisonPlaybackMarkers(routes, 10_000)).toEqual([null, { x: 54.44444444444444, y: 64.44444444444444 }]);
    const atFirstFinish = publicRouteComparisonPlaybackMarkers(routes, 60_000);
    expect(atFirstFinish?.[0]).toEqual({ x: 30, y: 40 });
    expect(atFirstFinish?.[1]?.x).toBeCloseTo(76.66666666666667, 12);
    expect(atFirstFinish?.[1]?.y).toBeCloseTo(86.66666666666667, 12);
    expect(publicRouteComparisonPlaybackMarkers(routes, 90_000)).toEqual([null, { x: 90, y: 100 }]);
  });

  it("avvisar jämförelseuppspelning när någon rutt saknar komplett GPX-tid", () => {
    const timed = timedRoute([{ x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 0 }], [0, 60_000]);
    const timeless: Route = { ...timed, metadata: { ...timed.metadata, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" } };
    expect(publicRouteComparisonPlaybackDuration([timed, timeless])).toBeNull();
    expect(publicRouteComparisonPlaybackMarkers([timed, timeless], 0)).toBeNull();
  });
});
