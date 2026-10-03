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

describe("TASK 006B IOF ResultList-exportpolicy", () => {
  it("utfärdar separat prefix, åtta timmar och secretfri audit", async () => {
    const inserted: unknown[] = [];
    const result = await issuePairingAdminAccessCredential(policyDatabase(inserted), {
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: "Resultatexport",
      expiresAt: new Date("2026-08-31T18:00:00.000Z")
    }, { now, id: credentialId, secretBytes: Buffer.alloc(32, 11) });

    expect(result).toMatchObject({
      formatVersion: 1,
      credentialId,
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      expiresAt: "2026-08-31T18:00:00.000Z"
    });
    expect(result.accessCredential).toMatch(
      /^otid_org_result_list_export_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
    );
    expect(inserted[1]).toEqual({
      raceId,
      entityType: "iof_result_list_export_access_credential",
      entityId: credentialId,
      action: "IOF_RESULT_LIST_EXPORT_ACCESS_CREDENTIAL_ISSUED",
      after: {
        capability: "EXPORT_IOF_RESULT_LIST",
        label: "Resultatexport",
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
      capability: "EXPORT_IOF_RESULT_LIST",
      label: "För lång",
      expiresAt: new Date("2026-08-31T18:00:00.001Z")
    }, { now })).rejects.toThrow("Credentialen måste gälla högst 8 timmar");
    expect(transaction).not.toHaveBeenCalled();
  });
});
