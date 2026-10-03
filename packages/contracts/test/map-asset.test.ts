import { describe, expect, it } from "vitest";
import {
  MAP_ASSET_MAX_BYTES,
  mapAssetPublishIdempotencyKeySchema,
  mapAssetPublishRequestSchema,
  mapAssetUploadIdempotencyKeySchema,
  mapAssetUploadRequestSchema,
  mapAssetReservationResponseSchema,
  mapAssetStorageReceiptSchema,
  mapObjectManifestSchema,
  mapAssetWithdrawIdempotencyKeySchema,
  mapAssetWithdrawRequestSchema,
  publicMapMetadataSchema
} from "../src";

const id = "12345678-1234-4234-8234-123456789abc";
const upload = { formatVersion: 1, title: "Skärgårdshelgen", mediaType: "image/png", byteLength: 42, sha256: "a".repeat(64) } as const;

describe("TASK106 map asset contracts", () => {
  it("accepts only bounded PNG/JPEG upload intent", () => {
    expect(mapAssetUploadRequestSchema.parse(upload)).toEqual(upload);
    expect(mapAssetUploadRequestSchema.safeParse({ ...upload, byteLength: MAP_ASSET_MAX_BYTES }).success).toBe(true);
    for (const mediaType of ["application/pdf", "image/svg+xml", "IMAGE/PNG"]) {
      expect(mapAssetUploadRequestSchema.safeParse({ ...upload, mediaType }).success).toBe(false);
    }
    for (const byteLength of [0, -1, 1.5, MAP_ASSET_MAX_BYTES + 1]) {
      expect(mapAssetUploadRequestSchema.safeParse({ ...upload, byteLength }).success).toBe(false);
    }
  });

  it("retains canonical title and lowercase hash without rewriting", () => {
    for (const title of ["", " karta", "karta ", "Ka\u0061\u0308rta", "karta\u0000", "karta\u202e"]) {
      expect(mapAssetUploadRequestSchema.safeParse({ ...upload, title }).success).toBe(false);
    }
    expect(mapAssetUploadRequestSchema.safeParse({ ...upload, sha256: "A".repeat(64) }).success).toBe(false);
  });

  it("distinguishes reservation from stored receipt and accepts strict publish/withdraw intents", () => {
    expect(mapAssetReservationResponseSchema.parse({ formatVersion: 1, uploadId: id, requestId: id, raceId: id, reservedAt: "2026-09-20T12:00:00.000Z", replayed: false })).toBeTruthy();
    expect(mapAssetStorageReceiptSchema.parse({ formatVersion: 1, uploadId: id, raceId: id, storedAt: "2026-09-20T12:00:00.000Z", replayed: false })).toBeTruthy();
    expect(mapAssetReservationResponseSchema.safeParse({ formatVersion: 1, uploadId: id, requestId: id, raceId: id, storedAt: "2026-09-20T12:00:00.000Z", replayed: false }).success).toBe(false);
    expect(mapAssetPublishRequestSchema.safeParse({ formatVersion: 1, uploadId: id, expectedPublicationRevision: 1 }).success).toBe(true);
    expect(mapAssetWithdrawRequestSchema.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 1 }).success).toBe(true);
    expect(mapAssetPublishRequestSchema.safeParse({ formatVersion: 1, uploadId: id, expectedPublicationRevision: 0 }).success).toBe(true);
    expect(mapAssetWithdrawRequestSchema.safeParse({ formatVersion: 1, publicationId: id, expectedPublicationRevision: 0 }).success).toBe(false);
  });

  it("separates canonical operation keys and rejects storage identifiers", () => {
    expect(mapAssetUploadIdempotencyKeySchema.parse(`map-upload:${id}`)).toBe(`map-upload:${id}`);
    expect(mapAssetPublishIdempotencyKeySchema.parse(`map-publish:${id}`)).toBe(`map-publish:${id}`);
    expect(mapAssetWithdrawIdempotencyKeySchema.parse(`map-withdraw:${id}`)).toBe(`map-withdraw:${id}`);
    expect(mapAssetUploadIdempotencyKeySchema.safeParse(`map-upload:${id.toUpperCase()}`).success).toBe(false);
    expect(mapAssetPublishIdempotencyKeySchema.safeParse(`map-upload:${id}`).success).toBe(false);
    expect(mapAssetUploadRequestSchema.safeParse({ ...upload, objectKey: "private/key", versionId: "v1" }).success).toBe(false);
  });

  it("keeps public metadata free of storage and internal identifiers", () => {
    const metadata = { formatVersion: 1, title: upload.title, mediaType: upload.mediaType, byteLength: upload.byteLength, sha256: upload.sha256, publishedAt: "2026-09-20T12:00:00.000Z" };
    expect(publicMapMetadataSchema.parse(metadata)).toEqual(metadata);
    for (const field of ["uploadId", "raceId", "objectKey", "bucket", "versionId", "publicationId"]) {
      expect(publicMapMetadataSchema.safeParse({ ...metadata, [field]: id }).success).toBe(false);
    }
  });

  it("accepts only a canonical private map manifest version", () => {
    const manifest = { formatVersion: 1, storeId: id, key: `map/${id}/${id}`, versionId: "version-1", mediaType: "image/png", sha256: upload.sha256, byteLength: upload.byteLength } as const;
    expect(mapObjectManifestSchema.parse(manifest)).toEqual(manifest);
    for (const value of [{ ...manifest, key: `pm/${id}/${id}` }, { ...manifest, key: `map/${id}/not-a-uuid` }, { ...manifest, versionId: "null" }]) {
      expect(mapObjectManifestSchema.safeParse(value).success).toBe(false);
    }
  });
});
