import { describe, expect, it } from "vitest";
import {
  participantClaimIssueIdempotencyKeySchema,
  participantClaimIssueRequestSchema,
  participantClaimIssueResponseSchema,
  participantClaimListResponseSchema,
  participantClaimRedeemIdempotencyKeySchema,
  participantClaimRedeemRequestSchema,
  participantClaimRedeemResponseSchema,
  participantClaimRevokeIdempotencyKeySchema,
  participantClaimRevokeRequestSchema,
  participantClaimRevokeResponseSchema,
  participantOwnResultsResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "a0000000-0000-4000-8000-000000000002";
const entryId = "a0000000-0000-4000-8000-000000000003";
const claimId = "a0000000-0000-4000-8000-000000000004";
const timestamp = "2026-09-23T12:34:56.000Z";

describe("TASK152 participant entry claim contracts", () => {
  it("accepts strict issue contracts and rejects noncanonical hash, timestamps, and fields", () => {
    const request = { formatVersion: 1, requestId, raceId, entryId, secretHash: "a".repeat(64), expiresAt: timestamp, attestation: "IDENTITY_CHECKED" };
    expect(participantClaimIssueRequestSchema.parse(request)).toEqual(request);
    expect(participantClaimIssueResponseSchema.parse({ formatVersion: 1, requestId, claimId, raceId, entryId, issuedAt: timestamp, expiresAt: timestamp, replayed: false }).claimId).toBe(claimId);
    for (const invalid of [
      { ...request, secretHash: "A".repeat(64) }, { ...request, expiresAt: "2026-09-23T14:34:56+02:00" },
      { ...request, attestation: "SELF_ATTESTED" }, { ...request, extra: true }, { ...request, requestId: requestId.toUpperCase() }
    ]) expect(participantClaimIssueRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires canonical unpadded base64url for exactly 16 bytes on redeem", () => {
    const request = { formatVersion: 1, requestId, code: "A".repeat(21) + "A" };
    expect(participantClaimRedeemRequestSchema.parse(request)).toEqual(request);
    for (const code of ["A".repeat(21), "A".repeat(20) + "AA=", "A".repeat(21) + "B", "A".repeat(21) + "+", "A".repeat(22) + "A"])
      expect(participantClaimRedeemRequestSchema.safeParse({ ...request, code }).success).toBe(false);
    expect(participantClaimRedeemResponseSchema.safeParse({ formatVersion: 1, requestId, claimedAt: timestamp, replayed: true, entryId }).success).toBe(false);
  });

  it("strictly validates revoke, claim list, and own-result projections", () => {
    const revoke = { formatVersion: 1, requestId, raceId, entryId, claimId, reason: "Fel anmälan" };
    expect(participantClaimRevokeRequestSchema.parse(revoke)).toEqual(revoke);
    expect(participantClaimRevokeRequestSchema.safeParse({ ...revoke, reason: "  " }).success).toBe(false);
    expect(participantClaimRevokeResponseSchema.safeParse({ formatVersion: 1, requestId, claimId, revokedAt: timestamp, replayed: false }).success).toBe(true);
    expect(participantClaimListResponseSchema.safeParse({ formatVersion: 1, raceId, entryId, claims: [{ claimId, issuedAt: timestamp, expiresAt: timestamp, redeemedAt: null, revokedAt: null }] }).success).toBe(true);
    expect(participantOwnResultsResponseSchema.safeParse({ formatVersion: 1, items: [{ raceId, eventName: "Vårträffen", raceName: "Lång", result: null }] }).success).toBe(true);
    expect(participantOwnResultsResponseSchema.safeParse({ formatVersion: 1, items: [{ raceId, eventName: "Vårträffen", raceName: "Lång", result: null, entryId }] }).success).toBe(false);
  });

  it("accepts only exact prefixed idempotency keys with canonical UUIDs", () => {
    const valid = [
      [participantClaimIssueIdempotencyKeySchema, `participant-claim-issue:${requestId}`],
      [participantClaimRedeemIdempotencyKeySchema, `participant-claim-redeem:${requestId}`],
      [participantClaimRevokeIdempotencyKeySchema, `participant-claim-revoke:${requestId}`]
    ] as const;
    for (const [schema, key] of valid) {
      expect(schema.safeParse(key).success).toBe(true);
      expect(schema.safeParse(`${key}:retry`).success).toBe(false);
      expect(schema.safeParse(key.replace(requestId, requestId.toUpperCase())).success).toBe(false);
    }
  });
});
