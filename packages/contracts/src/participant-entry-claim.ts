import { z } from "zod";
import { publicResultV7Schema } from "./public-results";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const utcInstant = z.iso.datetime();
const requestIdempotencyKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}${uuidPattern}$`));

export const participantClaimIssueRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, raceId: uuid, entryId: uuid,
  secretHash: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: utcInstant,
  attestation: z.literal("IDENTITY_CHECKED")
}).strict();

export const participantClaimIssueResponseSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, claimId: uuid, raceId: uuid, entryId: uuid,
  issuedAt: utcInstant, expiresAt: utcInstant, replayed: z.boolean()
}).strict();

export const participantClaimIssueIdempotencyKeySchema = requestIdempotencyKey("participant-claim-issue:");

export const participantClaimRedeemRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid,
  // 16 bytes encoded as unpadded base64url is 22 characters; the final sextet
  // has four zero padding bits, so only these four characters are canonical.
  code: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/)
}).strict();

export const participantClaimRedeemResponseSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, claimedAt: utcInstant, replayed: z.boolean()
}).strict();

export const participantClaimRedeemIdempotencyKeySchema = requestIdempotencyKey("participant-claim-redeem:");

export const participantClaimRevokeRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, raceId: uuid, entryId: uuid, claimId: uuid,
  reason: z.string().trim().min(1).max(240)
}).strict();

export const participantClaimRevokeResponseSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, claimId: uuid, revokedAt: utcInstant, replayed: z.boolean()
}).strict();

export const participantClaimRevokeIdempotencyKeySchema = requestIdempotencyKey("participant-claim-revoke:");

const participantEntryClaimListItemSchema = z.object({
  claimId: uuid, issuedAt: utcInstant, expiresAt: utcInstant,
  redeemedAt: utcInstant.nullable(), revokedAt: utcInstant.nullable()
}).strict();

export const participantClaimListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid,
  claims: z.array(participantEntryClaimListItemSchema).max(100)
}).strict();

const ownResultItemSchema = z.object({
  raceId: uuid, eventName: z.string().trim().min(1).max(240), raceName: z.string().trim().min(1).max(240),
  result: publicResultV7Schema.nullable()
}).strict();

export const participantOwnResultsResponseSchema = z.object({
  formatVersion: z.literal(1), items: z.array(ownResultItemSchema).max(10_000)
}).strict();

export type ParticipantClaimIssueRequest = z.infer<typeof participantClaimIssueRequestSchema>;
export type ParticipantClaimIssueResponse = z.infer<typeof participantClaimIssueResponseSchema>;
export type ParticipantClaimRedeemRequest = z.infer<typeof participantClaimRedeemRequestSchema>;
export type ParticipantClaimRedeemResponse = z.infer<typeof participantClaimRedeemResponseSchema>;
export type ParticipantClaimRevokeRequest = z.infer<typeof participantClaimRevokeRequestSchema>;
export type ParticipantClaimRevokeResponse = z.infer<typeof participantClaimRevokeResponseSchema>;
export type ParticipantClaimListResponse = z.infer<typeof participantClaimListResponseSchema>;
export type ParticipantOwnResultsResponse = z.infer<typeof participantOwnResultsResponseSchema>;
