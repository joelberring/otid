import { describe, expect, it } from "vitest";
import {
  participantPrivateRouteDetailResponseSchema,
  participantPrivateRouteListResponseSchema
} from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
const at = "2026-09-20T12:00:00.000Z";

const listResponse = {
  formatVersion: 1,
  items: [{
    routeUploadId: id,
    raceId: id,
    eventName: "Klubbtävling",
    raceName: "H21",
    storedAt: at,
    pointCount: 2,
    segmentCount: 1
  }]
};

const detailResponse = {
  formatVersion: 2,
  routeUploadId: id,
  raceId: id,
  eventName: "Klubbtävling",
  raceName: "H21",
  storedAt: at,
  metadata: {
    distanceMeters: 0,
    pointCount: 2,
    segmentCount: 1,
    timing: { status: "AVAILABLE", startedAt: at, finishedAt: at, durationMilliseconds: 0 }
  },
  sharing: { consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" } }
};

describe("TASK154 participant private route contracts", () => {
  it("accepts bounded version lists and route facts", () => {
    expect(participantPrivateRouteListResponseSchema.parse(listResponse)).toEqual(listResponse);
    expect(participantPrivateRouteDetailResponseSchema.parse(detailResponse)).toEqual(detailResponse);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse,
      metadata: { ...detailResponse.metadata, timing: { status: "UNAVAILABLE" } }
    }).success).toBe(true);
  });

  it("rejects noncanonical IDs, non-UTC instants, invalid bounds and unknown fields", () => {
    expect(participantPrivateRouteListResponseSchema.safeParse({
      ...listResponse,
      items: [{ ...listResponse.items[0], routeUploadId: id.toUpperCase() }]
    }).success).toBe(false);
    expect(participantPrivateRouteListResponseSchema.safeParse({
      ...listResponse,
      items: [{ ...listResponse.items[0], storedAt: "2026-09-20T14:00:00+02:00" }]
    }).success).toBe(false);
    expect(participantPrivateRouteListResponseSchema.safeParse({
      ...listResponse,
      items: [{ ...listResponse.items[0], pointCount: 1 }]
    }).success).toBe(false);
    expect(participantPrivateRouteListResponseSchema.safeParse({ ...listResponse, unexpected: true }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse,
      metadata: { ...detailResponse.metadata, distanceMeters: Number.POSITIVE_INFINITY }
    }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse,
      metadata: { ...detailResponse.metadata, timing: { status: "AVAILABLE", startedAt: at, finishedAt: at, durationMilliseconds: Number.MAX_SAFE_INTEGER + 1 } }
    }).success).toBe(false);
  });

  it("rejects private geometry, participant identities, storage and consent fields", () => {
    for (const field of ["latitude", "longitude", "points", "entryId", "objectKey", "storeId", "versionId", "consent", "mapManifestId"]) {
      expect(participantPrivateRouteDetailResponseSchema.safeParse({ ...detailResponse, [field]: id }).success).toBe(false);
      expect(participantPrivateRouteListResponseSchema.safeParse({
        ...listResponse,
        items: [{ ...listResponse.items[0], [field]: id }]
      }).success).toBe(false);
    }
  });

  it("requires separate exact-version sharing facts and a public identity only when available", () => {
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse,
      sharing: { consent: "GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "AVAILABLE", publicResultId: id } }
    }).success).toBe(true);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({ ...detailResponse, sharing: undefined }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse, sharing: { ...detailResponse.sharing, publicRoute: { status: "AVAILABLE" } }
    }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse, sharing: { ...detailResponse.sharing, publicRoute: { status: "UNAVAILABLE", publicResultId: id } }
    }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse, sharing: { ...detailResponse.sharing, publicRoute: { status: "AVAILABLE", publicResultId: id.toUpperCase() } }
    }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse, sharing: { consent: "NOT_GRANTED", adminRelease: "ACTIVE", publicRoute: { status: "AVAILABLE", publicResultId: id } }
    }).success).toBe(false);
    expect(participantPrivateRouteDetailResponseSchema.safeParse({
      ...detailResponse, sharing: { consent: "GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "AVAILABLE", publicResultId: id } }
    }).success).toBe(false);
  });
});
