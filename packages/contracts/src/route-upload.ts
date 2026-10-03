import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });
const versionId = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/-]+$/).refine(value => value !== "null");

export const ROUTE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const ROUTE_UPLOAD_MAX_POINTS = 100_000;
export const ROUTE_UPLOAD_MAX_SEGMENTS = 2_000;

const fileName = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 120 && value === value.trim() && value === value.normalize("NFC") &&
    !/[\\/\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value);
}, "Filnamnet måste vara 1–120 NFC-tecken utan sökväg, kantblanksteg eller styrtecken");

export const routeUploadGrantIssueRequestSchema = z.object({
  formatVersion: z.literal(1),
  grantId: uuid,
  entryId: uuid,
  expiresAt: instant,
  secretHash: sha256
}).strict();

export const routeUploadGrantIssueIdempotencyKeySchema = z.string().regex(
  new RegExp(`^route-upload-grant:${uuidPattern}$`)
);

export const routeUploadGrantMetadataSchema = z.object({
  formatVersion: z.literal(1),
  grantId: uuid,
  raceId: uuid,
  entryId: uuid,
  expiresAt: instant,
  issuedAt: instant,
  revokedAt: instant.nullable()
}).strict();

/** The bearer secret is never echoed: the issuing browser owns the only plaintext copy. */
export const routeUploadGrantIssueResponseSchema = z.object({
  ...routeUploadGrantMetadataSchema.shape,
  replayed: z.boolean()
}).strict();

export const routeUploadGrantRevokeRequestSchema = z.object({
  formatVersion: z.literal(1),
  grantId: uuid,
  reason: z.string().trim().min(1).max(240)
}).strict();
export const routeUploadGrantRevokeIdempotencyKeySchema = z.string().regex(
  new RegExp(`^route-upload-grant-revoke:${uuidPattern}$`)
);
export const routeUploadGrantRevokeResponseSchema = z.object({
  ...routeUploadGrantMetadataSchema.shape,
  replayed: z.boolean()
}).strict();

/** Private administrator projection; it deliberately contains neither a secret nor a secret hash. */
export const routeUploadGrantListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  grants: z.array(routeUploadGrantMetadataSchema)
}).strict();

export const routeUploadReservationRequestSchema = z.object({
  formatVersion: z.literal(1),
  fileName,
  mediaType: z.literal("application/gpx+xml"),
  byteLength: z.number().int().min(1).max(ROUTE_UPLOAD_MAX_BYTES),
  sha256
}).strict();

export const routeUploadIdempotencyKeySchema = z.string().regex(
  new RegExp(`^route-upload:${uuidPattern}$`)
);

export const routeUploadReservationResponseSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  requestId: uuid,
  grantId: uuid,
  reservedAt: instant,
  replayed: z.boolean()
}).strict();

/** The receipt contains only participant-safe import facts, never point or store identifiers. */
export const routeUploadStorageReceiptSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  storedAt: instant,
  pointCount: z.number().int().min(2).max(ROUTE_UPLOAD_MAX_POINTS),
  segmentCount: z.number().int().min(1).max(ROUTE_UPLOAD_MAX_SEGMENTS),
  firstRecordedAt: instant.nullable(),
  lastRecordedAt: instant.nullable(),
  replayed: z.boolean()
}).strict().refine((value) => (value.firstRecordedAt === null) === (value.lastRecordedAt === null));

/**
 * Private read projection for a participant reopening a valid link. It is
 * deliberately distinct from the transfer receipt: upload/request/grant and
 * storage identifiers must never become readable through this endpoint.
 */
export const routeUploadStoredStatusReceiptSchema = z.object({
  storedAt: instant,
  pointCount: z.number().int().min(2).max(ROUTE_UPLOAD_MAX_POINTS),
  segmentCount: z.number().int().min(1).max(ROUTE_UPLOAD_MAX_SEGMENTS),
  firstRecordedAt: instant.nullable(),
  lastRecordedAt: instant.nullable()
}).strict().refine((value) => (value.firstRecordedAt === null) === (value.lastRecordedAt === null));

