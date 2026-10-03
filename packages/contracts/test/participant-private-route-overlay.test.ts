import { describe, expect, it } from "vitest";
import { participantPrivateRouteOverlayResponseSchema } from "../src/participant-private-route-overlay";

const id = "123e4567-e89b-42d3-a456-426614174000";
const overlay = {
  formatVersion: 4,
  routeUploadId: id,
  contextRevision: 3,
  imageWidth: 1_000,
  imageHeight: 800,
  points: [{ x: 10, y: 20, segment: 0 }, { x: 30, y: 40, segment: 0 }, { x: 50, y: 60, segment: 1 }],
  controls: [{ sequence: 1, controlCode: 31, x: 500, y: 400 }],
  metadata: {
    distanceMeters: 1_200,
    pointCount: 3,
    segmentCount: 2,
    timing: { status: "AVAILABLE", startedAt: "2026-09-23T10:00:00.000Z", finishedAt: "2026-09-23T10:05:00.000Z", durationMilliseconds: 300_000 }
  },
  playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 120_000, 280_000] },
  resultStart: { status: "AVAILABLE", resultRevision: 7, startedAt: "2026-09-23T09:58:00.000Z" },
  resultSplits: { status: "AVAILABLE", resultRevision: 7, splits: [{ controlCode: 31, occurrence: 1, legMs: 42_000, elapsedMs: 42_000 }] },
  notice: "ROUTE_NOT_GPS_VERIFIED"
} as const;

describe("participant private route overlay playback contract", () => {
  it("accepts complete per-point elapsed timing and unavailable source timing", () => {
    expect(participantPrivateRouteOverlayResponseSchema.parse(overlay)).toEqual(overlay);
    const unavailable = {
      ...overlay,
      metadata: { ...overlay.metadata, timing: { status: "UNAVAILABLE" as const } },
      playback: { status: "UNAVAILABLE" as const },
      resultSplits: { status: "UNAVAILABLE" as const }
    };
    expect(participantPrivateRouteOverlayResponseSchema.parse(unavailable)).toEqual(unavailable);
  });

  it("requires format version 4 and playback/result discriminants", () => {
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, formatVersion: 3 }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, playback: undefined }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, playback: { status: "AVAILABLE" } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: undefined }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { status: "AVAILABLE" } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: undefined }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { status: "AVAILABLE" } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { status: "UNAVAILABLE", splits: [] } }).success).toBe(false);
  });

  it("validates an independent result start with a bounded revision and normalized UTC time", () => {
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { status: "UNAVAILABLE" } }).success).toBe(true);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { ...overlay.resultStart, resultRevision: 0 } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { ...overlay.resultStart, resultRevision: 2_147_483_648 } }).success).toBe(false);
    for (const startedAt of ["2026-09-23T09:58:00Z", "2026-09-23T11:58:00.000+02:00", "2026-09-23T09:58:00.1Z", "not-a-time"]) {
      expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { ...overlay.resultStart, startedAt } }).success).toBe(false);
    }
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { status: "UNAVAILABLE", startedAt: "2026-09-23T09:58:00.000Z" } }).success).toBe(false);
  });

  it("requires an effective positive revision and bounded nonempty split rows", () => {
    const valid = overlay.resultSplits;
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...valid, resultRevision: 0 } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...valid, splits: [] } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...valid, splits: [{ ...valid.splits[0], occurrence: 0 }] } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...valid, splits: [{ ...valid.splits[0], legMs: -1 }] } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...valid, splits: [{ ...valid.splits[0], elapsedMs: -1 }] } }).success).toBe(false);
  });

  it("requires matching result revisions when both result projections are available", () => {
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      resultStart: { ...overlay.resultStart, resultRevision: 8 }
    }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      resultStart: { status: "UNAVAILABLE" },
      resultSplits: { ...overlay.resultSplits, resultRevision: 8 }
    }).success).toBe(true);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      resultSplits: { status: "UNAVAILABLE" }
    }).success).toBe(true);
  });

  it("requires unique control code and occurrence pairs for available splits", () => {
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      resultSplits: {
        ...overlay.resultSplits,
        splits: [
          { controlCode: 31, occurrence: 1, legMs: 42_000, elapsedMs: 42_000 },
          { controlCode: 31, occurrence: 1, legMs: 30_000, elapsedMs: 72_000 }
        ]
      }
    }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      resultSplits: {
        ...overlay.resultSplits,
        splits: [
          { controlCode: 31, occurrence: 1, legMs: 42_000, elapsedMs: 42_000 },
          { controlCode: 31, occurrence: 2, legMs: 30_000, elapsedMs: 72_000 }
        ]
      }
    }).success).toBe(true);
  });

  it("requires metadata point count and one elapsed time per point", () => {
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, metadata: { ...overlay.metadata, pointCount: 2 } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 300_000] } }).success).toBe(false);
  });

  it("requires zero start, monotone order, and values within the duration", () => {
    for (const pointElapsedMilliseconds of [[1, 100_000, 300_000], [0, 200_000, 100_000], [0, 100_000, 300_001]]) {
      expect(participantPrivateRouteOverlayResponseSchema.safeParse({
        ...overlay,
        playback: { status: "AVAILABLE", pointElapsedMilliseconds }
      }).success).toBe(false);
    }
  });

  it("does not expose geographic coordinates, hashes, storage references, or internal result fields", () => {
    for (const field of ["latitude", "longitude", "sourceHash", "objectKey", "storeId", "entryId", "gpsTrackId", "deviceId"]) {
      expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, [field]: id }).success).toBe(false);
    }
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { ...overlay.resultStart, entryId: id } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultStart: { ...overlay.resultStart, latitude: 59.3 } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...overlay.resultSplits, entryId: id } }).success).toBe(false);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, resultSplits: { ...overlay.resultSplits, splits: [{ ...overlay.resultSplits.splits[0], latitude: 59.3 }] } }).success).toBe(false);
  });
});
