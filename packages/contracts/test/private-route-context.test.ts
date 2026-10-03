import { describe, expect, it } from "vitest";
import {
  adminPrivateRouteContextStateResponseSchema,
  participantPrivateRouteOverlayResponseSchema,
  privateRouteContextBindIdempotencyKeySchema,
  privateRouteContextBindRequestSchema,
  privateRouteContextBindResponseSchema
} from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
const at = "2026-09-23T10:00:00.000Z";
const atEnd = "2026-09-23T10:10:00.000Z";

const activeContext = {
  contextId: id,
  revision: 1,
  mapManifestId: id,
  georeferenceId: id,
  geometryRevisionId: id,
  courseVersionId: id,
  boundAt: at
};

const metadata = {
  distanceMeters: 2_000,
  pointCount: 2,
  segmentCount: 1,
  timing: { status: "AVAILABLE" as const, startedAt: at, finishedAt: atEnd, durationMilliseconds: 600_000 }
};

describe("TASK155 private route context contracts", () => {
  it("accepts empty and active administrator context state", () => {
    const empty = { formatVersion: 1, raceId: id, routeUploadId: id, latestContextRevision: 0, activeContext: null };
    const active = { ...empty, latestContextRevision: 1, activeContext };
    expect(adminPrivateRouteContextStateResponseSchema.parse(empty)).toEqual(empty);
    expect(adminPrivateRouteContextStateResponseSchema.parse(active)).toEqual(active);
  });

  it("accepts explicit version-bound bind requests and replay responses", () => {
    const request = {
      formatVersion: 1,
      routeUploadId: id,
      mapManifestId: id,
      georeferenceId: id,
      geometryRevisionId: id,
      expectedContextRevision: 0
    };
    const response = {
      formatVersion: 1,
      contextId: id,
      requestId: id,
      raceId: id,
      routeUploadId: id,
      revision: 1,
      mapManifestId: id,
      georeferenceId: id,
      geometryRevisionId: id,
      courseVersionId: id,
      boundAt: at,
      replayed: true
    };
    expect(privateRouteContextBindRequestSchema.parse(request)).toEqual(request);
    expect(privateRouteContextBindResponseSchema.parse(response)).toEqual(response);
    expect(privateRouteContextBindIdempotencyKeySchema.parse(`private-route-context-bind:${id}`)).toBe(`private-route-context-bind:${id}`);
  });

  it("accepts the participant pixel overlay and GPX metadata", () => {
    const overlay = {
      formatVersion: 4,
      routeUploadId: id,
      contextRevision: 1,
      imageWidth: 1_000,
      imageHeight: 800,
      points: [{ x: 0, y: 0, segment: 0 }, { x: 999, y: 799, segment: 0 }],
      controls: [{ sequence: 1, controlCode: 31, x: 500, y: 400 }],
      metadata,
      playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 600_000] },
      resultSplits: { status: "AVAILABLE", resultRevision: 1,
        splits: [{ controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 }] },
      resultStart: { status: "AVAILABLE", resultRevision: 1, startedAt: at },
      notice: "ROUTE_NOT_GPS_VERIFIED"
    };
    expect(participantPrivateRouteOverlayResponseSchema.parse(overlay)).toEqual(overlay);
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, contextRevision: 0 }).success).toBe(false);
  });

  it("rejects malformed IDs, stale revisions, invalid idempotency keys and unknown fields", () => {
    const request = {
      formatVersion: 1,
      routeUploadId: id,
      mapManifestId: id,
      georeferenceId: id,
      geometryRevisionId: id,
      expectedContextRevision: 0
    };
    expect(privateRouteContextBindRequestSchema.safeParse({ ...request, expectedContextRevision: -1 }).success).toBe(false);
    expect(privateRouteContextBindRequestSchema.safeParse({ ...request, entryId: id }).success).toBe(false);
    expect(privateRouteContextBindIdempotencyKeySchema.safeParse(`private-route-context-bind:${id.toUpperCase()}`).success).toBe(false);

    const overlay = {
      formatVersion: 4,
      routeUploadId: id,
      contextRevision: 1,
      imageWidth: 1_000,
      imageHeight: 800,
      points: [{ x: 0, y: 0, segment: 0 }, { x: 999, y: 799, segment: 0 }],
      controls: [{ sequence: 1, controlCode: 31, x: 500, y: 400 }],
      metadata,
      playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 600_000] },
      resultSplits: { status: "UNAVAILABLE" },
      resultStart: { status: "UNAVAILABLE" },
      notice: "ROUTE_NOT_GPS_VERIFIED"
    };
    for (const field of ["latitude", "longitude", "entryId", "raceId", "objectKey", "mapManifestId", "georeferenceId"]) {
      expect(participantPrivateRouteOverlayResponseSchema.safeParse({ ...overlay, [field]: id }).success).toBe(false);
    }
    expect(participantPrivateRouteOverlayResponseSchema.safeParse({
      ...overlay,
      points: [{ x: Number.POSITIVE_INFINITY, y: 0, segment: 0 }, { x: 1, y: 1, segment: 0 }]
    }).success).toBe(false);
  });
});
