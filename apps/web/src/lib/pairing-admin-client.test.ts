import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clearPairingGrantMaterial,
  createPairingGrantMaterial,
  pairingGrantIssueBody,
  pairingGrantToken,
  parsePairingGrantIssue,
  parsePairingGrantList,
  readPairingAdminCsrf,
  type PairingGrantMetadata
} from "./pairing-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const grantId = "10000000-0000-4000-8000-000000000002";

function metadata(overrides: Partial<PairingGrantMetadata> = {}): PairingGrantMetadata {
  return {
    formatVersion: 1,
    grantId,
    raceId,
    scope: "READOUT",
    status: "ACTIVE",
    issuedAt: "2026-08-31T08:00:00.000Z",
    expiresAt: "2026-08-31T08:10:00.000Z",
    credentialExpiresAt: "2026-09-01T08:00:00.000Z",
    redeemedAt: null,
    revokedAt: null,
    ...overrides
  };
}

describe("pairing admin client boundary", () => {
  it("generates a canonical id and 32-byte Web Crypto secret but sends only its hash", async () => {
    const material = await createPairingGrantMaterial(24);
    const body = pairingGrantIssueBody(material);
    expect(material.grantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(material.secret).toHaveLength(32);
    expect(body).toEqual({
      formatVersion: 1,
      grantId: material.grantId,
      grantSecretHash: material.grantSecretHash,
      credentialLifetimeHours: 24
    });
    expect(body.grantSecretHash).toBe(createHash("sha256").update(material.secret).digest("hex"));
    expect(JSON.stringify(body)).not.toContain(pairingGrantToken(material).split(".")[2]);
    clearPairingGrantMaterial(material);
    expect([...material.secret]).toEqual(new Array(32).fill(0));
  });

  it("constructs the canonical one-time token only after a matching response", () => {
    const secret = new Uint8Array(32).fill(7);
    const material = {
      grantId,
      secret,
      grantSecretHash: createHash("sha256").update(secret).digest("hex"),
      credentialLifetimeHours: 8 as const
    };
    expect(parsePairingGrantIssue({ formatVersion: 1, status: "stored", grant: metadata() }, material, raceId))
      .toMatchObject({ status: "stored", grant: { grantId, raceId } });
    expect(pairingGrantToken(material)).toMatch(new RegExp(`^otid_pair_v1\\.${grantId}\\.[A-Za-z0-9_-]{43}$`));
    expect(() => parsePairingGrantIssue({
      formatVersion: 1,
      status: "stored",
      grant: metadata({ grantId: "10000000-0000-4000-8000-000000000003" })
    }, material, raceId)).toThrow("matchar inte");
  });

  it("rejects secret-bearing, cross-race and contradictory list metadata", () => {
    expect(() => parsePairingGrantList({ formatVersion: 1, grants: [{ ...metadata(), token: "secret" }] }, raceId))
      .toThrow("ogiltig grantlista");
    expect(() => parsePairingGrantList({
      formatVersion: 1,
      grants: [metadata({ raceId: "10000000-0000-4000-8000-000000000004" })]
    }, raceId)).toThrow("annat lopp");
    expect(() => parsePairingGrantList({
      formatVersion: 1,
      grants: [metadata({ status: "REDEEMED", redeemedAt: null })]
    }, raceId)).toThrow("motsägande");
    expect(parsePairingGrantList({
      formatVersion: 1,
      grants: [metadata({
        status: "REDEEMED",
        redeemedAt: "2026-08-31T08:05:00.000Z",
        revokedAt: "2026-08-31T08:06:00.000Z"
      })]
    }, raceId)[0]?.status).toBe("REDEEMED");
  });

  it("selects only the environment-appropriate host-only CSRF cookie", () => {
    const csrf = "A".repeat(43);
    expect(readPairingAdminCsrf(`otid_pairing_admin_csrf=${csrf}`, new URL("http://localhost:3000/admin"))).toBe(csrf);
    expect(readPairingAdminCsrf(`__Host-otid-pairing-admin-csrf=${csrf}`, new URL("https://otid.example/admin"))).toBe(csrf);
    expect(() => readPairingAdminCsrf(`otid_pairing_admin_csrf=${csrf}`, new URL("https://otid.example/admin")))
      .toThrow("CSRF-session saknas");
  });
});
