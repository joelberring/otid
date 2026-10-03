import { describe, expect, it } from "vitest";
import {
  pairingAdminGrantIssueRequestSchema,
  pairingAdminGrantIssueResponseSchema,
  pairingAdminGrantListResponseSchema,
  pairingAdminGrantRevokeResponseSchema,
  pairingAdminLoginRequestSchema
} from "../src";

const grant = {
  formatVersion: 1 as const,
  grantId: "10000000-0000-4000-8000-000000000001",
  raceId: "20000000-0000-4000-8000-000000000002",
  scope: "READOUT" as const,
  status: "ACTIVE" as const,
  issuedAt: "2026-08-31T10:00:00.000Z",
  expiresAt: "2026-08-31T10:10:00.000Z",
  credentialExpiresAt: "2026-09-01T10:00:00.000Z",
  redeemedAt: null,
  revokedAt: null
};

describe("pairing-admin-kontrakt", () => {
  it("godtar endast strikt v1-login med accesscredential", () => {
    const request = {
      formatVersion: 1 as const,
      accessCredential: `otid_org_pair_v1.${grant.grantId}.${"A".repeat(43)}`
    };
    expect(pairingAdminLoginRequestSchema.parse(request)).toEqual(request);
    expect(pairingAdminLoginRequestSchema.safeParse({ ...request, token: "läcka" }).success).toBe(false);
    expect(pairingAdminLoginRequestSchema.safeParse({ ...request, formatVersion: 2 }).success).toBe(false);
  });

  it("låser issue-body och de tre tillåtna credential-livslängderna", () => {
    const request = { formatVersion: 1 as const, grantId: grant.grantId,
      grantSecretHash: "a".repeat(64), credentialLifetimeHours: 24 as const };
    expect(pairingAdminGrantIssueRequestSchema.parse(request)).toEqual(request);
    expect(pairingAdminGrantIssueRequestSchema.safeParse({ ...request, credentialLifetimeHours: 12 }).success).toBe(false);
    expect(pairingAdminGrantIssueRequestSchema.safeParse({ ...request, grantSecret: "hemligt" }).success).toBe(false);
  });

  it("validerar metadata och strikta issue/list/revoke-svar", () => {
    expect(pairingAdminGrantIssueResponseSchema.parse({ formatVersion: 1, status: "stored", grant }))
      .toEqual({ formatVersion: 1, status: "stored", grant });
    expect(pairingAdminGrantListResponseSchema.parse({ formatVersion: 1, grants: [grant] }).grants).toHaveLength(1);
    expect(pairingAdminGrantRevokeResponseSchema.parse({
      formatVersion: 1, status: "revoked", grant: { ...grant, status: "REVOKED", revokedAt: grant.issuedAt }
    }).status).toBe("revoked");
    expect(pairingAdminGrantListResponseSchema.safeParse({
      formatVersion: 1, grants: [{ ...grant, grantSecretHash: "a".repeat(64) }]
    }).success).toBe(false);
  });
});
