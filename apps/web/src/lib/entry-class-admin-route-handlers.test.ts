import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  changeEntryClassAsAdmin,
  listEntryClassesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedEntryClassChangeRoute,
  entryClassAdminListRoute,
  entryClassAdminLoginRoute,
  entryClassAdminLogoutRoute,
  entryClassAdminSessionStatusRoute
} from "./entry-class-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const previousClassId = "10000000-0000-4000-8000-000000000003";
const classId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const accessCredential = `otid_org_entry_class_v1.10000000-0000-4000-8000-000000000006.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.10000000-0000-4000-8000-000000000007.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-entry-class-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-entry-class-admin-csrf=${csrfToken}`;

function request(method: "GET" | "POST" | "PATCH" | "DELETE", body?: BodyInit, extra: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers: extra };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/races/${raceId}/entries/${entryId}/class`, init);
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
      accessCredentialId: "10000000-0000-4000-8000-000000000008",
      raceId,
      capability: "CHANGE_ENTRY_CLASS" as const,
      sessionId: "10000000-0000-4000-8000-000000000007",
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

describe("TASK 005H klassadmin-routes", () => {
  it("race-scopar login före session och sätter endast klassadmincookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "CHANGE_ENTRY_CLASS" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await entryClassAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential }), {
      origin: "https://otid.example", "content-type": "application/json"
    }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: raceId, expectedCapability: "CHANGE_ENTRY_CLASS" });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.join("\n")).toContain("__Host-otid-entry-class-admin-session");
    expect(cookies.join("\n")).toContain("__Host-otid-entry-class-admin-csrf");
    expect(cookies.join("\n")).not.toMatch(/pairing-admin|import-admin/);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(cookies.every((cookie) => cookie.includes("Secure") && cookie.includes("SameSite=Strict") && cookie.includes("Path=/"))).toBe(true);
  });

  it("skriver inga cookies när credentialen inte gäller route-racet", async () => {
    const login = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof loginPairingAdmin;
    const response = await entryClassAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential }), {
      origin: "https://otid.example", "content-type": "application/json"
    }), raceId, login, environment);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("provar sessionstatus race- och capabilitybundet", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await entryClassAdminSessionStatusRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, authenticate, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, raceId, capability: "CHANGE_ENTRY_CLASS", expiresAt: "2026-08-31T13:00:00.000Z" });
  });

  it("returnerar endast runtimevaliderat privat minimalt deltagarunderlag", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const,
      raceId,
      snapshotVersion: 3,
      classes: [{ id: classId, name: "D21" }],
      entries: [{ id: entryId, displayName: "Ada Löpare", organisationName: null, classId, version: 2 }]
    } })) as unknown as typeof listEntryClassesAsAdmin;
    const response = await entryClassAdminListRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, list, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, sessionToken }));
  });

  it("läser ingen body när auth avvisas", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(unsafeHeaders({ "content-type": "application/json", "idempotency-key": `entry-class-change:${requestId}` })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof authenticatePairingAdminSession;
    const change = vi.fn() as unknown as typeof changeEntryClassAsAdmin;
    const response = await authenticatedEntryClassChangeRoute(db, unread, raceId, entryId, authenticate, change, environment);
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(change).not.toHaveBeenCalled();
  });

  it("validerar idempotency-key före bodyläsning", async () => {
    let reads = 0;
    const unread = {
      headers: new Headers(unsafeHeaders({ "content-type": "application/json", "idempotency-key": "fel" })),
      body: { getReader() { reads += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await authenticatedEntryClassChangeRoute(db, unread, raceId, entryId, authenticate, vi.fn() as unknown as typeof changeEntryClassAsAdmin, environment);
    expect(response.status).toBe(400);
    expect(reads).toBe(0);
  });

  it("vidarebefordrar exakt strikt request och säkerhetsbevis till application", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const changedAt = "2026-08-31T12:00:00.000Z";
    const changeImplementation = async (
      _db: Parameters<typeof changeEntryClassAsAdmin>[0],
      input: Parameters<typeof changeEntryClassAsAdmin>[1]
    ): ReturnType<typeof changeEntryClassAsAdmin> => {
      expect(input).toMatchObject({ raceId, entryId, idempotencyKey: `entry-class-change:${requestId}`,
        request: { formatVersion: 1, classId, expectedEntryVersion: 3 }, sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken });
      return { status: "changed", response: {
        formatVersion: 1, replayed: false, requestId, raceId, entryId, previousClassId, classId,
        entryVersionBefore: 3, entryVersionAfter: 4, snapshotVersionBefore: 7, snapshotVersionAfter: 8, changedAt
      } };
    };
    const change = vi.fn(changeImplementation) as unknown as typeof changeEntryClassAsAdmin;
    const response = await authenticatedEntryClassChangeRoute(db, request("PATCH", JSON.stringify({
      formatVersion: 1, classId, expectedEntryVersion: 3
    }), unsafeHeaders({ "content-type": "application/json", "idempotency-key": `entry-class-change:${requestId}` })), raceId, entryId, authenticate, change, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: false, requestId, entryId, classId });
  });

  it.each([
    ["text/plain", JSON.stringify({ formatVersion: 1, classId, expectedEntryVersion: 3 })],
    ["application/json", JSON.stringify({ formatVersion: 1, classId, expectedEntryVersion: 3, extra: true })],
    ["application/json", new Uint8Array([0xff])],
    ["application/json", new Uint8Array(4097)]
  ] as const)("avvisar medietyp, strikt kontrakt, UTF-8 och faktisk bodygräns", async (contentType, body) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const change = vi.fn() as unknown as typeof changeEntryClassAsAdmin;
    const response = await authenticatedEntryClassChangeRoute(db, request("PATCH", body, unsafeHeaders({
      "content-type": contentType, "idempotency-key": `entry-class-change:${requestId}`
    })), raceId, entryId, authenticate, change, environment);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "INVALID_REQUEST" });
    expect(change).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", 401, "UNAUTHORIZED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["invalid-request", 400, "INVALID_REQUEST"],
    ["not-found", 404, "NOT_FOUND"],
    ["conflict", 409, "CONFLICT"]
  ] as const)("mappar application-%s privat och stabilt", async (status, expectedStatus, code) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const change = vi.fn(async () => ({ status })) as unknown as typeof changeEntryClassAsAdmin;
    const response = await authenticatedEntryClassChangeRoute(db, request("PATCH", JSON.stringify({
      formatVersion: 1, classId, expectedEntryVersion: 3
    }), unsafeHeaders({ "content-type": "application/json", "idempotency-key": `entry-class-change:${requestId}` })), raceId, entryId, authenticate, change, environment);
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ formatVersion: 1, error: code });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("race-scopar logout och rensar endast klassadmincookies", async () => {
    const logoutImplementation = async (
      _db: Parameters<typeof logoutPairingAdminSession>[0],
      input: Parameters<typeof logoutPairingAdminSession>[1]
    ): ReturnType<typeof logoutPairingAdminSession> => {
      if (input.readBodyIsEmpty && !await input.readBodyIsEmpty()) return { status: "invalid-request" };
      return { status: "logged-out" };
    };
    const logout = vi.fn(logoutImplementation) as unknown as typeof logoutPairingAdminSession;
    const response = await entryClassAdminLogoutRoute(db, request("DELETE", undefined, unsafeHeaders()), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "CHANGE_ENTRY_CLASS" }));
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n")).toContain("Max-Age=0");
  });

  it("maskerar råa applicationfel", async () => {
    const authenticate = vi.fn(async () => { throw new Error("hemlig databasdetalj"); }) as unknown as typeof authenticatePairingAdminSession;
    const response = await authenticatedEntryClassChangeRoute(db, request("PATCH", "{}", unsafeHeaders({
      "content-type": "application/json", "idempotency-key": `entry-class-change:${requestId}`
    })), raceId, entryId, authenticate, vi.fn() as unknown as typeof changeEntryClassAsAdmin, environment);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("hemlig databasdetalj");
  });
});
