import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { issuePairingAdminAccessCredential } from "../src/pairing-admin";

const raceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-01T10:00:00.000Z");

function policyDatabase(inserted: unknown[]): Database {
  const tx = {
    select: () => ({ from: () => ({ where: async () => [{ id: raceId }] }) }),
    insert: () => ({ values: async (value: unknown) => { inserted.push(value); } })
  };
  return { transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Database;
}

describe.each([
  ["APPROVE_RESULT", "otid_org_result_approval_v1", "result_approval_access_credential", "RESULT_APPROVAL_ACCESS_CREDENTIAL_ISSUED"],
  ["WITHDRAW_RESULT_APPROVAL", "otid_org_result_approval_withdrawal_v1", "result_approval_withdrawal_access_credential", "RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL_ISSUED"]
] as const)("TASK 006H %s-behörighet", (capability, prefix, entityType, action) => {
  it("utfärdar separat prefix, åtta timmar och secretfri audit", async () => {
    const inserted: unknown[] = [];
    const result = await issuePairingAdminAccessCredential(policyDatabase(inserted), {
      raceId, capability, label: "Resultatgodkännande", expiresAt: new Date("2026-09-01T18:00:00.000Z")
    }, { now, id: credentialId, secretBytes: Buffer.alloc(32, 23) });
    expect(result.accessCredential).toMatch(new RegExp(`^${prefix}\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}$`));
    expect(result).toMatchObject({ credentialId, raceId, capability, expiresAt: "2026-09-01T18:00:00.000Z" });
    expect(inserted[1]).toMatchObject({ entityType, entityId: credentialId, action });
    expect(JSON.stringify(inserted[1])).not.toMatch(/secret|hash/i);
  });

  it("avvisar en credential över åtta timmar före databas", async () => {
    const transaction = vi.fn();
    await expect(issuePairingAdminAccessCredential({ transaction } as unknown as Database, {
      raceId, capability, label: "För lång", expiresAt: new Date("2026-09-01T18:00:00.001Z")
    }, { now })).rejects.toThrow("Credentialen måste gälla högst 8 timmar");
    expect(transaction).not.toHaveBeenCalled();
  });
});
