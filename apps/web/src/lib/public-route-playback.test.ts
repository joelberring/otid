import { describe, expect, it } from "vitest";
import { publicRoutePlaybackMarker } from "./public-route-playback";

describe("public route playback", () => {
  it("interpolerar endast mellan två tidsatta pixelpunkter i samma segment", () => {
    expect(publicRoutePlaybackMarker([
      { x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 0 }
    ], [0, 1_000], 250)).toEqual({ x: 15, y: 25 });
  });

  it("döljer markören mellan osammanhängande GPX-segment men visar registrerade ändpunkter", () => {
    const points = [{ x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 1 }];
    expect(publicRoutePlaybackMarker(points, [0, 1_000], 0)).toEqual({ x: 10, y: 20 });
    expect(publicRoutePlaybackMarker(points, [0, 1_000], 500)).toBeNull();
    expect(publicRoutePlaybackMarker(points, [0, 1_000], 1_000)).toEqual({ x: 30, y: 40 });
  });

  it("avvisar tidsunderlag som saknar punkter eller inte är monotont", () => {
    expect(publicRoutePlaybackMarker([{ x: 0, y: 0, segment: 0 }], [0], 0)).toBeNull();
    expect(publicRoutePlaybackMarker([{ x: 0, y: 0, segment: 0 }, { x: 1, y: 1, segment: 0 }], [5, 4], 4)).toBeNull();
  });
});
