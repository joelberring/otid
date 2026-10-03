import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  listDidNotStartWithdrawalsAsAdmin,
  loginPairingAdmin,
  withdrawDidNotStartAsAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedDidNotStartWithdrawalRoute,
  didNotStartWithdrawalAdminLoginRoute,
  didNotStartWithdrawalListRoute
} from "./did-not-start-withdrawal-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const credentialId = "10000000-0000-4000-8000-000000000006";
const sessionId = "10000000-0000-4000-8000-000000000007";
const decisionId = "10000000-0000-4000-8000-000000000008";
const resultId = "10000000-0000-4000-8000-000000000009";
const withdrawalId = "10000000-0000-4000-8000-00000000000a";
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-dns-withdrawal-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-dns-withdrawal-admin-csrf=${csrfToken}`;
const body = {
  formatVersion: 1 as const,
  expectedEntryVersion: 2,
  expectedClassId: classId,
  expectedCourseVersionId: courseVersionId,
  expectedSnapshotVersion: 4,
  expectedDidNotStartDecisionId: decisionId,
  expectedResultRevision: { id: resultId, revision: 1 },
  policyVersion: "did-not-start-withdrawal-v1" as const
};

function request(method: "GET" | "POST", bodyText?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers };
  if (bodyText !== undefined) init.body = bodyText;
  return new Request(
    `https://otid.example/api/admin/races/${raceId}/entries/${entryId}/did-not-start-withdrawal`,
    init
  );
}

function protectedHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://otid.example",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken,
    ...extra
  };
}

function authenticated() {
  return { status: "authenticated" as const, principal: {
    accessCredentialId: credentialId,
    raceId,
    capability: "WITHDRAW_DID_NOT_START" as const,
    sessionId,
    expiresAt: "2026-08-31T13:00:00.000Z"
  } };
}

function listResponse() {
  return {
    formatVersion: 1 as const,
    raceId,
    snapshotVersion: 4,
    withdrawalPolicyVersion: "did-not-start-withdrawal-v1" as const,
    entries: [{
      id: entryId,
      displayName: "Ada Löpare",
      organisationName: null,
      classId,
      className: "D21",
      courseVersionId,
      entryVersion: 2,
      didNotStartDecisionId: decisionId,
      decidedAt: "2026-08-31T10:00:00.000Z",
      state: "WITHDRAWABLE" as const,
      targetResultRevision: {
        id: resultId,
        revision: 1,
        createdAt: "2026-08-31T10:00:00.000Z",
        snapshotVersion: 4
      },
      latestResultRevision: {
        id: resultId,
        revision: 1,
        cause: "MANUAL_DID_NOT_START" as const,
        status: "DNS" as const,
        reason: "DID_NOT_START" as const,
        createdAt: "2026-08-31T10:00:00.000Z",
        snapshotVersion: 4
      },
      withdrawal: null
    }]
  };
}

describe("TASK 006F DNS-återtagningsroutes", () => {
  it("binder login till endast återtagningscapability och egna host-only cookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: {
        formatVersion: 1 as const,
        raceId,
        capability: "WITHDRAW_DID_NOT_START" as const,
        expiresAt: "2026-08-31T13:00:00.000Z"
      },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await didNotStartWithdrawalAdminLoginRoute(
      db,
      request("POST", JSON.stringify({
        formatVersion: 1,
        accessCredential: `otid_org_did_not_start_withdrawal_v1.${credentialId}.${"a".repeat(43)}`
      }), { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json" }),
      raceId,
      login,
      environment
    );
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId,
      expectedCapability: "WITHDRAW_DID_NOT_START"
    });
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n"))
      .toContain("__Host-otid-dns-withdrawal-admin-session");
  });

  it("avvisar fel origin före body/auth och minimerar den privata listan", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers({ origin: "https://evil.example" }),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn() as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedDidNotStartWithdrawalRoute(
      db,
      unread,
      raceId,
      entryId,
      authenticate,
      vi.fn() as unknown as typeof withdrawDidNotStartAsAdmin,
      environment
    )).status).toBe(403);
    expect(reads).toBe(0);
    expect(authenticate).not.toHaveBeenCalled();

    const list = vi.fn(async () => ({ status: "ok" as const, response: listResponse() })) as unknown as
      typeof listDidNotStartWithdrawalsAsAdmin;
    const listResult = await didNotStartWithdrawalListRoute(
      db,
      request("GET", undefined, { cookie: sessionCookie }),
      raceId,
      list,
      environment
    );
    expect(listResult.status).toBe(200);
    expect(await listResult.text()).not.toMatch(/cardNumber|punch|evaluation|credential|token/);
  });

  it("validerar idempotensnyckeln före body och vidarebefordrar exakt fryst intent", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(protectedHeaders({
        "content-type": "application/json",
        "idempotency-key": "bad"
      })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedDidNotStartWithdrawalRoute(
      db,
      unread,
      raceId,
      entryId,
      authenticate,
      vi.fn() as unknown as typeof withdrawDidNotStartAsAdmin,
      environment
    )).status).toBe(400);
    expect(reads).toBe(0);

    const withdraw = vi.fn(async (
      _db: Database,
      input: Parameters<typeof withdrawDidNotStartAsAdmin>[1]
    ) => {
      expect(input).toMatchObject({
        raceId,
        entryId,
        idempotencyKey: `did-not-start-withdrawal:${requestId}`,
        request: body
      });
      return { status: "withdrawn" as const, response: {
        formatVersion: 1 as const,
        replayed: false,
        requestId,
        raceId,
        entryId,
        withdrawalId,
        didNotStartDecisionId: decisionId,
        withdrawnResultRevisionId: resultId,
        withdrawnResultRevision: 1,
        withdrawalPolicyVersion: "did-not-start-withdrawal-v1" as const,
        reason: "ERRONEOUS_MANUAL_DNS" as const,
        withdrawnAt: "2026-08-31T11:00:00.000Z"
      } };
    }) as unknown as typeof withdrawDidNotStartAsAdmin;
    const response = await authenticatedDidNotStartWithdrawalRoute(
      db,
      request("POST", JSON.stringify(body), protectedHeaders({
        "content-type": "application/json",
        "idempotency-key": `did-not-start-withdrawal:${requestId}`
      })),
      raceId,
      entryId,
      authenticate,
      withdraw,
      environment
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId, withdrawalId, reason: "ERRONEOUS_MANUAL_DNS" });
  });
});
