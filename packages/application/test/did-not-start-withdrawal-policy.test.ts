import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { issuePairingAdminAccessCredential } from "../src/pairing-admin";

const raceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-31T10:00:00.000Z");

function policyDatabase(inserted: unknown[]): Database {
  const tx = {
    select: () => ({ from: () => ({ where: async () => [{ id: raceId }] }) }),
    insert: () => ({ values: async (value: unknown) => { inserted.push(value); } })
  };
  return { transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Database;
}

describe("TASK 006F DNS-återtagningsbehörighet", () => {
  it("utfärdar separat prefix, åtta timmar och secretfri audit", async () => {
    const inserted: unknown[] = [];
    const result = await issuePairingAdminAccessCredential(policyDatabase(inserted), {
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      label: "Rätta ej start",
      expiresAt: new Date("2026-08-31T18:00:00.000Z")
    }, { now, id: credentialId, secretBytes: Buffer.alloc(32, 19) });

    expect(result).toMatchObject({
      formatVersion: 1,
      credentialId,
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      expiresAt: "2026-08-31T18:00:00.000Z"
    });
    expect(result.accessCredential).toMatch(
      /^otid_org_did_not_start_withdrawal_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
    );
    expect(inserted[1]).toEqual({
      raceId,
      entityType: "did_not_start_withdrawal_access_credential",
      entityId: credentialId,
      action: "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED",
      after: {
        capability: "WITHDRAW_DID_NOT_START",
        label: "Rätta ej start",
        issuedAt: "2026-08-31T10:00:00.000Z",
        expiresAt: "2026-08-31T18:00:00.000Z"
      }
    });
    expect(JSON.stringify(inserted[1])).not.toMatch(/secret|hash/i);
  });

  it("avvisar mer än åtta timmar före databas", async () => {
    const transaction = vi.fn();
    await expect(issuePairingAdminAccessCredential({ transaction } as unknown as Database, {
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      label: "För lång",
      expiresAt: new Date("2026-08-31T18:00:00.001Z")
    }, { now })).rejects.toThrow("Credentialen måste gälla högst 8 timmar");
    expect(transaction).not.toHaveBeenCalled();
  });
});
