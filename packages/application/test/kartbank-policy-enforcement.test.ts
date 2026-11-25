import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { usageScopeBlockedReason } from "../src/club-map-use";
import { downloadPublicMapSource, readPublicMapPreview } from "../src/public-map-catalog";
import { readRaceMapSourceFileAsAdmin } from "../src/race-map-source";
import { readMapLinkMapFile } from "../src/course-setting-map-link";

vi.mock("../src/course-setting-access", () => ({
  requireCourseSettingAccess: vi.fn(async () => ({
    status: "authenticated",
    principal: { raceId: "11111111-1111-4111-8111-111111111111", eventId: "22222222-2222-4222-8222-222222222222", accountId: "33333333-3333-4333-8333-333333333333", displayName: "Test", level: "EDIT", admin: true, guest: false }
  }))
}));

vi.mock("../src/account-throttle", () => ({
  consumeAccountRequestAllowance: vi.fn(async () => true)
}));

/** Enkel kedjebar mock för Drizzle `select().from()...where()`. */
function mockSelectDb(rows: unknown[]): Database {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows))
  };
  const db = {
    select: () => chain,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  };
  return db as unknown as Database;
}

describe("usageScopeBlockedReason", () => {
  it("allows ANY for all club roles regardless of race ownership", () => {
    expect(usageScopeBlockedReason("READER", "ANY", false)).toBeNull();
    expect(usageScopeBlockedReason("LEADER", "ANY", false)).toBeNull();
    expect(usageScopeBlockedReason("ADMIN", "ANY", false)).toBeNull();
    expect(usageScopeBlockedReason("OWNER", "ANY", false)).toBeNull();
  });

  it("blocks ADMIN_ONLY for LEADER and READER, allows ADMIN and OWNER", () => {
    expect(usageScopeBlockedReason("READER", "ADMIN_ONLY", true)).toBe("ADMIN_ONLY");
    expect(usageScopeBlockedReason("LEADER", "ADMIN_ONLY", true)).toBe("ADMIN_ONLY");
    expect(usageScopeBlockedReason("ADMIN", "ADMIN_ONLY", false)).toBeNull();
    expect(usageScopeBlockedReason("OWNER", "ADMIN_ONLY", false)).toBeNull();
  });

  it("blocks CLUB_ACTIVITIES_ONLY when raceBelongsToClub is false", () => {
    expect(usageScopeBlockedReason("ADMIN", "CLUB_ACTIVITIES_ONLY", false)).toBe("CLUB_ACTIVITIES_ONLY");
    expect(usageScopeBlockedReason("READER", "CLUB_ACTIVITIES_ONLY", false)).toBe("CLUB_ACTIVITIES_ONLY");
    expect(usageScopeBlockedReason("READER", "CLUB_ACTIVITIES_ONLY", true)).toBeNull();
    expect(usageScopeBlockedReason("READER", "CLUB_ACTIVITIES_ONLY", undefined)).toBeNull();
  });
});

describe("download lock enforcement", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("blocks readRaceMapSourceFileAsAdmin when sourceDownloadLocked is true", async () => {
    const db = mockSelectDb([{
      fileName: "hemlig.ocd",
      format: "OCD",
      sha256: "a".repeat(64),
      contentSha256: "a".repeat(64),
      sourceDownloadLocked: true
    }]);
    const result = await readRaceMapSourceFileAsAdmin(db, { raceId: id, sessionToken: "tok" });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("blocks readMapLinkMapFile when sourceDownloadLocked is true", async () => {
    const future = new Date(Date.now() + 86_400_000);
    let call = 0;
    const db = {
      select: () => {
        call += 1;
        const rows = call === 1
          ? [{ id: "link-1", raceId: id, tokenHash: "h", createdBy: "u", createdAt: new Date(), expiresAt: future, revokedAt: null, revokedBy: null, showRaceName: false, lastOpenedAt: null }]
          : [{ format: "OCD", sha256: "a".repeat(64), inline: null, contentSha256: "a".repeat(64), sourceDownloadLocked: true }];
        const chain = {
          from: () => chain,
          where: () => chain,
          for: () => chain,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows))
        };
        return chain;
      },
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
    } as unknown as Database;

    const token = "A".repeat(43);
    const result = await readMapLinkMapFile(db, { token, clientKey: "127.0.0.1" });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("blocks downloadPublicMapSource unless accessMode is OPEN_DOWNLOAD", async () => {
    const lockedDb = mockSelectDb([{
      accessMode: "USE_IN_OTID_LOCKED",
      title: "Låst karta",
      format: "OCD",
      contentSha256: "b".repeat(64),
      byteLength: 1024,
      contentId: "44444444-4444-4444-8444-444444444444"
    }]);
    expect(await downloadPublicMapSource(lockedDb, id)).toEqual({ status: "forbidden" });

    const infoDb = mockSelectDb([{
      accessMode: "INFO_ONLY",
      title: "Endast info",
      format: "OMAP",
      contentSha256: "b".repeat(64),
      byteLength: 1024,
      contentId: "44444444-4444-4444-8444-444444444444"
    }]);
    expect(await downloadPublicMapSource(infoDb, id)).toEqual({ status: "forbidden" });

    const openDb = mockSelectDb([{
      accessMode: "OPEN_DOWNLOAD",
      title: "Öppen karta",
      format: "OMAP",
      contentSha256: "b".repeat(64),
      byteLength: 2048,
      contentId: "44444444-4444-4444-8444-444444444444"
    }]);
    const openResult = await downloadPublicMapSource(openDb, id);
    expect(openResult.status).toBe("ok");
    if (openResult.status === "ok") {
      expect(openResult.fileName).toBe("Öppen karta.omap");
      expect(openResult.byteLength).toBe(2048);
    }
  });

  it("hides preview image when showPreview is false even if previewContentSha256 exists", async () => {
    const db = mockSelectDb([{ showPreview: false, previewContentSha256: "c".repeat(64) }]);
    expect(await readPublicMapPreview(db, id)).toEqual({ status: "not-found" });
  });
});
