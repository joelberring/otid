import { expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { listEntryReadoutHistoryAsAdmin } from "@o-tid/application";
import { entryReadoutHistoryListRoute } from "./readout-result-history-admin-route-handlers";
const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const response = { formatVersion: 1 as const, raceId, entry: { id: entryId, displayName: "Åsa Exempel" },
  page: { formatVersion: 10 as const, raceId, items: [], nextCursor: null } };
it("passes bounded scope to protected read and validates returned route identity", async () => {
  const list: typeof listEntryReadoutHistoryAsAdmin = vi.fn(async () => ({ status: "ok" as const, response }));
  const result = await entryReadoutHistoryListRoute(db, new Request("https://otid.example/history?limit=2&cursor=abc"), raceId, entryId, list, environment);
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(list).toHaveBeenCalledWith(db, { sessionToken: null, raceId, entryId, limit: 2, cursor: "abc" });
  expect((await entryReadoutHistoryListRoute(db, new Request("https://otid.example/history"), raceId, raceId, list, environment)).status).toBe(500);
});
it("rejects duplicate/foreign query fields before service and preserves auth failures", async () => {
  const list: typeof listEntryReadoutHistoryAsAdmin = vi.fn(async () => ({ status: "unauthorized" as const }));
  for (const query of ["limit=2&limit=3", "cursor=abc&cursor=def", "entryId=x", "limit=51"]) {
    expect((await entryReadoutHistoryListRoute(db, new Request(`https://otid.example/history?${query}`), raceId, entryId, list, environment)).status).toBe(400);
  }
  expect(list).not.toHaveBeenCalled();
  expect((await entryReadoutHistoryListRoute(db, new Request("https://otid.example/history"), raceId, entryId, list, environment)).status).toBe(401);
});
