import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { readClubEntryThumbnail, readClubMapVersionThumbnail } from "../src/club-archive-checks";

vi.mock("../src/club-access", () => ({
  requireClubArea: vi.fn(async () => ({ status: "ok", accountId: "11111111-1111-4111-8111-111111111111", role: "READER" })),
  requireClubRole: vi.fn(),
  clubAreaAccess: vi.fn(),
  clubJournal: vi.fn()
}));

const clubId = "10000000-0000-4000-8000-000000000001";
const versionId = "10000000-0000-4000-8000-000000000002";
const entryId = "10000000-0000-4000-8000-000000000003";
const stamp = new Date("2026-11-26T10:00:00.000Z");

function mockMetaOnlyDb(rows: unknown[]): { db: Database; selects: ReturnType<typeof vi.fn> } {
  const selects = vi.fn(() => {
    if (selects.mock.calls.length > 1) throw new Error("Bytea-kolumnen ska inte läsas vid 304");
    const chain = {
      from: () => chain,
      where: () => chain,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows))
    };
    return chain;
  });
  const db = {
    select: selects,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  } as unknown as Database;
  return { db, selects };
}

describe("club-archive-checks: 304 på tumnaglar före bytea-läsning", () => {
  it("readClubMapVersionThumbnail ger not-modified med bara metadata-frågan när svag W/-ETag matchar", async () => {
    const etag = `"${versionId}-${stamp.getTime()}"`;
    const { db, selects } = mockMetaOnlyDb([{ hasPng: true, checkedAt: stamp }]);
    const result = await readClubMapVersionThumbnail(db, {
      sessionToken: "tok", csrfCookie: null, csrfHeader: null,
      clubId, versionId, ifNoneMatch: `W/${etag}`
    });
    expect(result).toEqual({ status: "not-modified", etag, stamp: stamp.toISOString() });
    expect(selects).toHaveBeenCalledTimes(1);
  });

  it("readClubEntryThumbnail ger not-modified med bara metadata-frågan när svag W/-ETag matchar", async () => {
    const etag = `"${entryId}-${stamp.getTime()}"`;
    const { db, selects } = mockMetaOnlyDb([{ hasPng: true, createdAt: stamp }]);
    const result = await readClubEntryThumbnail(db, {
      sessionToken: "tok", csrfCookie: null, csrfHeader: null,
      clubId, entryId, ifNoneMatch: `"other", W/${etag}`
    });
    expect(result).toEqual({ status: "not-modified", etag, stamp: stamp.toISOString() });
    expect(selects).toHaveBeenCalledTimes(1);
  });
});
