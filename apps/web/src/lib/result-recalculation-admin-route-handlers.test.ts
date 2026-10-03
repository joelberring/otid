import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  listResultRecalculationCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  recalculateEntryAsAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedResultRecalculationRoute,
  resultRecalculationAdminLoginRoute,
  resultRecalculationAdminLogoutRoute,
  resultRecalculationAdminSessionStatusRoute,
  resultRecalculationCandidateRoute
} from "./result-recalculation-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const assignmentId = "10000000-0000-4000-8000-000000000004";
const readoutId = "10000000-0000-4000-8000-000000000005";
const previousRevisionId = "10000000-0000-4000-8000-000000000006";
const requestId = "10000000-0000-4000-8000-000000000007";
const resultRevisionId = "10000000-0000-4000-8000-000000000008";
const courseVersionId = "10000000-0000-4000-8000-000000000009";
const credentialId = "10000000-0000-4000-8000-000000000010";
const sessionId = "10000000-0000-4000-8000-000000000011";
const accessCredential = `otid_org_result_recalc_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-recalculation-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-recalculation-admin-csrf=${csrfToken}`;

const mutationBody = {
  formatVersion: 1 as const,
  expectedEntryVersion: 2,
  expectedClassId: classId,
  expectedSnapshotVersion: 4,
  expectedCardAssignmentId: assignmentId,
  expectedReadoutId: readoutId,
  expectedLatestResultRevision: { id: previousRevisionId, revision: 3 },
  expectedEngineVersion: "task-005i-v1"
};

