import { describe, expect, it, vi } from "vitest";
import type {
  issuePairingGrantAsAdmin,
  listPairingGrantsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  revokePairingGrantAsAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  pairingAdminGrantIssueRoute,
  pairingAdminGrantListRoute,
  pairingAdminGrantRevokeRoute,
  pairingAdminLoginRoute,
  pairingAdminLogoutRoute
} from "./pairing-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const grantId = "10000000-0000-4000-8000-000000000002";
const sessionToken = `otid_org_session_v1.10000000-0000-4000-8000-000000000003.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-pairing-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-pairing-admin-csrf=${csrfToken}`;
const accessCredential = `otid_org_pair_v1.10000000-0000-4000-8000-000000000004.${"a".repeat(43)}`;

const activeGrant = {
  formatVersion: 1 as const,
  grantId,
  raceId,
  scope: "READOUT" as const,
  status: "ACTIVE" as const,
  issuedAt: "2026-08-31T12:00:00.000Z",
  expiresAt: "2026-08-31T12:10:00.000Z",
  credentialExpiresAt: "2026-09-01T12:00:00.000Z",
  redeemedAt: null,
  revokedAt: null
};

function request(
  path: string,
  method: "GET" | "POST" | "DELETE",
  options: { body?: string; headers?: Record<string, string> } = {}
): Request {
  const init: RequestInit = { method };
  if (options.headers !== undefined) init.headers = options.headers;
  if (options.body !== undefined) init.body = options.body;
  return new Request(`https://otid.example${path}`, init);
}

function unsafeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    origin: "https://otid.example",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken,
    ...extra
  };
}

function mockLogin(implementation: (...args: Parameters<typeof loginPairingAdmin>) => ReturnType<typeof loginPairingAdmin>) {
  return vi.fn(implementation) as unknown as typeof loginPairingAdmin;
}

function mockLogout(implementation: (...args: Parameters<typeof logoutPairingAdminSession>) => ReturnType<typeof logoutPairingAdminSession>) {
  return vi.fn(implementation) as unknown as typeof logoutPairingAdminSession;
}

function mockIssue(implementation: (...args: Parameters<typeof issuePairingGrantAsAdmin>) => ReturnType<typeof issuePairingGrantAsAdmin>) {
  return vi.fn(implementation) as unknown as typeof issuePairingGrantAsAdmin;
}

function mockList(implementation: (...args: Parameters<typeof listPairingGrantsAsAdmin>) => ReturnType<typeof listPairingGrantsAsAdmin>) {
  return vi.fn(implementation) as unknown as typeof listPairingGrantsAsAdmin;
}

function mockRevoke(implementation: (...args: Parameters<typeof revokePairingGrantAsAdmin>) => ReturnType<typeof revokePairingGrantAsAdmin>) {
  return vi.fn(implementation) as unknown as typeof revokePairingGrantAsAdmin;
}

