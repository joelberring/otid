import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const nonnegativeVersion = z.number().int().min(0).max(2_147_483_647);
const positiveVersion = nonnegativeVersion.min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const mediaType = z.enum(["image/png", "image/jpeg"]);
const versionId = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/-]+$/).refine(value => value !== "null");

/** Uploads are intentionally bounded until an operational object-store policy exists. */
export const MAP_ASSET_MAX_BYTES = 50 * 1024 * 1024;

const title = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 120 && value === value.trim() &&
    value === value.normalize("NFC") &&
    !/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value);
}, "Karttiteln måste vara 1–120 tecken i NFC utan kantblanksteg eller styrtecken");

export const mapAssetUploadRequestSchema = z.object({
  formatVersion: z.literal(1),
  title,
  mediaType,
  byteLength: z.number().int().min(1).max(MAP_ASSET_MAX_BYTES),
  sha256
}).strict();

export const mapAssetUploadIdempotencyKeySchema = z.string().regex(
  new RegExp(`^map-upload:${uuidPattern}$`)
);

/** Reservation says only that a private upload slot exists; it does not mean bytes were stored. */
export const mapAssetReservationResponseSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  requestId: uuid,
  raceId: uuid,
  reservedAt: z.iso.datetime(),
  replayed: z.boolean()
}).strict();

/** Server-issued storage receipt; storage identifiers are deliberately not client input. */
export const mapAssetStorageReceiptSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  raceId: uuid,
  storedAt: z.iso.datetime(),
  replayed: z.boolean()
}).strict();

/** Storage boundary only; application still binds this exact version to its reservation. */
export const mapObjectManifestSchema = z.object({
  formatVersion: z.literal(1),
  storeId: uuid,
  key: z.string().regex(new RegExp(`^map/${uuidPattern}/${uuidPattern}$`)),
  versionId,
  mediaType,
  sha256,
  byteLength: z.number().int().min(1).max(MAP_ASSET_MAX_BYTES)
}).strict();

export const mapAssetPublishRequestSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  expectedPublicationRevision: nonnegativeVersion
}).strict();

export const mapAssetPublishIdempotencyKeySchema = z.string().regex(
  new RegExp(`^map-publish:${uuidPattern}$`)
);

export const mapAssetPublishResponseSchema = z.object({
  formatVersion: z.literal(1), publicationId: uuid, requestId: uuid, raceId: uuid,
  revision: positiveVersion, action: z.literal("PUBLISH"), manifestId: uuid,
  sourceHash: sha256, decidedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();

export const mapAssetWithdrawRequestSchema = z.object({
  formatVersion: z.literal(1),
  publicationId: uuid,
  expectedPublicationRevision: positiveVersion
}).strict();

export const mapAssetWithdrawIdempotencyKeySchema = z.string().regex(
  new RegExp(`^map-withdraw:${uuidPattern}$`)
);

export const mapAssetWithdrawResponseSchema = z.object({
  formatVersion: z.literal(1), publicationId: uuid, requestId: uuid, raceId: uuid,
  revision: positiveVersion, action: z.literal("WITHDRAW"), decidedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();

/** Public projection: no upload, object-store, bucket, key or version identifiers. */
export const publicMapMetadataSchema = z.object({
  formatVersion: z.literal(1),
  title,
  mediaType,
  byteLength: z.number().int().positive().max(MAP_ASSET_MAX_BYTES),
  sha256,
  publishedAt: z.iso.datetime()
}).strict();

const adminMapCandidateSchema = z.object({ uploadId: uuid, title, mediaType, sha256,
  byteLength: z.number().int().positive().max(MAP_ASSET_MAX_BYTES), storedAt: z.iso.datetime() }).strict();
export const adminMapAssetStateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, latestPublicationRevision: nonnegativeVersion,
  activePublication: z.object({ publicationId: uuid, revision: positiveVersion, uploadId: uuid,
    title, mediaType, sha256, byteLength: z.number().int().positive().max(MAP_ASSET_MAX_BYTES), publishedAt: z.iso.datetime() }).strict().nullable(),
  storedCandidates: z.array(adminMapCandidateSchema).max(100)
}).strict();

export type MapAssetUploadRequest = z.infer<typeof mapAssetUploadRequestSchema>;
export type MapAssetReservationResponse = z.infer<typeof mapAssetReservationResponseSchema>;
export type MapAssetStorageReceipt = z.infer<typeof mapAssetStorageReceiptSchema>;
export type MapObjectManifest = z.infer<typeof mapObjectManifestSchema>;
export type MapAssetPublishRequest = z.infer<typeof mapAssetPublishRequestSchema>;
export type MapAssetPublishResponse = z.infer<typeof mapAssetPublishResponseSchema>;
export type MapAssetWithdrawRequest = z.infer<typeof mapAssetWithdrawRequestSchema>;
export type MapAssetWithdrawResponse = z.infer<typeof mapAssetWithdrawResponseSchema>;
export type PublicMapMetadata = z.infer<typeof publicMapMetadataSchema>;
export type AdminMapAssetStateResponse = z.infer<typeof adminMapAssetStateResponseSchema>;
