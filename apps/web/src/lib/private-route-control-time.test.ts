import { describe, expect, it } from "vitest";
import { privateRouteControlTimeTarget } from "./private-route-control-time";

const base = {
  gpxStartedAt: "2026-09-23T10:00:00.000Z",
  resultStartedAt: "2026-09-23T10:01:00.000Z",
  offsetSeconds: 0,
  splitElapsedMilliseconds: 600_000,
  durationMilliseconds: 1_200_000
};

describe("private route published control time", () => {
  it("adds the accumulated result time to the manually aligned start", () => {
    expect(privateRouteControlTimeTarget(base)).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 660_000 });
  });

  it("accepts a target in range even when the result start itself is before the GPX", () => {
    expect(privateRouteControlTimeTarget({ ...base, resultStartedAt: "2026-09-23T09:55:00.000Z", splitElapsedMilliseconds: 600_000 }))
      .toEqual({ status: "IN_RANGE", elapsedMilliseconds: 300_000 });
  });

  it("accepts exact timeline endpoints and reports out of range without clamping", () => {
    expect(privateRouteControlTimeTarget({ ...base, resultStartedAt: base.gpxStartedAt, splitElapsedMilliseconds: 0 }))
      .toEqual({ status: "IN_RANGE", elapsedMilliseconds: 0 });
    expect(privateRouteControlTimeTarget({ ...base, resultStartedAt: base.gpxStartedAt, splitElapsedMilliseconds: base.durationMilliseconds }))
      .toEqual({ status: "IN_RANGE", elapsedMilliseconds: base.durationMilliseconds });
    expect(privateRouteControlTimeTarget({ ...base, resultStartedAt: base.gpxStartedAt, splitElapsedMilliseconds: base.durationMilliseconds + 1 }))
      .toEqual({ status: "OUT_OF_RANGE", elapsedMilliseconds: base.durationMilliseconds + 1 });
  });

  it("applies signed offsets and rejects invalid or unsafe inputs", () => {
    expect(privateRouteControlTimeTarget({ ...base, offsetSeconds: 30 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 630_000 });
    expect(privateRouteControlTimeTarget({ ...base, offsetSeconds: -30 })).toEqual({ status: "IN_RANGE", elapsedMilliseconds: 690_000 });
    expect(privateRouteControlTimeTarget({ ...base, offsetSeconds: 86_401 })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, offsetSeconds: 1.5 })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, splitElapsedMilliseconds: -1 })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, splitElapsedMilliseconds: 0.5 })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, splitElapsedMilliseconds: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, gpxStartedAt: "not a time" })).toBeNull();
    expect(privateRouteControlTimeTarget({ ...base, durationMilliseconds: -1 })).toBeNull();
  });
});
