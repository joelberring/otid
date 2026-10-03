import { describe, expect, it } from "vitest";
import { adminMapGeoreferenceStateResponseSchema, mapGeoreferenceCreateIdempotencyKeySchema, mapGeoreferenceCreateRequestSchema, mapGeoreferenceResponseSchema } from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
const request = { formatVersion: 1 as const, manifestId: id, expectedGeoreferenceRevision: 0, imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326" as const, tiePoints: [
  { pixelX: 0, pixelY: 0, longitude: 18.1, latitude: 59.2 }, { pixelX: 1000, pixelY: 0, longitude: 18.11, latitude: 59.2 }, { pixelX: 0, pixelY: 500, longitude: 18.1, latitude: 59.195 }
] };

describe("TASK114 map georeference contracts", () => {
  it("accepts only a bounded exact WGS84 three-point calibration intent", () => {
    expect(mapGeoreferenceCreateRequestSchema.parse(request)).toEqual(request);
    for (const bad of [{ ...request, crs: "EPSG:3006" }, { ...request, imageWidth: 0 }, { ...request, tiePoints: request.tiePoints.slice(0, 2) }, { ...request, tiePoints: [{ ...request.tiePoints[0], longitude: 181 }, request.tiePoints[1], request.tiePoints[2]] }]) {
      expect(mapGeoreferenceCreateRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("keeps idempotency and private response fields strict", () => {
    expect(mapGeoreferenceCreateIdempotencyKeySchema.parse(`map-georeference:${id}`)).toBe(`map-georeference:${id}`);
    expect(mapGeoreferenceCreateIdempotencyKeySchema.safeParse(`map-publish:${id}`).success).toBe(false);
    const response = { formatVersion: 1 as const, georeferenceId: id, requestId: id, raceId: id, revision: 1, manifestId: id, sourceHash: "a".repeat(64), imageWidth: 1001, imageHeight: 501, crs: "EPSG:4326" as const, tiePoints: request.tiePoints, transform: { a: 0.00001, b: 0, c: 18.1, d: 0, e: -0.00001, f: 59.2 }, maxResidualMeters: 0, decidedAt: "2026-09-21T12:00:00.000Z", replayed: false };
    expect(mapGeoreferenceResponseSchema.parse(response)).toEqual(response);
    expect(mapGeoreferenceResponseSchema.safeParse({ ...response, objectKey: "map/private" }).success).toBe(false);
    expect(adminMapGeoreferenceStateResponseSchema.safeParse({ formatVersion: 1, raceId: id, latestGeoreferenceRevision: 1, georeferences: [{ ...response, requestId: undefined, replayed: undefined }] }).success).toBe(false);
  });
});
