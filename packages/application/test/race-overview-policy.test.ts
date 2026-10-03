import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { issuePairingAdminAccessCredential } from "../src/pairing-admin";

const raceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-31T10:00:00.000Z");

function policyDatabase(insertedValues: unknown[]): Database {
  const tx = {
    select: () => ({
      from: () => ({ where: async () => [{ id: raceId }] })
    }),
    insert: () => ({
      values: async (value: unknown) => { insertedValues.push(value); }
    })
  };
  return {
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as Database;
}

describe("TASK 005J raceöversiktspolicy", () => {
  it("utfärdar exakt overviewprefix, åtta timmar och sekretessbegränsad audit", async () => {
    const insertedValues: unknown[] = [];
    const installation = await issuePairingAdminAccessCredential(policyDatabase(insertedValues), {
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      label: "Jouröversikt",
      expiresAt: new Date("2026-08-31T18:00:00.000Z")
    }, {
      now,
      id: credentialId,
      secretBytes: Buffer.alloc(32, 7)
    });

    expect(installation).toMatchObject({
      formatVersion: 1,
      credentialId,
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      expiresAt: "2026-08-31T18:00:00.000Z"
    });
    expect(installation.accessCredential).toMatch(
      /^otid_org_race_overview_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
    );
    expect(insertedValues[1]).toEqual({
      raceId,
      entityType: "race_overview_access_credential",
      entityId: credentialId,
      action: "RACE_OVERVIEW_ACCESS_CREDENTIAL_ISSUED",
      after: {
        capability: "VIEW_RACE_OVERVIEW",
        label: "Jouröversikt",
        issuedAt: "2026-08-31T10:00:00.000Z",
        expiresAt: "2026-08-31T18:00:00.000Z"
      }
    });
    expect(JSON.stringify(insertedValues[1])).not.toContain("secret");
  });

  it("avvisar mer än åtta timmar innan databasen används", async () => {
    const transaction = vi.fn();
    await expect(issuePairingAdminAccessCredential({ transaction } as unknown as Database, {
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      label: "För lång",
      expiresAt: new Date("2026-08-31T18:00:00.001Z")
    }, { now })).rejects.toThrow("Credentialen måste gälla högst 8 timmar");
    expect(transaction).not.toHaveBeenCalled();
  });
});
