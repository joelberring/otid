import { describe, expect, it, vi } from "vitest";
import type { readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES,
  checkinConflictReviewReadRoute,
  checkinConflictReviewRoute
} from "./checkin-conflict-review-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const raceId = id(1), entryId = id(2), requestId = id(3), credentialId = id(4);
const sessionToken = `otid_org_session_v1.${id(5)}.${"s".repeat(43)}`, csrfToken = "c".repeat(43);
const hash = "a".repeat(64), at = "2026-09-05T10:00:00.000Z";

function request(method: string, body?: BodyInit, headers: Record<string, string> = {}, suffix = ""): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/admin/races/${raceId}/finish-forest-watch/conflict-reviews${suffix}`, init);
}

function unsafeHeaders() {
  return { origin: "https://otid.example", "content-type": "application/json",
    cookie: `__Host-otid-finish-forest-watch-admin-session=${sessionToken}; __Host-otid-finish-forest-watch-admin-csrf=${csrfToken}`,
    "x-otid-csrf": csrfToken };
}

const reviewIntent = { formatVersion: 1, requestId, entryId, sourceHash: hash, conflictRequestIds: [id(6)],
  decision: "KEEP_CURRENT_STATE", reason: "Kontrollerad vid mål" };
const reviewResponse = { formatVersion: 1, reviewId: id(7), requestId, raceId, entryId, sourceHash: hash,
  conflictRequestIds: [id(6)], decision: "KEEP_CURRENT_STATE", reviewedAt: at } as const;
const candidate = { formatVersion: 1, sourceHash: hash, generatedAt: at, source: { formatVersion: 1, raceId, entryId,
  displayName: "Test Person", className: "Öppen", organisationName: null, snapshotVersion: 1, entryVersion: 1, revision: 1,
  resultRevision: 0, startState: "STARTED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false,
  conflicts: [{ operation: { formatVersion: 1, requestId: id(6), raceId, entryId, deviceId: id(8), actorCredentialId: credentialId,
    localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, dependsOnRequestId: null, observedAt: at,
    action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } }, contentHash: hash,
    receipt: { formatVersion: 1, storage: "STORED", requestId: id(6), raceId, entryId, deviceId: id(8), localSequence: 1,
      contentHash: hash, receivedAt: at, effect: { kind: "CONFLICT", revision: 1, reason: "STALE_REVISION" } }, deviceLabel: "Mål" }] } } as const;

describe("TASK 006W privata konfliktgranskningsrutter", () => {
  it("kontrollerar origin och CSRF innan POST-body läses", async () => {
    let reads = 0;
    const unread = { url: "https://otid.example/private", headers: new Headers(), body: { getReader() { reads += 1; throw new Error("read"); } } } as unknown as Request;
    const service = vi.fn() as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    expect((await checkinConflictReviewRoute(db, unread, raceId, service, environment)).status).toBe(403);
    expect(reads).toBe(0);
    const reviewed = vi.fn(async (_db: Database, input: Parameters<typeof reviewStartCheckinConflictsAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId, capability: "FINISH_FOREST_WATCH", sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken });
      expect(await input.readBody()).toEqual(reviewIntent);
      return { status: "reviewed" as const, response: reviewResponse };
    }) as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    expect((await checkinConflictReviewRoute(db, request("POST", JSON.stringify(reviewIntent), unsafeHeaders()), raceId, reviewed, environment)).status).toBe(200);
  });

  it("läser body först när application-tjänsten väljer det och begränsar den till 64 KiB", async () => {
    const unauthenticated = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    const rejected = await checkinConflictReviewRoute(db, request("POST", new Uint8Array(CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES + 1), unsafeHeaders()), raceId, unauthenticated, environment);
    expect(rejected.status).toBe(401);
    const reads = vi.fn(async (_db: Database, input: Parameters<typeof reviewStartCheckinConflictsAsAdmin>[1]) => {
      await input.readBody();
      return { status: "reviewed" as const, response: reviewResponse };
    }) as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    const tooLarge = await checkinConflictReviewRoute(db, request("POST", new Uint8Array(CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES + 1), unsafeHeaders()), raceId, reads, environment);
    expect(tooLarge.status).toBe(413);
  });

  it("validerar GET utan query/body och matchar det privata läsresultatets scope", async () => {
    const service = vi.fn(async (_db: Database, input: Parameters<typeof readStartCheckinConflictReviewAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId, entryId, capability: "FINISH_FOREST_WATCH", sessionToken });
      return { status: "ok" as const, response: candidate };
    }) as unknown as typeof readStartCheckinConflictReviewAsAdmin;
    const ok = await checkinConflictReviewReadRoute(db, request("GET", undefined, { cookie: unsafeHeaders().cookie }), raceId, entryId, service, environment);
    expect(ok.status).toBe(200);
    const query = await checkinConflictReviewReadRoute(db, request("GET", undefined, { cookie: unsafeHeaders().cookie }, "?x=1"), raceId, entryId, service, environment);
    expect(query.status).toBe(400);
    const badScope = vi.fn(async () => ({ status: "ok" as const, response: { ...candidate, source: { ...candidate.source, entryId: id(9) } } })) as unknown as typeof readStartCheckinConflictReviewAsAdmin;
    expect((await checkinConflictReviewReadRoute(db, request("GET"), raceId, entryId, badScope, environment)).status).toBe(500);
  });

  it("översätter application-status och avslöjar inte interna fel", async () => {
    const conflict = vi.fn(async () => ({ status: "conflict" as const })) as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    const response = await checkinConflictReviewRoute(db, request("POST", "{}", unsafeHeaders()), raceId, conflict, environment);
    expect(response.status).toBe(409);
    const internal = vi.fn(async () => { throw new Error("hemlig databasdetalj"); }) as unknown as typeof reviewStartCheckinConflictsAsAdmin;
    const failed = await checkinConflictReviewRoute(db, request("POST", "{}", unsafeHeaders()), raceId, internal, environment);
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("hemlig");
  });
});
