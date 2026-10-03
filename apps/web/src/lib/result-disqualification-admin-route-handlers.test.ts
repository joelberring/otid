import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  disqualifyResultAsAdmin,
  loginPairingAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedResultDisqualificationRoute,
  resultDisqualificationAdminLoginRoute
} from "./result-disqualification-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const credentialId = "10000000-0000-4000-8000-000000000006";
const sessionId = "10000000-0000-4000-8000-000000000007";
const targetId = "10000000-0000-4000-8000-000000000008";
const decisionId = "10000000-0000-4000-8000-000000000009";
const resultId = "10000000-0000-4000-8000-00000000000a";
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-result-disqualification-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-result-disqualification-admin-csrf=${csrfToken}`;
const body = {
  formatVersion: 1 as const, expectedEntryVersion: 2, expectedClassId: classId,
  expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 4,
  expectedResultRevision: { id: targetId, revision: 3, status: "OK" as const },
  policyVersion: "manual-disqualification-v1" as const
};

function request(bodyText?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method: "POST", headers };
  if (bodyText !== undefined) init.body = bodyText;
  return new Request(`https://otid.example/api/admin/races/${raceId}/entries/${entryId}/result-disqualification`, init);
}

function protectedHeaders(extra: Record<string, string> = {}) {
  return { origin: "https://otid.example", cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken, ...extra };
}

function authenticated() {
  return { status: "authenticated" as const, principal: {
    accessCredentialId: credentialId, raceId, capability: "DISQUALIFY_RESULT" as const,
    sessionId, expiresAt: "2026-08-31T13:00:00.000Z"
  } };
}

describe("TASK 006G diskvalifikationsroutes", () => {
  it("binder login endast till DISQUALIFY_RESULT och egna host-only cookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "DISQUALIFY_RESULT" as const,
        expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken, csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await resultDisqualificationAdminLoginRoute(db, request(JSON.stringify({
      formatVersion: 1,
      accessCredential: `otid_org_result_disqualification_v1.${credentialId}.${"a".repeat(43)}`
    }), { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId, expectedCapability: "DISQUALIFY_RESULT"
    });
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n"))
      .toContain("__Host-otid-result-disqualification-admin-session");
  });

  it("avvisar fel origin och fel idempotensnyckel innan body-pull", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers({ origin: "https://evil.example" }),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn() as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedResultDisqualificationRoute(
      db, unread, raceId, entryId, authenticate,
      vi.fn() as unknown as typeof disqualifyResultAsAdmin, environment
    )).status).toBe(403);
    expect(reads).toBe(0);
    expect(authenticate).not.toHaveBeenCalled();

    const badKey = {
      headers: new Headers(protectedHeaders({ "content-type": "application/json", "idempotency-key": "bad" })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticatedMock = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    expect((await authenticatedResultDisqualificationRoute(
      db, badKey, raceId, entryId, authenticatedMock,
      vi.fn() as unknown as typeof disqualifyResultAsAdmin, environment
    )).status).toBe(400);
    expect(reads).toBe(0);
  });

  it("vidarebefordrar exakt fryst intent och validerar mutationens svar", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const disqualify = vi.fn(async (_db: Database, input: Parameters<typeof disqualifyResultAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId, entryId,
        idempotencyKey: `manual-disqualification:${requestId}`, request: body });
      return { status: "disqualified" as const, response: {
        formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
        resultDisqualificationDecisionId: decisionId,
        targetResultRevisionId: targetId, targetResultRevision: 3,
        resultRevisionId: resultId, revision: 4,
        cause: "MANUAL_DISQUALIFICATION" as const, status: "DSQ" as const,
        reason: "MANUAL_DISQUALIFICATION" as const,
        policyVersion: "manual-disqualification-v1" as const,
        snapshotVersion: 4, courseVersionId, decidedAt: "2026-08-31T11:00:00.000Z"
      } };
    }) as unknown as typeof disqualifyResultAsAdmin;
    const response = await authenticatedResultDisqualificationRoute(
      db,
      request(JSON.stringify(body), protectedHeaders({
        "content-type": "application/json", "idempotency-key": `manual-disqualification:${requestId}`
      })),
      raceId, entryId, authenticate, disqualify, environment
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId, resultDisqualificationDecisionId: decisionId });
  });
});
