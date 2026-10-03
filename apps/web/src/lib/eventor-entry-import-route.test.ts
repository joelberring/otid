import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { eventorEntryImportCommitRoute, eventorEntryImportPreviewRoute } from "./eventor-entry-import-route";

const db = {} as Database;
const environment = { NODE_ENV: "development" as const, O_TID_PUBLIC_ORIGIN: "http://localhost:3000" };
const raceId = "10000000-0000-4000-8000-000000000001";
const grantId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
function request(origin = environment.O_TID_PUBLIC_ORIGIN, body = "{}") {
  return new Request(`http://localhost:3000/api/admin/races/${raceId}/eventor-entry-import/preview`, { method: "POST", headers: {
    origin, "content-type": "application/json", cookie: "otid_import_admin_session=session; otid_import_admin_csrf=csrf", "x-otid-csrf": "csrf"
  }, body });
}
describe("Eventor entry import preview route", () => {
  it("rejects wrong origin before handing body or credentials to the service", async () => {
    const preview = vi.fn(async () => ({ status: "forbidden" as const }));
    const result = await eventorEntryImportPreviewRoute(db, request("https://attacker.invalid"), raceId, preview, undefined, environment);
    expect(result.status).toBe(403); expect(preview).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("passes only pairing-session proof and bounded deferred JSON", async () => {
    const response = { formatVersion: 2 as const, grantId, environment: "production-se" as const,
      eventClassesSourceHash: "a".repeat(64), entriesSourceHash: "b".repeat(64),
      entriesCount: 0, sourceClasses: [], targetClasses: [] };
    const preview = vi.fn(async () => ({ status: "available" as const, response }));
    const result = await eventorEntryImportPreviewRoute(db, request(undefined, JSON.stringify({ formatVersion: 1, grantId })), raceId, preview, undefined, environment);
    expect(result.status).toBe(200); expect(await result.json()).toEqual(response);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const [, input] = preview.mock.calls[0]! as unknown as [Database, { raceId: string; sessionToken: string; csrfHeader: string; readBody: () => Promise<unknown> }];
    expect(input).toMatchObject({ raceId, sessionToken: "session", csrfHeader: "csrf" });
    expect(await input.readBody()).toEqual({ formatVersion: 1, grantId });
  });
});

describe("Eventor entry import commit route", () => {
  const body = { formatVersion: 1 as const, grantId, eventClassesSourceHash: "a".repeat(64),
    entriesSourceHash: "b".repeat(64), mappings: [{ externalClassId: "D21", classId: raceId }] };
  const key = `eventor-entry-import:${requestId}`;
  function commitRequest(options: { origin?: string; idempotencyKey?: string | null; body?: string } = {}) {
    const headers = new Headers({ origin: options.origin ?? environment.O_TID_PUBLIC_ORIGIN,
      "content-type": "application/json", cookie: "otid_import_admin_session=session; otid_import_admin_csrf=csrf",
      "x-otid-csrf": "csrf" });
    if (options.idempotencyKey !== null) headers.set("idempotency-key", options.idempotencyKey ?? key);
    return new Request(`http://localhost:3000/api/admin/races/${raceId}/eventor-entry-import`, {
      method: "POST", headers, body: options.body ?? JSON.stringify(body)
    });
  }
  const created = { formatVersion: 1 as const, replayed: false, requestId, raceId, grantId,
    eventClassesSourceHash: body.eventClassesSourceHash, entriesSourceHash: body.entriesSourceHash,
    entriesSeen: 1, entriesCreated: 1, entriesUnchanged: 0, snapshotVersionBefore: 1,
    snapshotVersionAfter: 2, createdAt: "2026-09-19T12:00:00.000Z" };

  it("rejects bad origin and idempotency key before commit or body access", async () => {
    const commit = vi.fn(async () => ({ status: "created" as const, response: created }));
    expect((await eventorEntryImportCommitRoute(db, commitRequest({ origin: "https://attacker.invalid" }), raceId,
      commit as unknown as never, undefined, environment)).status).toBe(403);
    expect(commit).not.toHaveBeenCalled();
    let reads = 0;
    const unread = { headers: new Headers({ origin: environment.O_TID_PUBLIC_ORIGIN,
      cookie: "otid_import_admin_session=session; otid_import_admin_csrf=csrf", "x-otid-csrf": "csrf",
      "content-type": "application/json", "idempotency-key": "bad" }), body: { getReader() {
      reads += 1; throw new Error("body lästes");
    } } } as unknown as Request;
    expect((await eventorEntryImportCommitRoute(db, unread, raceId, commit as unknown as never, undefined, environment)).status).toBe(400);
    expect(reads).toBe(0); expect(commit).not.toHaveBeenCalled();
  });

  it("passes only import-session proof, idempotency key and deferred bounded JSON", async () => {
    const commit = vi.fn(async () => ({ status: "created" as const, response: created }));
    const result = await eventorEntryImportCommitRoute(db, commitRequest(), raceId, commit as unknown as never, undefined, environment);
    expect(result.status).toBe(201); expect(await result.json()).toEqual(created);
    const [, input] = commit.mock.calls[0]! as unknown as [Database, {
      raceId: string; sessionToken: string; csrfHeader: string; idempotencyKey: string; readBody: () => Promise<unknown>
    }];
    expect(input).toMatchObject({ raceId, sessionToken: "session", csrfHeader: "csrf", idempotencyKey: key });
    expect(await input.readBody()).toEqual(body);
  });

  it("maps application conflicts and replays to the private contract response", async () => {
    const conflict = vi.fn(async () => ({ status: "conflict" as const }));
    const response = await eventorEntryImportCommitRoute(db, commitRequest(), raceId, conflict as unknown as never, undefined, environment);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ formatVersion: 1, error: "CONFLICT" });
    const replay = vi.fn(async () => ({ status: "created" as const, response: { ...created, replayed: true } }));
    expect((await eventorEntryImportCommitRoute(db, commitRequest(), raceId, replay as unknown as never, undefined, environment)).status).toBe(200);
  });
});
