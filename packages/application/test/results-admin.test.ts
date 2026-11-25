import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import * as raceSession from "../src/race-session";
import { changeEntryClassAsAdmin } from "../src/results";
import { recalculateEntryAsAdmin } from "../src/result-recalculation";

describe("changeEntryClassAsAdmin requestgräns", () => {
  it("prövar behörighet före requestvalidering (401/403 före 400) och avvisar ogiltig kropp/UUID efter behörighet", async () => {
    const tx = new Proxy({}, {
      get() {
        throw new Error("Databasen får inte läsas");
      }
    });
    const database = {
      transaction: async <T>(fn: (executor: unknown) => Promise<T>) => fn(tx)
    } as unknown as Database;

    // Utloggad med ogiltig kropp/UUID prövas mot requireRaceRole först och får unauthorized (401 före 400).
    const unauthSpy = vi.spyOn(raceSession, "requireRaceRole").mockResolvedValueOnce({ status: "unauthorized" });
    try {
      await expect(changeEntryClassAsAdmin(database, {
        sessionToken: null,
        raceId: "inte-ett-uuid",
        csrfCookie: null,
        csrfHeader: null,
        entryId: "inte-ett-uuid",
        idempotencyKey: "entry-class-change:inte-ett-uuid",
        request: {
          formatVersion: 1,
          classId: "inte-ett-uuid",
          expectedEntryVersion: 0,
          extra: true
        }
      })).resolves.toEqual({ status: "unauthorized" });
      expect(unauthSpy).toHaveBeenCalledTimes(1);
    } finally {
      unauthSpy.mockRestore();
    }

    // När behörigheten väl är godkänd avvisas ogiltig kropp/UUID med invalid-request utan att läsa tabeller.
    const spy = vi.spyOn(raceSession, "requireRaceRole").mockResolvedValueOnce({
      status: "authenticated",
      principal: {
        accountId: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000002",
        raceId: "00000000-0000-4000-8000-000000000003",
        eventId: "00000000-0000-4000-8000-000000000004",
        grantId: "00000000-0000-4000-8000-000000000005",
        grantRole: "ADMIN",
        role: "ADMIN",
        expiresAt: "2026-12-01T00:00:00.000Z"
      }
    });
    try {
      await expect(changeEntryClassAsAdmin(database, {
        sessionToken: "token",
        raceId: "00000000-0000-4000-8000-000000000003",
        csrfCookie: "csrf",
        csrfHeader: "csrf",
        entryId: "inte-ett-uuid",
        idempotencyKey: "entry-class-change:inte-ett-uuid",
        request: {
          formatVersion: 1,
          classId: "inte-ett-uuid",
          expectedEntryVersion: 0,
          extra: true
        }
      })).resolves.toEqual({ status: "invalid-request" });
    } finally {
      spy.mockRestore();
    }
  });

  it("avvisar icke-strikt omräkningsintent före databas/auth", async () => {
    const database = new Proxy({}, {
      get() {
        throw new Error("Databasen får inte läsas före requestvalidering");
      }
    }) as Database;

    await expect(recalculateEntryAsAdmin(database, {
      sessionToken: null,
      raceId: "inte-ett-uuid",
      csrfCookie: null,
      csrfHeader: null,
      entryId: "inte-ett-uuid",
      idempotencyKey: "result-recalculation:inte-ett-uuid",
      request: { formatVersion: 1, extra: true }
    })).resolves.toEqual({ status: "invalid-request" });
  });
});
