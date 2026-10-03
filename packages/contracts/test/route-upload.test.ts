import { describe, expect, it } from "vitest";
import {
  ROUTE_UPLOAD_MAX_BYTES,
  routeObjectManifestSchema,
  routeUploadGrantIssueRequestSchema,
  routeUploadGrantIssueResponseSchema,
  routeUploadGrantRevokeRequestSchema,
  routeUploadIdempotencyKeySchema,
  routeUploadReservationRequestSchema,
  routeUploadStatusResponseSchema,
  routeUploadStorageReceiptSchema
} from "../src";

const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const at = "2026-09-20T12:00:00.000Z";

describe("TASK111 route-upload-kontrakt", () => {
  it("binder grantens hemlighet som hash och återger aldrig bearerhemlighet", () => {
    expect(routeUploadGrantIssueRequestSchema.parse({ formatVersion: 1, grantId: id, entryId: secondId, expiresAt: at, secretHash: hash }))
      .toMatchObject({ secretHash: hash });
    expect(routeUploadGrantIssueResponseSchema.safeParse({ formatVersion: 1, grantId: id, raceId: secondId, entryId: id, expiresAt: at, issuedAt: at, revokedAt: null, replayed: false, secret: "forbidden" }).success).toBe(false);
  });

  it("validerar begränsat GPX-intent, strict filnamn och idempotensnyckel", () => {
    expect(routeUploadReservationRequestSchema.parse({ formatVersion: 1, fileName: "min-rutt.gpx", mediaType: "application/gpx+xml", byteLength: ROUTE_UPLOAD_MAX_BYTES, sha256: hash })).toBeTruthy();
    expect(routeUploadReservationRequestSchema.safeParse({ formatVersion: 1, fileName: "../hemlig.gpx", mediaType: "application/gpx+xml", byteLength: 1, sha256: hash }).success).toBe(false);
    expect(routeUploadIdempotencyKeySchema.parse(`route-upload:${id}`)).toBe(`route-upload:${id}`);
    expect(routeUploadGrantRevokeRequestSchema.safeParse({ formatVersion: 1, grantId: id, reason: "  " }).success).toBe(false);
  });

  it("håller lagringsmanifest och privat kvittens fria från felaktiga tid- och lagringsfält", () => {
    expect(routeObjectManifestSchema.safeParse({ formatVersion: 1, storeId: id, key: `route/${id}/${secondId}`, versionId: "v1", mediaType: "application/gpx+xml", sha256: hash, byteLength: 42 }).success).toBe(true);
    expect(routeUploadStorageReceiptSchema.safeParse({ formatVersion: 1, uploadId: id, storedAt: at, pointCount: 2, segmentCount: 1, firstRecordedAt: at, lastRecordedAt: null, replayed: false }).success).toBe(false);
  });

  it("har en separat anonym statuskvittens utan uppladdnings- eller lagringsidentiteter", () => {
    expect(routeUploadStatusResponseSchema.parse({ formatVersion: 1, status: "not-uploaded" })).toMatchObject({ status: "not-uploaded" });
    expect(routeUploadStatusResponseSchema.parse({ formatVersion: 1, status: "stored", receipt: {
      storedAt: at, pointCount: 2, segmentCount: 1, firstRecordedAt: at, lastRecordedAt: at
    } })).toMatchObject({ status: "stored" });
    expect(routeUploadStatusResponseSchema.safeParse({ formatVersion: 1, status: "stored", receipt: {
      storedAt: at, pointCount: 2, segmentCount: 1, firstRecordedAt: null, lastRecordedAt: null, uploadId: id
    } }).success).toBe(false);
  });
});
