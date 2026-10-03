import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import {
  issueEventCreationAccessCredential,
  revokeEventCreationAccessCredential
} from "../src/event-creation-admin";

const now = new Date("2026-08-31T06:00:00.000Z");
const credentialId = "10000000-0000-4000-8000-000000000001";

describe("TASK 005K eventskapandepolicy", () => {
  it("utfärdar hash-only credential med separat prefix och exakt åtta timmar", async () => {
    const inserted: unknown[] = [];
    const db = {
      insert: () => ({ values: async (value: unknown) => { inserted.push(value); } })
    } as unknown as Database;
    const installation = await issueEventCreationAccessCredential(db, {
      label: "Tävlingsskapare",
      expiresAt: new Date("2026-08-31T14:00:00.000Z")
    }, { now, id: credentialId, secretBytes: Buffer.alloc(32, 17) });

    expect(installation).toMatchObject({
      formatVersion: 1,
      credentialId,
      capability: "CREATE_EVENT",
      label: "Tävlingsskapare",
      issuedAt: "2026-08-31T06:00:00.000Z",
      expiresAt: "2026-08-31T14:00:00.000Z"
    });
    expect(installation.accessCredential).toMatch(
      /^otid_org_event_create_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: credentialId,
      label: "Tävlingsskapare"
    });
    const storedHash = (inserted[0] as { secretHash?: unknown }).secretHash;
    expect(typeof storedHash).toBe("string");
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(inserted[0])).not.toContain(installation.accessCredential);
  });

  it("avvisar längre credentiallivslängd innan databasen används", async () => {
    const insert = vi.fn();
    await expect(issueEventCreationAccessCredential({ insert } as unknown as Database, {
      label: "För lång",
      expiresAt: new Date("2026-08-31T14:00:00.001Z")
    }, { now })).rejects.toThrow("Credentialen måste gälla högst 8 timmar");
    expect(insert).not.toHaveBeenCalled();
  });

  it("avvisar för lång revocationorsak innan transaktionen öppnas", async () => {
    const transaction = vi.fn();
    await expect(revokeEventCreationAccessCredential({ transaction } as unknown as Database, {
      credentialId,
      reason: "x".repeat(241)
    }, now)).rejects.toThrow("Spärrorsaken får vara högst 240 tecken");
    expect(transaction).not.toHaveBeenCalled();
  });
});
