import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  finalizeResultsAsAdmin,
  listResultFinalizationCandidatesAsAdmin,
  loginPairingAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedResultFinalizationRoute,
  resultFinalizationAdminLoginRoute,
  resultFinalizationCandidateRoute
} from "./result-finalization-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const credentialId = "10000000-0000-4000-8000-000000000004";
const sessionId = "10000000-0000-4000-8000-000000000005";
const finalizationId = "10000000-0000-4000-8000-000000000006";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const accessCredential = `otid_org_result_finalize_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-finalization-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-finalization-admin-csrf=${csrfToken}`;

const mutationBody = {
  formatVersion: 1 as const,
  scope: "CLASS" as const,
  classId,
  expectedSnapshotVersion: 4,
  expectedBasisHash: hashA,
  expectedLatestScopeRevision: null
};

function request(method: "GET" | "POST", body?: BodyInit, extra: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers: extra };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/admin/races/${raceId}/result-finalizations`, init);
}

function unsafeHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://otid.example",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken,
    ...extra
  };
}

function authenticated() {
  return {
    status: "authenticated" as const,
    principal: {
      accessCredentialId: credentialId,
      raceId,
      capability: "FINALIZE_RESULTS" as const,
      sessionId,
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

describe("TASK 006D finaliseringsroutes", () => {
  it("race-scopar login till separat capability och separata cookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: {
        formatVersion: 1 as const,
        raceId,
        capability: "FINALIZE_RESULTS" as const,
        expiresAt: "2026-08-31T13:00:00.000Z"
      },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await resultFinalizationAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId,
      expectedCapability: "FINALIZE_RESULTS"
    });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-finalization-admin-session");
    expect(cookies).toContain("__Host-otid-finalization-admin-csrf");
    expect(cookies).not.toMatch(/recalculation|result-list-export/);
  });

  it("returnerar endast strikt kandidatmetadata utan PII eller fryst payload", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const,
      raceId,
      snapshotVersion: 4,
      race: {
        entryCount: 1,
        nonEmptyClassCount: 1,
        unresolvedUnknownCardReadoutCount: 0,
        blockerCodes: ["MISSING_CLASS_FINALIZATION" as const],
        basisHash: hashB,
        latestFinalization: null
      },
      classes: [{ classId, className: "D21", entryCount: 1, blockerCodes: [], basisHash: hashA, latestFinalization: null }]
    } })) as unknown as typeof listResultFinalizationCandidatesAsAdmin;
    const response = await resultFinalizationCandidateRoute(
      db, request("GET", undefined, { cookie: sessionCookie }), raceId, list, environment
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).toContain("MISSING_CLASS_FINALIZATION");
    expect(text).not.toMatch(/givenName|familyName|cardNumber|frozenProjection|evaluation/);
  });

  it("avvisar origin och auth före idempotensnyckel eller bodyläsning", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers({ ...unsafeHeaders(), origin: "https://evil.example" }),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn() as unknown as typeof authenticatePairingAdminSession;
    const finalize = vi.fn() as unknown as typeof finalizeResultsAsAdmin;
    const response = await authenticatedResultFinalizationRoute(
      db, unread, raceId, authenticate, finalize, environment
    );
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(authenticate).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("vidarebefordrar exakt fryst intent och säkerhetsbevis", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const finalizeImplementation = async (
      _db: Parameters<typeof finalizeResultsAsAdmin>[0],
      input: Parameters<typeof finalizeResultsAsAdmin>[1]
    ): ReturnType<typeof finalizeResultsAsAdmin> => {
      expect(input).toEqual({
        raceId,
        sessionToken,
        csrfCookie: csrfToken,
        csrfHeader: csrfToken,
        idempotencyKey: `result-finalization:${requestId}`,
        request: mutationBody
      });
      return { status: "finalized", response: {
        formatVersion: 1,
        replayed: false,
        requestId,
        finalization: {
          id: finalizationId,
          raceId,
          scope: "CLASS",
          classId,
          scopeRevision: 1,
          sourceSnapshotVersion: 4,
          basisHash: hashA,
          frozenProjectionHash: hashC,
          entryCount: 1,
          classCount: 1,
          completeXmlSha256: null,
          finalizedAt: "2026-08-31T10:00:00.000Z"
        }
      } };
    };
    const finalize = vi.fn(finalizeImplementation) as unknown as typeof finalizeResultsAsAdmin;
    const response = await authenticatedResultFinalizationRoute(db, request(
      "POST", JSON.stringify(mutationBody), unsafeHeaders({
        "content-type": "application/json",
        "idempotency-key": `result-finalization:${requestId}`
      })
    ), raceId, authenticate, finalize, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId, replayed: false });
  });

  it("validerar nyckel före body samt mappar för stora kandidater till 413", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(unsafeHeaders({ "content-type": "application/json", "idempotency-key": "fel" })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await authenticatedResultFinalizationRoute(
      db, unread, raceId, authenticate, vi.fn() as unknown as typeof finalizeResultsAsAdmin, environment
    );
    expect(response.status).toBe(400);
    expect(reads).toBe(0);

    const list = vi.fn(async () => ({ status: "too-large" as const })) as unknown as typeof listResultFinalizationCandidatesAsAdmin;
    const tooLarge = await resultFinalizationCandidateRoute(
      db, request("GET", undefined, { cookie: sessionCookie }), raceId, list, environment
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ formatVersion: 1, error: "TOO_LARGE" });
  });
});
