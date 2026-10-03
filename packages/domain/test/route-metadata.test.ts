import { describe, expect, it } from "vitest";
import { deriveRouteMetadata, RouteMetadataError } from "../src";

const point = (segment: number, latitude: number, longitude: number, recordedAt: string | null) => ({ segment, latitude, longitude, recordedAt: recordedAt === null ? null : new Date(recordedAt) });

describe("deriveRouteMetadata", () => {
  it("sums each segment without inventing a bridge between them", () => {
    const metadata = deriveRouteMetadata([
      point(0, 0, 0, "2026-09-21T10:00:00.000Z"), point(0, 0, 0.001, "2026-09-21T10:01:00.000Z"),
      point(1, 0, 1, "2026-09-21T10:02:00.000Z"), point(1, 0, 1.001, "2026-09-21T10:03:00.000Z")
    ]);
    expect(metadata.distanceMeters).toBeCloseTo(222.38985, 4);
    expect(metadata).toMatchObject({ pointCount: 4, segmentCount: 2, timing: { status: "AVAILABLE", durationMilliseconds: 180_000 } });
    if (metadata.timing.status === "AVAILABLE") expect(metadata.timing.startedAt.toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });

  it("makes missing and non-monotonic timestamps explicitly timeless", () => {
    expect(deriveRouteMetadata([point(0, 59, 18, "2026-09-21T10:01:00.000Z"), point(0, 59, 18.001, null)]).timing).toEqual({ status: "UNAVAILABLE" });
    expect(deriveRouteMetadata([point(0, 59, 18, "2026-09-21T10:01:00.000Z"), point(0, 59, 18.001, "2026-09-21T10:00:00.000Z")]).timing).toEqual({ status: "UNAVAILABLE" });
  });

  it("rejects invalid source coordinates instead of deriving a public fact", () => {
    expect(() => deriveRouteMetadata([point(0, 91, 18, null), point(0, 59, 18, null)])).toThrow(RouteMetadataError);
  });
});
