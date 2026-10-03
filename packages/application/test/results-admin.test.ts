import { describe, expect, it } from "vitest";
import type { Database } from "@o-tid/database";
import { changeEntryClassAsAdmin, recalculateEntryAsAdmin } from "../src/results";

describe("changeEntryClassAsAdmin requestgräns", () => {
  it("avvisar icke-strikt body och ogiltiga id före databas/auth", async () => {
    const database = new Proxy({}, {
      get() {
        throw new Error("Databasen får inte läsas före requestvalidering");
      }
    }) as Database;

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
    })).resolves.toEqual({ status: "invalid-request" });
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