/** A private link can either still accept its one route, or report its safe stored receipt. */
export const routeUploadStatusResponseSchema = z.discriminatedUnion("status", [
  z.object({ formatVersion: z.literal(1), status: z.literal("not-uploaded") }).strict(),
  z.object({ formatVersion: z.literal(1), status: z.literal("stored"), receipt: routeUploadStoredStatusReceiptSchema }).strict()
]);

const routePublicationConsent = z.enum(["PRIVATE", "READY_FOR_FUTURE_PUBLICATION"]);
const routePublicationDecision = z.enum(["GRANT", "WITHDRAW"]);

/** Participant-safe state for exactly the route resolved from the private grant session. */
export const routePublicationConsentStateResponseSchema = z.discriminatedUnion("status", [
  z.object({ formatVersion: z.literal(1), status: z.literal("not-uploaded") }).strict(),
  z.object({ formatVersion: z.literal(1), status: z.literal("stored"), consent: routePublicationConsent,
    revision: z.number().int().min(0).max(2_147_483_647), decidedAt: instant.nullable() }).strict()
]);
export const routePublicationConsentRequestSchema = z.object({ formatVersion: z.literal(1), decision: routePublicationDecision }).strict();
export const routePublicationConsentIdempotencyKeySchema = z.string().regex(new RegExp(`^route-publication-consent:${uuidPattern}$`));
export const routePublicationConsentResponseSchema = z.object({ formatVersion: z.literal(1), status: z.literal("stored"),
  consent: routePublicationConsent, revision: z.number().int().min(1).max(2_147_483_647), decidedAt: instant, replayed: z.boolean() }).strict();

/** Internal storage boundary; never serialize this schema to a participant or public result response. */
export const routeObjectManifestSchema = z.object({
  formatVersion: z.literal(1),
  storeId: uuid,
  key: z.string().regex(new RegExp(`^route/${uuidPattern}/${uuidPattern}$`)),
  versionId,
  mediaType: z.literal("application/gpx+xml"),
  sha256,
  byteLength: z.number().int().min(1).max(ROUTE_UPLOAD_MAX_BYTES)
}).strict();

export type RouteUploadGrantIssueRequest = z.infer<typeof routeUploadGrantIssueRequestSchema>;
export type RouteUploadGrantMetadata = z.infer<typeof routeUploadGrantMetadataSchema>;
export type RouteUploadGrantIssueResponse = z.infer<typeof routeUploadGrantIssueResponseSchema>;
export type RouteUploadGrantRevokeRequest = z.infer<typeof routeUploadGrantRevokeRequestSchema>;
export type RouteUploadGrantRevokeResponse = z.infer<typeof routeUploadGrantRevokeResponseSchema>;
export type RouteUploadGrantListResponse = z.infer<typeof routeUploadGrantListResponseSchema>;
export type RouteUploadReservationRequest = z.infer<typeof routeUploadReservationRequestSchema>;
export type RouteUploadReservationResponse = z.infer<typeof routeUploadReservationResponseSchema>;
export type RouteUploadStorageReceipt = z.infer<typeof routeUploadStorageReceiptSchema>;
export type RouteUploadStoredStatusReceipt = z.infer<typeof routeUploadStoredStatusReceiptSchema>;
export type RouteUploadStatusResponse = z.infer<typeof routeUploadStatusResponseSchema>;
export type RoutePublicationConsentStateResponse = z.infer<typeof routePublicationConsentStateResponseSchema>;
export type RoutePublicationConsentRequest = z.infer<typeof routePublicationConsentRequestSchema>;
export type RoutePublicationConsentResponse = z.infer<typeof routePublicationConsentResponseSchema>;
export type RouteObjectManifest = z.infer<typeof routeObjectManifestSchema>;
