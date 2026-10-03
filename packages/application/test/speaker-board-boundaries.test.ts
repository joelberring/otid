import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Database } from "@o-tid/database";
import { listSpeakerBoardAsAdmin } from "../src/speaker-board";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn() }));
vi.mock("../src/pairing-admin", () => ({ authenticatePairingAdminSessionForProtectedRead: mocks.auth }));
vi.mock("../src/result-revision-state", () => ({ resolveStoredResultHeadStates: mocks.resolve }));
const raceId = "10000000-0000-4000-8000-000000000002";
const entryId = "20000000-0000-4000-8000-000000000002";
const reachedResolver = new Error("test reached central resolver");

function fixture(counts: number[], duplicate = false) {
  const limits: number[] = [];
  const tables: unknown[] = [];
  let selects = 0;
  const tx = {
    selectDistinctOn: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ as: () => ({
      id: schema.resultRevisions.id, createdAt: schema.resultRevisions.createdAt
    }) }) }) }) }),
    select: () => {
      const index = selects++;
      if (index === 0) return { from: () => ({ where: () => ({ for: async () => [{ id: raceId, eventId: raceId }] }) }) };
      if (index === 1) return { from: () => ({ where: async () => [{ name: "Synthetic", timeZone: "UTC" }] }) };
      if (index === 2) return { from: () => ({ orderBy: () => ({ limit: async (limit: number) => {
        expect(limit).toBe(25);
        return Array.from({ length: duplicate ? 2 : 1 }, () => ({ entryId }));
      } }) }) };
      return { from: (table: unknown) => {
        tables.push(table);
        return { where: () => ({ limit: async (limit: number) => {
          limits.push(limit);
          return Array.from({ length: counts[index - 3] ?? 0 }, (_, id) => ({ id: String(id) }));
        } }) };
      } };
    }
  };
  const db = { transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as Database;
  return { db, tables, limits };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ status: "authenticated", principal: { raceId } });
  mocks.resolve.mockRejectedValue(reachedResolver);
});

describe("speaker use-case history and selection barriers", () => {
  it.each([0, 1, 2, 3, 4, 5])("permits exactly 1000 decisions in collection %i before central validation", async (collection) => {
    const counts = Array.from({ length: 6 }, (_, index) => index === collection ? 1000 : 0);
    const test = fixture(counts);
    await expect(listSpeakerBoardAsAdmin(test.db, { raceId, sessionToken: null })).rejects.toBe(reachedResolver);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(test.limits).toEqual(Array.from({ length: 6 }, () => 1001));
    expect(test.tables).toEqual([schema.resultDisqualificationDecisions, schema.resultApprovalDecisions,
      schema.didNotFinishDecisions, schema.notCompetingDecisions, schema.withoutTimingDecisions, schema.startCheckinDnsDecisions]);
  });
  it.each([[1001, 0, 0, 0, 0, 0], [200, 200, 200, 200, 200, 1]])("rejects 1001 total without truncating or resolving (%j)", async (...counts) => {
    const test = fixture(counts);
    await expect(listSpeakerBoardAsAdmin(test.db, { raceId, sessionToken: null })).rejects.toThrow("beslutshistorik är för stor");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(test.limits.every((limit) => limit === 1001)).toBe(true);
  });
  it("rejects duplicate selected entries before history loading/minimization", async () => {
    const test = fixture([], true);
    await expect(listSpeakerBoardAsAdmin(test.db, { raceId, sessionToken: null })).rejects.toThrow("dubbla deltagare");
    expect(test.tables).toEqual([]);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("does not load any private projection when auth rejects", async () => {
    mocks.auth.mockResolvedValue({ status: "unauthorized" });
    const select = vi.fn();
    const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ select }) } as unknown as Database;
    await expect(listSpeakerBoardAsAdmin(db, { raceId, sessionToken: null })).resolves.toEqual({ status: "unauthorized" });
    expect(select).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
