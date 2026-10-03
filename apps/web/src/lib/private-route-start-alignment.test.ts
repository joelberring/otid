import { describe, expect, it } from "vitest";
import { privateRouteStartAlignment } from "./private-route-start-alignment";

const base = {
  gpxStartedAt: "2026-09-23T10:00:00.000Z",
  resultStartedAt: "2026-09-23T10:01:00.000Z",
  durationMilliseconds: 120_000
};

describe("private route result start alignment", () => {
  it("subtracts a positive GPX clock offset", () => {
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: 30 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 30_000 });
  });

  it("adds a negative GPX clock offset", () => {
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: -30 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 90_000 });
  });

  it("accepts both timeline endpoints and reports an out of range start without clamping", () => {
    expect(privateRouteStartAlignment({ ...base, resultStartedAt: base.gpxStartedAt, offsetSeconds: 0 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 0 });
    expect(privateRouteStartAlignment({ ...base, resultStartedAt: "2026-09-23T10:02:00.000Z", offsetSeconds: 0 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 120_000 });
    expect(privateRouteStartAlignment({ ...base, resultStartedAt: "2026-09-23T10:02:00.001Z", offsetSeconds: 0 })).toEqual({ status: "OUT_OF_RANGE", elapsedMilliseconds: 120_001 });
  });

  it("rejects invalid or out of bound offsets and invalid times", () => {
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: 86_400 })).not.toBeNull();
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: -86_400 })).not.toBeNull();
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: 86_401 })).toBeNull();
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: 1.5 })).toBeNull();
    expect(privateRouteStartAlignment({ ...base, offsetSeconds: Number.NaN })).toBeNull();
    expect(privateRouteStartAlignment({ ...base, gpxStartedAt: "not a time", offsetSeconds: 0 })).toBeNull();
    expect(privateRouteStartAlignment({ ...base, durationMilliseconds: -1, offsetSeconds: 0 })).toBeNull();
  });
});
