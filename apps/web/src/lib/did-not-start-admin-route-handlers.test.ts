import { describe, expect, it, vi } from "vitest";
import type { authenticatePairingAdminSession, decideDidNotStartAsAdmin, listDidNotStartCandidatesAsAdmin, loginPairingAdmin } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedDidNotStartRoute,
  didNotStartAdminLoginRoute,
  didNotStartCandidateRoute
} from "./did-not-start-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const credentialId = "10000000-0000-4000-8000-000000000006";
const sessionId = "10000000-0000-4000-8000-000000000007";
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-did-not-start-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-did-not-start-admin-csrf=${csrfToken}`;
const body = {
  formatVersion: 1 as const, expectedEntryVersion: 1, expectedClassId: classId,
  expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 4,
  expectedLatestResultRevision: null, policyVersion: "did-not-start-v1" as const
};

function request(method: "GET" | "POST", bodyText?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers };
  if (bodyText !== undefined) init.body = bodyText;
  return new Request(`https://otid.example/api/admin/races/${raceId}/entries/${entryId}/did-not-start`, init);
}

function protectedHeaders(extra: Record<string, string> = {}) {
  return { origin: "https://otid.example", cookie: `${sessionCookie}; ${csrfCookie}`, "x-otid-csrf": csrfToken, ...extra };
}

function authenticated() {
  return { status: "authenticated" as const, principal: {
    accessCredentialId: credentialId, raceId, capability: "DECIDE_DID_NOT_START" as const,
    sessionId, expiresAt: "2026-08-31T13:00:00.000Z"
  } };
}

describe("TASK 006E ej-startroutes", () => {
  it("binder login till endast DNS-capability och egna cookies", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "DECIDE_DID_NOT_START" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken, csrfToken })) as unknown as typeof loginPairingAdmin;
    const response = await didNotStartAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1, accessCredential: `otid_org_did_not_start_v1.${credentialId}.${"a".repeat(43)}`
    }), { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: raceId, expectedCapability: "DECIDE_DID_NOT_START" });
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n")).toContain("__Host-otid-did-not-start-admin-session");
  });

  it("avvisar origin före body/auth och skickar inte privat kandidatdata", async () => {
    let reads = 0;
    const unread = { headers: new Headers({ origin: "https://evil.example" }), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    const authenticate = vi.fn() as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedDidNotStartRoute(db, unread, raceId, entryId, authenticate, vi.fn() as unknown as typeof decideDidNotStartAsAdmin, environment)).status).toBe(403);
    expect(reads).toBe(0); expect(authenticate).not.toHaveBeenCalled();

    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const, raceId, snapshotVersion: 4, decisionPolicyVersion: "did-not-start-v1" as const,
      entries: [{ id: entryId, displayName: "Ada Löpare", organisationName: null, classId, className: "D21", courseVersionId, entryVersion: 1, readiness: "READY" as const, latestResultRevision: null }]
    } })) as unknown as typeof listDidNotStartCandidatesAsAdmin;
    const candidateResponse = await didNotStartCandidateRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, list, environment);
    expect(candidateResponse.status).toBe(200);
    expect(await candidateResponse.text()).not.toMatch(/cardNumber|evaluation|punch/);
  });

  it("validerar idempotency före body och vidarebefordrar fryst intent", async () => {
    let reads = 0;
    const unread = { headers: new Headers(protectedHeaders({ "content-type": "application/json", "idempotency-key": "bad" })), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedDidNotStartRoute(db, unread, raceId, entryId, authenticate, vi.fn() as unknown as typeof decideDidNotStartAsAdmin, environment)).status).toBe(400);
    expect(reads).toBe(0);
    const decide = vi.fn(async (_db: Database, input: Parameters<typeof decideDidNotStartAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId, entryId, idempotencyKey: `did-not-start:${requestId}`, request: body });
      return { status: "decided" as const, response: {
        formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
        didNotStartDecisionId: "10000000-0000-4000-8000-000000000008", resultRevisionId: "10000000-0000-4000-8000-000000000009", revision: 1,
        cause: "MANUAL_DID_NOT_START" as const, status: "DNS" as const, reason: "DID_NOT_START" as const,
        decisionPolicyVersion: "did-not-start-v1" as const, snapshotVersion: 4, courseVersionId, decidedAt: "2026-08-31T10:00:00Z"
      } };
    }) as unknown as typeof decideDidNotStartAsAdmin;
    const response = await authenticatedDidNotStartRoute(db, request("POST", JSON.stringify(body), protectedHeaders({ "content-type": "application/json", "idempotency-key": `did-not-start:${requestId}` })), raceId, entryId, authenticate, decide, environment);
    expect(response.status).toBe(200); expect((await response.json())).toMatchObject({ requestId, status: "DNS" });
  });
});