describe("TASK 005F pairingadmin-routes", () => {
  it("loggar in med exakt body och sätter privat HttpOnly-session samt läsbar CSRF-cookie", async () => {
    const login = mockLogin(async () => ({
      status: "authenticated",
      response: {
        formatVersion: 1,
        raceId,
        capability: "PAIR_STATION",
        expiresAt: "2026-08-31T20:00:00.000Z"
      },
      sessionToken,
      csrfToken
    }));
    const response = await pairingAdminLoginRoute(db, request(`/api/admin/races/${raceId}/pairing-session`, "POST", {
      headers: { origin: "https://otid.example", "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, accessCredential })
    }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      formatVersion: 1,
      raceId,
      capability: "PAIR_STATION",
      expiresAt: "2026-08-31T20:00:00.000Z"
    });
    expect(login).toHaveBeenCalledWith(db, expect.anything(), {
      expectedRaceId: raceId,
      expectedCapability: "PAIR_STATION"
    });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(JSON.stringify((login as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(sessionToken);
  });

  it("avvisar login från fel Origin före body och applicationkärna", async () => {
    const login = mockLogin(async () => ({ status: "unauthorized" }));
    const response = await pairingAdminLoginRoute(db, request(`/api/admin/races/${raceId}/pairing-session`, "POST", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "inte-json"
    }), raceId, login, environment);
    expect(response.status).toBe(403);
    expect(login).not.toHaveBeenCalled();
  });

  it("skiljer kontraktsfel 400 från syntaktiskt fel accesscredential 401", async () => {
    const login = mockLogin(async () => ({ status: "unauthorized" }));
    const malformedCredential = await pairingAdminLoginRoute(db, request(`/api/admin/races/${raceId}/pairing-session`, "POST", {
      headers: { origin: "https://otid.example", "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, accessCredential: "fel" })
    }), raceId, login, environment);
    expect(malformedCredential.status).toBe(401);
    const extraKey = await pairingAdminLoginRoute(db, request(`/api/admin/races/${raceId}/pairing-session`, "POST", {
      headers: { origin: "https://otid.example", "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, accessCredential, extra: true })
    }), raceId, login, environment);
    expect(extraKey.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it("lämnar issue-bodyn oläst när application avvisar sessionen", async () => {
    let captured: Parameters<typeof issuePairingGrantAsAdmin>[1] | undefined;
    const issue = mockIssue(async (_db, input) => {
      captured = input;
      return { status: "unauthorized" };
    });
    const response = await pairingAdminGrantIssueRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants`,
      "POST",
      { headers: unsafeHeaders({ "content-type": "text/plain" }), body: "inte-json" }
    ), raceId, issue, environment);
    expect(response.status).toBe(401);
    expect(issue).toHaveBeenCalledOnce();
    expect(captured).toMatchObject({
      sessionToken,
      csrfCookie: csrfToken,
      csrfHeader: csrfToken,
      raceId,
      capability: "PAIR_STATION"
    });
  });

  it("vidarebefordrar endast body-callback och exakt idempotensheader vid issue", async () => {
    const issue = mockIssue(async (_db, input) => {
      const body = await input.readBody();
      expect(body).toEqual({
        formatVersion: 1,
        grantId,
        grantSecretHash: "f".repeat(64),
        credentialLifetimeHours: 24
      });
      expect(input.idempotencyKey).toBe(`pairing-grant:${grantId}`);
      return { status: "stored", response: { formatVersion: 1, status: "stored", grant: activeGrant } };
    });
    const response = await pairingAdminGrantIssueRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants`,
      "POST",
      {
        headers: unsafeHeaders({
          "content-type": "application/json",
          "idempotency-key": `pairing-grant:${grantId}`
        }),
        body: JSON.stringify({
          formatVersion: 1,
          grantId,
          grantSecretHash: "f".repeat(64),
          credentialLifetimeHours: 24
        })
      }
    ), raceId, issue, environment);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ formatVersion: 1, status: "stored", grant: activeGrant });
  });

  it.each([
    ["unauthorized", 401],
    ["forbidden", 403],
    ["invalid-request", 400],
    ["conflict", 409]
  ] as const)("mappar issue-%s till generiskt privat %i", async (status, expected) => {
    const issue = mockIssue(async () => ({ status }));
    const response = await pairingAdminGrantIssueRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants`,
      "POST",
      { headers: unsafeHeaders({ "content-type": "application/json" }), body: "{}" }
    ), raceId, issue, environment);
    expect(response.status).toBe(expected);
    expect(await response.json()).toEqual({ error: "Pairingadministrationen kunde inte genomföras" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("listar endast runtimevaliderad metadata för sessionens race", async () => {
    const list = mockList(async () => ({
      status: "ok",
      response: { formatVersion: 1, grants: [activeGrant] }
    }));
    const response = await pairingAdminGrantListRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants`,
      "GET",
      { headers: { cookie: sessionCookie } }
    ), raceId, list, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, grants: [activeGrant] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, sessionToken }));
  });

  it("kräver tom revoke-request och mappar annat race/grant till 404 utan läcka", async () => {
    const revoke = mockRevoke(async (_db, input) =>
      input.readBodyIsEmpty !== undefined && !await input.readBodyIsEmpty()
        ? { status: "invalid-request" }
        : { status: "not-found" });
    const withBody = await pairingAdminGrantRevokeRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants/${grantId}/revoke`,
      "POST",
      { headers: unsafeHeaders({ "content-type": "application/json" }), body: "{}" }
    ), raceId, grantId, revoke, environment);
    expect(withBody.status).toBe(400);
    expect(revoke).toHaveBeenCalledOnce();

    const missing = await pairingAdminGrantRevokeRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants/${grantId}/revoke`,
      "POST",
      { headers: unsafeHeaders() }
    ), raceId, grantId, revoke, environment);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Pairingadministrationen kunde inte genomföras" });
  });

  it("loggar ut append-only och rensar båda cookies utan svarskropp", async () => {
    const logout = mockLogout(async (_db, input) =>
      input.readBodyIsEmpty !== undefined && !await input.readBodyIsEmpty()
        ? { status: "invalid-request" }
        : { status: "already-logged-out" });
    const response = await pairingAdminLogoutRoute(db, request(
      `/api/admin/races/${raceId}/pairing-session`,
      "DELETE",
      { headers: unsafeHeaders() }
    ), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "PAIR_STATION" }));
  });

  it("maskerar applicationfel och ogiltiga application-responses som 500", async () => {
    const list = mockList(async () => {
      throw new Error("hemlig databasdetalj");
    });
    const response = await pairingAdminGrantListRoute(db, request(
      `/api/admin/races/${raceId}/pairing-grants`,
      "GET",
      { headers: { cookie: sessionCookie } }
    ), raceId, list, environment);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("hemlig databasdetalj");
  });
});