function request(method: "GET" | "POST" | "DELETE", body?: BodyInit, extra: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers: extra };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/races/${raceId}/entries/${entryId}/recalculate`, init);
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
      capability: "RECALCULATE_RESULT" as const,
      sessionId,
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

describe("TASK 005I omräkningsroutes", () => {
  it("race-scopar login och sätter endast egna produktionscookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: {
        formatVersion: 1 as const,
        raceId,
        capability: "RECALCULATE_RESULT" as const,
        expiresAt: "2026-08-31T13:00:00.000Z"
      },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await resultRecalculationAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId,
      expectedCapability: "RECALCULATE_RESULT"
    });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.join("\n")).toContain("__Host-otid-recalculation-admin-session");
    expect(cookies.join("\n")).toContain("__Host-otid-recalculation-admin-csrf");
    expect(cookies.join("\n")).not.toMatch(/entry-class|pairing-admin|import-admin/);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(cookies.every((cookie) => cookie.includes("Secure") && cookie.includes("SameSite=Strict") && cookie.includes("Path=/"))).toBe(true);
  });

  it("skriver inga cookies vid avvisad credential", async () => {
    const login = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof loginPairingAdmin;
    const response = await resultRecalculationAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("använder separata osäkra cookienamn endast på explicit loopback i utveckling", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: {
        formatVersion: 1 as const,
        raceId,
        capability: "RECALCULATE_RESULT" as const,
        expiresAt: "2026-08-31T13:00:00.000Z"
      },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await resultRecalculationAdminLoginRoute(db, new Request(
      `http://127.0.0.1:3000/api/admin/races/${raceId}/recalculation-session`,
      {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, accessCredential })
      }
    ), raceId, login, { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" });
    expect(response.status).toBe(200);
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n");
    expect(cookies).toContain("otid_recalculation_admin_session");
    expect(cookies).toContain("otid_recalculation_admin_csrf");
    expect(cookies).not.toMatch(/__Host-|Secure/);
  });

  it("provar sessionsstatus race- och capabilitybundet", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await resultRecalculationAdminSessionStatusRoute(
      db,
      request("GET", undefined, { cookie: sessionCookie }),
      raceId,
      authenticate,
      environment
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      formatVersion: 1,
      raceId,
      capability: "RECALCULATE_RESULT",
      expiresAt: "2026-08-31T13:00:00.000Z"
    });
  });

  it("returnerar endast runtimevaliderat privat kandidatunderlag", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const,
      raceId,
      snapshotVersion: 4,
      engineVersion: "task-005i-v1",
      entries: [{
        id: entryId,
        displayName: "Ada Löpare",
        organisationName: null,
        classId,
        className: "D21",
        entryVersion: 2,
        readiness: "READY" as const,
        cardAssignmentId: assignmentId,
        latestReadout: { id: readoutId, readAt: "2026-08-31T10:00:00.000Z" },
        latestResultRevision: null
      }]
    } })) as unknown as typeof listResultRecalculationCandidatesAsAdmin;
    const response = await resultRecalculationCandidateRoute(
      db,
      request("GET", undefined, { cookie: sessionCookie }),
      raceId,
      list,
      environment
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, sessionToken }));
    const text = await response.text();
    expect(text).not.toMatch(/cardNumber|punches|evaluation|raw/);
  });

  it("maskerar ett kandidatobjekt som försöker lämna förbjudna extrafält", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1,
      raceId,
      snapshotVersion: 4,
      engineVersion: "task-005i-v1",
      entries: [{
        id: entryId,
        displayName: "Ada Löpare",
        organisationName: null,
        classId,
        className: "D21",
        entryVersion: 2,
        readiness: "READY",
        cardAssignmentId: assignmentId,
        latestReadout: { id: readoutId, readAt: "2026-08-31T10:00:00.000Z" },
        latestResultRevision: null,
        cardNumber: "12345"
      }]
    } })) as unknown as typeof listResultRecalculationCandidatesAsAdmin;
    const response = await resultRecalculationCandidateRoute(
      db,
      request("GET", undefined, { cookie: sessionCookie }),
      raceId,
      list,
      environment
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("12345");
  });

  it("avvisar fel Origin före auth och bodyläsning", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers({ ...unsafeHeaders(), origin: "https://evil.example" }),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn() as unknown as typeof authenticatePairingAdminSession;
    const recalculate = vi.fn() as unknown as typeof recalculateEntryAsAdmin;
    const response = await authenticatedResultRecalculationRoute(
      db, unread, raceId, entryId, authenticate, recalculate, environment
    );
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(authenticate).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("läser ingen body när auth avvisas", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(unsafeHeaders({
        "content-type": "application/json",
        "idempotency-key": `result-recalculation:${requestId}`
      })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof authenticatePairingAdminSession;
    const recalculate = vi.fn() as unknown as typeof recalculateEntryAsAdmin;
    const response = await authenticatedResultRecalculationRoute(
      db, unread, raceId, entryId, authenticate, recalculate, environment
    );
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("validerar idempotency-key före bodyläsning", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(unsafeHeaders({ "content-type": "application/json", "idempotency-key": "fel" })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await authenticatedResultRecalculationRoute(
      db, unread, raceId, entryId, authenticate, vi.fn() as unknown as typeof recalculateEntryAsAdmin, environment
    );
    expect(response.status).toBe(400);
    expect(reads).toBe(0);
  });

  it("vidarebefordrar exakt strikt intent och säkerhetsbevis till application", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const recalculateImplementation = async (
      _db: Parameters<typeof recalculateEntryAsAdmin>[0],
      input: Parameters<typeof recalculateEntryAsAdmin>[1]
    ): ReturnType<typeof recalculateEntryAsAdmin> => {
      expect(input).toMatchObject({
        raceId,
        entryId,
        idempotencyKey: `result-recalculation:${requestId}`,
        request: mutationBody,
        sessionToken,
        csrfCookie: csrfToken,
        csrfHeader: csrfToken
      });
      return { status: "recalculated", response: {
        formatVersion: 1,
        replayed: false,
        requestId,
        raceId,
        entryId,
        readoutId,
        resultRevisionId,
        revision: 4,
        cause: "EXPLICIT_RECALCULATION",
        status: "OK",
        reason: "COMPLETE",
        engineVersion: "task-005i-v1",
        snapshotVersion: 4,
        courseVersionId,
        recalculatedAt: "2026-08-31T10:05:00.000Z"
      } };
    };
    const recalculate = vi.fn(recalculateImplementation) as unknown as typeof recalculateEntryAsAdmin;
    const response = await authenticatedResultRecalculationRoute(db, request("POST", JSON.stringify(mutationBody), unsafeHeaders({
      "content-type": "application/json",
      "idempotency-key": `result-recalculation:${requestId}`
    })), raceId, entryId, authenticate, recalculate, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: false, requestId, revision: 4, cause: "EXPLICIT_RECALCULATION" });
  });

  it.each([
    ["text/plain", JSON.stringify(mutationBody)],
    ["application/json", JSON.stringify({ ...mutationBody, extra: true })],
    ["application/json", new Uint8Array([0xff])],
    ["application/json", new Uint8Array(4097)]
  ] as const)("avvisar medietyp, extra fält, UTF-8 och faktisk bodygräns", async (contentType, body) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const recalculate = vi.fn() as unknown as typeof recalculateEntryAsAdmin;
    const response = await authenticatedResultRecalculationRoute(db, request("POST", body, unsafeHeaders({
      "content-type": contentType,
      "idempotency-key": `result-recalculation:${requestId}`
    })), raceId, entryId, authenticate, recalculate, environment);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "INVALID_REQUEST" });
    expect(recalculate).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", 401, "UNAUTHORIZED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["invalid-request", 400, "INVALID_REQUEST"],
    ["not-found", 404, "NOT_FOUND"],
    ["conflict", 409, "CONFLICT"]
  ] as const)("mappar application-%s privat och stabilt", async (status, expectedStatus, code) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const recalculate = vi.fn(async () => ({ status })) as unknown as typeof recalculateEntryAsAdmin;
    const response = await authenticatedResultRecalculationRoute(db, request("POST", JSON.stringify(mutationBody), unsafeHeaders({
      "content-type": "application/json",
      "idempotency-key": `result-recalculation:${requestId}`
    })), raceId, entryId, authenticate, recalculate, environment);
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ formatVersion: 1, error: code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("race-scopar logout och rensar endast omräkningscookies", async () => {
    const logoutImplementation = async (
      _db: Parameters<typeof logoutPairingAdminSession>[0],
      input: Parameters<typeof logoutPairingAdminSession>[1]
    ): ReturnType<typeof logoutPairingAdminSession> => {
      if (input.readBodyIsEmpty && !await input.readBodyIsEmpty()) return { status: "invalid-request" };
      return { status: "logged-out" };
    };
    const logout = vi.fn(logoutImplementation) as unknown as typeof logoutPairingAdminSession;
    const response = await resultRecalculationAdminLogoutRoute(
      db, request("DELETE", undefined, unsafeHeaders()), raceId, logout, environment
    );
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "RECALCULATE_RESULT" }));
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n");
    expect(cookies).toContain("otid-recalculation-admin");
    expect(cookies).toContain("Max-Age=0");
    expect(cookies).not.toMatch(/entry-class|pairing-admin|import-admin/);
  });
});
