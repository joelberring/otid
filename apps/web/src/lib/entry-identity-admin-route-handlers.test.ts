import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { authenticatePairingAdminSession, changeEntryIdentityAsAdmin, loginPairingAdmin, listEntryIdentitiesAsAdmin, listEntryIdentityHistoryAsAdmin, logoutPairingAdminSession } from "@o-tid/application";
import { authenticatedEntryIdentityChangeRoute, entryIdentityAdminLoginRoute, entryIdentityAdminListRoute, entryIdentityAdminSessionStatusRoute, entryIdentityAdminHistoryRoute, entryIdentityAdminLogoutRoute } from "./entry-identity-admin-route-handlers";
import nextConfig from "../../next.config";

const db = {} as Database;
const id = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const sessionToken = `otid_org_session_v1.${id}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: id,
  expectedSnapshotVersion: 3, expectedIdentity: { givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK" },
  identity: { givenName: " Alva ", familyName: "Rättad", organisationName: "Ny OK" } };
function request(text = JSON.stringify(body), extra: Record<string, string> = {}) {
  return new Request("https://otid.example/api/card", { method: "PATCH", body: text, headers: {
    origin: "https://otid.example", "content-type": "application/json", "idempotency-key": `entry-identity-change:${id}`,
    cookie: `__Host-otid-entry-identity-admin-session=${sessionToken}; __Host-otid-entry-identity-admin-csrf=${csrfToken}`,
    "x-otid-csrf": csrfToken, ...extra
  } });
}
const authorized = () => ({ status: "authenticated" as const, principal: { accessCredentialId: id,
  raceId: id, capability: "CHANGE_ENTRY_IDENTITY" as const, sessionId: id, expiresAt: "2026-09-04T13:00:00Z" } });

describe("TASK026 namn- och klubbrättningsroutes", () => {
  it("sätter separata säkra cookies och binder login till capability och race", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const, response: { formatVersion: 1 as const,
      raceId: id, capability: "CHANGE_ENTRY_IDENTITY" as const, expiresAt: "2026-09-04T13:00:00Z" }, sessionToken, csrfToken })) as typeof loginPairingAdmin;
    const response = await entryIdentityAdminLoginRoute(db, request(JSON.stringify({ formatVersion: 1,
      accessCredential: `otid_org_entry_identity_v1.${id}.${"a".repeat(43)}` })), id, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: id, expectedCapability: "CHANGE_ENTRY_IDENTITY" });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-entry-identity-admin-session=");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("__Host-otid-entry-identity-admin-csrf=");
    expect(cookies[1]).not.toContain("HttpOnly");
    for (const cookie of cookies) for (const attribute of ["Secure", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(attribute);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await nextConfig.headers!()).find((row) => row.source === "/admin/:raceId/entry-identity")?.headers)
      .toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  });
  it("avvisar origin och auth innan bodyn läses; skickar separat CSRF-bevis till autentisering", async () => {
    const authenticate = vi.fn(async () => ({ status: "unauthorized" as const }));
    const change = vi.fn() as unknown as typeof changeEntryIdentityAsAdmin;
    const crossOrigin = request(undefined, { origin: "https://evil.example" });
    expect((await authenticatedEntryIdentityChangeRoute(db, crossOrigin, id, id, authenticate, change, environment)).status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
    expect(crossOrigin.bodyUsed).toBe(false);
    const unauthenticated = request();
    expect((await authenticatedEntryIdentityChangeRoute(db, unauthenticated, id, id, authenticate, change, environment)).status).toBe(401);
    expect(unauthenticated.bodyUsed).toBe(false);
    expect(authenticate).toHaveBeenCalledWith(db, { raceId: id, capability: "CHANGE_ENTRY_IDENTITY", requireCsrf: true,
      sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken });
    expect(change).not.toHaveBeenCalled();
  });
  it("begränsar faktisk body, avvisar extra fält och lämnar normaliserat intent oförändrat till tjänsten", async () => {
    const authenticate: typeof authenticatePairingAdminSession = vi.fn(async () => authorized());
    const change: typeof changeEntryIdentityAsAdmin = vi.fn(async () => ({ status: "conflict" as const }));
    for (const req of [request(" ".repeat(8193)), request(JSON.stringify({ ...body, elapsedMs: 1000 }))]) {
      expect((await authenticatedEntryIdentityChangeRoute(db, req, id, id, authenticate, change, environment)).status).toBe(400);
    }
    expect(change).not.toHaveBeenCalled();
    const json = JSON.stringify(body);
    const padded = json + " ".repeat(8192 - new TextEncoder().encode(json).byteLength);
    expect((await authenticatedEntryIdentityChangeRoute(db, request(padded), id, id, authenticate, change, environment)).status).toBe(409);
    const response = await authenticatedEntryIdentityChangeRoute(db, request(), id, id, authenticate, change, environment);
    expect(response.status).toBe(409);
    expect(change).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: id,
      idempotencyKey: `entry-identity-change:${id}`, request: { ...body, identity: { ...body.identity, givenName: "Alva" } } }));
  });

  it("avvisar deklarerad storlek, fel UTF-8 och dubblettcookie utan att godta främmande session", async () => {
    const authenticate: typeof authenticatePairingAdminSession = vi.fn(async () => authorized());
    const change: typeof changeEntryIdentityAsAdmin = vi.fn(async () => ({ status: "conflict" as const }));
    const badHeaders: Record<string, string>[] = [{ "content-length": "8193" }, { "content-type": "text/plain" }];
    for (const headers of badHeaders) {
      expect((await authenticatedEntryIdentityChangeRoute(db, request(undefined, headers), id, id, authenticate, change, environment)).status).toBe(400);
    }
    const invalidBytes = new Request("https://otid.example/api/identity", { method: "PATCH", headers: request().headers, body: new Uint8Array([0xff]) });
    expect((await authenticatedEntryIdentityChangeRoute(db, invalidBytes, id, id, authenticate, change, environment)).status).toBe(400);
    expect(change).not.toHaveBeenCalled();
    const denied = vi.fn(async () => ({ status: "unauthorized" as const }));
    await entryIdentityAdminSessionStatusRoute(db, request(undefined, { cookie: `__Host-otid-entry-identity-admin-session=${sessionToken}; __Host-otid-entry-identity-admin-session=${sessionToken}` }), id, denied, environment);
    expect(denied).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: null }));
    await entryIdentityAdminSessionStatusRoute(db, request(undefined, { cookie: `__Host-otid-entry-card-admin-session=${sessionToken}` }), id, denied, environment);
    expect(denied).toHaveBeenLastCalledWith(db, expect.objectContaining({ sessionToken: null }));
  });

  it("binder login/session/lista och mutationskvitto till exakt route-scope", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const, response: { formatVersion: 1 as const,
      raceId: otherId, capability: "CHANGE_ENTRY_IDENTITY" as const, expiresAt: "2026-09-09T13:00:00Z" }, sessionToken, csrfToken })) as typeof loginPairingAdmin;
    const wrongLogin = await entryIdentityAdminLoginRoute(db, request(JSON.stringify({ formatVersion: 1,
      accessCredential: `otid_org_entry_identity_v1.${id}.${"a".repeat(43)}` })), id, login, environment);
    expect(wrongLogin.status).toBe(500);
    expect(wrongLogin.headers.getSetCookie()).toEqual([]);
    const authenticate: typeof authenticatePairingAdminSession = vi.fn(async () => ({ ...authorized(), principal: { ...authorized().principal, raceId: otherId } }));
    expect((await entryIdentityAdminSessionStatusRoute(db, request(), id, authenticate, environment)).status).toBe(500);
    const list: typeof listEntryIdentitiesAsAdmin = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId: otherId, snapshotVersion: 3, entries: [] } }));
    expect((await entryIdentityAdminListRoute(db, request(), id, list, environment)).status).toBe(500);
    const goodAuth: typeof authenticatePairingAdminSession = vi.fn(async () => authorized());
    for (const changedScope of [{ raceId: otherId }, { entryId: otherId }, { requestId: otherId }]) {
      const change: typeof changeEntryIdentityAsAdmin = vi.fn(async () => ({ status: "changed" as const, response: {
        formatVersion: 1 as const, raceId: id, entryId: id, requestId: id, classId: id, replayed: false,
        previousIdentity: body.expectedIdentity, identity: { ...body.identity, givenName: "Alva" },
        entryVersionBefore: 1, entryVersionAfter: 2, snapshotVersionBefore: 3, snapshotVersionAfter: 4,
        changedAt: "2026-09-09T10:00:00Z", ...changedScope } }));
      const response = await authenticatedEntryIdentityChangeRoute(db, request(), id, id, goodAuth, change, environment);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("Alva");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("läser bara bounded journal för vald deltagare och avvisar dolda queryparametrar", async () => {
    const responseBody = { formatVersion: 1 as const, raceId: id, entryId: id, items: [], nextCursor: null };
    const list: typeof listEntryIdentityHistoryAsAdmin = vi.fn(async () => ({ status: "ok" as const, response: responseBody }));
    const get = (query = "") => new Request(`https://otid.example/api/identity/history${query}`, { headers: { cookie: request().headers.get("cookie")! } });
    const first = await entryIdentityAdminHistoryRoute(db, get(), id, id, list, environment);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(responseBody);
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(list).toHaveBeenLastCalledWith(db, expect.objectContaining({ raceId: id, entryId: id, limit: 20, sessionToken }));
    await entryIdentityAdminHistoryRoute(db, get("?limit=50&cursor=YWJj"), id, id, list, environment);
    expect(list).toHaveBeenLastCalledWith(db, expect.objectContaining({ limit: 50, cursor: "YWJj" }));
    vi.mocked(list).mockClear();
    for (const query of ["?limit=51", "?limit=0", "?limit=01", "?limit=2&limit=2", "?cursor=", "?cursor=a&cursor=b", "?name=Ada", `?cursor=${"a".repeat(1025)}`]) {
      expect((await entryIdentityAdminHistoryRoute(db, get(query), id, id, list, environment)).status).toBe(400);
    }
    expect(list).not.toHaveBeenCalled();
    for (const wrongScope of [{ raceId: otherId }, { entryId: otherId }]) {
      vi.mocked(list).mockResolvedValueOnce({ status: "ok", response: { ...responseBody, ...wrongScope } });
      expect((await entryIdentityAdminHistoryRoute(db, get(), id, id, list, environment)).status).toBe(500);
    }
    for (const [status, code] of [["unauthorized", 401], ["forbidden", 403], ["not-found", 404], ["invalid-request", 400]] as const) {
      vi.mocked(list).mockResolvedValueOnce({ status });
      expect((await entryIdentityAdminHistoryRoute(db, get(), id, id, list, environment)).status).toBe(code);
    }
  });

  it("logout använder egen capability och tömmer bara egna cookies", async () => {
    const logout: typeof logoutPairingAdminSession = vi.fn(async () => ({ status: "logged-out" as const }));
    const response = await entryIdentityAdminLogoutRoute(db, new Request("https://otid.example/api/session", {
      method: "DELETE", headers: { origin: environment.O_TID_PUBLIC_ORIGIN, cookie: request().headers.get("cookie")!, "x-otid-csrf": csrfToken }
    }), id, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, capability: "CHANGE_ENTRY_IDENTITY", csrfCookie: csrfToken, csrfHeader: csrfToken }));
    expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain("entry-identity-admin");
      expect(cookie).toContain("Max-Age=0");
    }
  });
});
