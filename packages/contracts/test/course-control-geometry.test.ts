import { describe, expect, it } from "vitest";
import { courseControlGeometryCreateRequestSchema, courseControlGeometryIdempotencyKeySchema, publicParticipantRouteComparisonQuerySchema, publicParticipantRouteComparisonResponseSchema, publicParticipantRouteViewResponseSchema } from "../src";

const id = "0198e35a-5f4e-7000-8000-000000000001";

describe("course-control geometry contract", () => {
  it("requires a complete syntactically valid explicit point list", () => {
    expect(courseControlGeometryIdempotencyKeySchema.safeParse(`course-control-geometry:${id}`).success).toBe(true);
    expect(courseControlGeometryCreateRequestSchema.safeParse({ formatVersion: 1, courseVersionId: id, mapManifestId: id, georeferenceId: id, expectedGeometryRevision: 0, points: [{ courseControlId: id, pixelX: 10, pixelY: 20 }] }).success).toBe(true);
    expect(courseControlGeometryCreateRequestSchema.safeParse({ formatVersion: 1, courseVersionId: id, mapManifestId: id, georeferenceId: id, expectedGeometryRevision: 0, points: [{ courseControlId: id, pixelX: 10, pixelY: 20 }, { courseControlId: id, pixelX: 20, pixelY: 30 }] }).success).toBe(false);
  });

  it("permits only public control labels and pixel positions in a route view", () => {
    const response = { formatVersion: 2, imageWidth: 100, imageHeight: 80,
      points: [{ x: 1, y: 2, segment: 0 }, { x: 3, y: 4, segment: 0 }],
      controls: [{ sequence: 1, controlCode: 31, x: 10, y: 20 }],
      metadata: { distanceMeters: 100, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" }, notice: "ROUTE_NOT_GPS_VERIFIED" };
    expect(publicParticipantRouteViewResponseSchema.safeParse(response).success).toBe(true);
    expect(publicParticipantRouteViewResponseSchema.safeParse({ ...response, controls: [{ ...response.controls[0], courseControlId: id }] }).success).toBe(false);
    expect(publicParticipantRouteViewResponseSchema.safeParse({ ...response, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 10] } }).success).toBe(false);
    const timed = { ...response, metadata: { ...response.metadata, timing: { status: "AVAILABLE" as const, startedAt: "2026-09-22T10:00:00.000Z", finishedAt: "2026-09-22T10:00:00.010Z", durationMilliseconds: 10 } }, playback: { status: "AVAILABLE" as const, pointElapsedMilliseconds: [0, 10] } };
    expect(publicParticipantRouteViewResponseSchema.safeParse(timed).success).toBe(true);
    expect(publicParticipantRouteViewResponseSchema.safeParse({ ...timed, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [1, 10] } }).success).toBe(false);
  });

  it("requires two or three different opaque results and exposes only pixel routes", () => {
    const query = { first: id, second: "0198e35a-5f4e-7000-8000-000000000002" };
    const route = { participant: { givenName: "Ada", familyName: "Lovelace" }, resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 10, elapsedMs: 10 }] }, points: [{ x: 1, y: 2, segment: 0 }, { x: 3, y: 4, segment: 0 }], metadata: { distanceMeters: 100, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" } }, playback: { status: "UNAVAILABLE" } };
    const response = { formatVersion: 2, imageWidth: 100, imageHeight: 80, routes: [route, route], controls: [{ sequence: 1, controlCode: 31, x: 10, y: 20 }], notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED" };
    expect(publicParticipantRouteComparisonQuerySchema.safeParse(query).success).toBe(true);
    expect(publicParticipantRouteComparisonQuerySchema.safeParse({ first: id, second: id }).success).toBe(false);
    expect(publicParticipantRouteComparisonQuerySchema.safeParse({ ...query, third: "0198e35a-5f4e-7000-8000-000000000003" }).success).toBe(true);
    expect(publicParticipantRouteComparisonQuerySchema.safeParse({ ...query, third: query.second }).success).toBe(false);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse(response).success).toBe(true);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, formatVersion: 3, routes: [route, route, route] }).success).toBe(true);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, formatVersion: 3 }).success).toBe(false);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [{ ...route, entryId: id }, route] }).success).toBe(false);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [{ ...route, participant: { ...route.participant, organisationName: "OK Exempel" } }, route] }).success).toBe(false);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [{ ...route, resultSplits: { ...route.resultSplits, resultStatus: "OK" } }, route] }).success).toBe(false);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [{ ...route, resultSplits: { status: "UNAVAILABLE" } }, route] }).success).toBe(true);
    const timed = { ...route, metadata: { ...route.metadata, timing: { status: "AVAILABLE" as const, startedAt: "2026-09-22T10:00:00.000Z", finishedAt: "2026-09-22T10:00:00.010Z", durationMilliseconds: 10 } }, playback: { status: "AVAILABLE" as const, pointElapsedMilliseconds: [0, 10] } };
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [timed, timed] }).success).toBe(true);
    expect(publicParticipantRouteComparisonResponseSchema.safeParse({ ...response, routes: [{ ...timed, playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 11] } }, timed] }).success).toBe(false);
  });
});
