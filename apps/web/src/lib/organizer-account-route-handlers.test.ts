import { describe, expect, it, vi } from "vitest";
import type {
  authenticateUserAccountSession,
  createEventAsUserAccount,
  enterRaceAsUserAccount,
  listMyEventsAsUserAccount,
  loginUserAccount,
  logoutUserAccountSession,
  registerUserAccount
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  organizerEventCreateRoute,
  organizerEventsListRoute,
  organizerLoginRoute,
  organizerLogoutRoute,
  organizerRaceEnterRoute,
  organizerRegisterRoute,
  organizerSessionStatusRoute
} from "./organizer-account-route-handlers";

const db = {} as Database;
const prod = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const dev = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" } as const;
const accountId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const eventId = "10000000-0000-4000-8000-000000000003";
const raceId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const sessionToken = `otid_user_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const accountCookies = `__Host-otid-organizer-session=${sessionToken}; __Host-otid-organizer-csrf=${csrf}`;
const intent = { formatVersion: 1, eventName: "Testtävling", raceName: "Individuellt", raceDate: "2026-09-23", timeZone: "Europe/Stockholm" };
const principal = { accountId, sessionId, displayName: "Arrangör", expiresAt: "2026-09-23T12:00:00.000Z" };

function req(method: string, body?: BodyInit, headers: Record<string, string> = {}, url = "https://otid.example/api/organizer/events"): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(url, init);
}
function mutation(extra: Record<string, string> = {}, body = JSON.stringify(intent)) {
  return req("POST", body, { origin: prod.O_TID_PUBLIC_ORIGIN, cookie: accountCookies,
    "x-otid-csrf": csrf, "content-type": "application/json",
    "idempotency-key": `organizer-event-create:${requestId}`, ...extra });
}
function bodyTrackedRequest(headers: Record<string, string>) {
  const request = mutation(headers);
  const body = request.body;
  let accessed = false;
  Object.defineProperty(request, "body", { configurable: true, get() { accessed = true; return body; } });
  return { request, accessed: () => accessed };
}

describe("TASK150 organizer account routes", () => {
  it("logs in with host-only production cookies and never returns session secrets", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const,
      response: { formatVersion: 1 as const, accountId, displayName: principal.displayName, expiresAt: principal.expiresAt },
      sessionToken, csrfToken: csrf })) as unknown as typeof loginUserAccount;
    const response = await organizerLoginRoute(db, req("POST", JSON.stringify({ formatVersion: 1, loginName: "joel", password: "secret" }), {
      origin: prod.O_TID_PUBLIC_ORIGIN, "content-type": "application/json"
    }, "https://otid.example/api/organizer/login"), login, prod);
    expect(response.status).toBe(200);
    const responseBody = await response.clone().text();
    expect(await response.json()).toEqual({ formatVersion: 1, accountId, displayName: "Arrangör", expiresAt: principal.expiresAt });
    expect(responseBody).not.toContain(sessionToken);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain(`__Host-otid-organizer-session=${sessionToken}`);
    expect(cookies).toContain(`__Host-otid-organizer-csrf=${csrf}`);
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Strict");
  });

  it("uses explicitly separate non-Secure loopback cookies", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const,
      response: { formatVersion: 1 as const, accountId, displayName: principal.displayName, expiresAt: principal.expiresAt },
      sessionToken, csrfToken: csrf })) as unknown as typeof loginUserAccount;
    const response = await organizerLoginRoute(db, req("POST", JSON.stringify({ formatVersion: 1, loginName: "joel", password: "secret" }), {
      origin: dev.O_TID_PUBLIC_ORIGIN, "content-type": "application/json"
    }, "http://127.0.0.1:3000/api/organizer/login"), login, dev);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("otid_organizer_session");
    expect(cookies).toContain("otid_organizer_csrf");
    expect(cookies).not.toContain("Secure");
  });

  it("returns account status without secrets and fails closed for unauthenticated sessions", async () => {
    const authenticate = vi.fn(async () => ({ status: "authenticated" as const, principal })) as unknown as typeof authenticateUserAccountSession;
    const response = await organizerSessionStatusRoute(db, req("GET", undefined, { cookie: accountCookies }), authenticate, prod);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, accountId, displayName: "Arrangör", expiresAt: principal.expiresAt });
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken }));
    const unauthorized = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof authenticateUserAccountSession;
    expect((await organizerSessionStatusRoute(db, req("GET", undefined), unauthorized, prod)).status).toBe(401);
  });

  it("checks origin, CSRF, and idempotency key before consuming create bodies", async () => {
    const authenticate = vi.fn(async () => ({ status: "authenticated" as const, principal })) as unknown as typeof authenticateUserAccountSession;
    const create = vi.fn() as unknown as typeof createEventAsUserAccount;
    const wrongOrigin = bodyTrackedRequest({ origin: "https://evil.example" });
    expect((await organizerEventCreateRoute(db, wrongOrigin.request, authenticate, create, prod)).status).toBe(403);
    expect(wrongOrigin.accessed()).toBe(false);
    const forbidden = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof authenticateUserAccountSession;
    const wrongCsrf = bodyTrackedRequest({ "x-otid-csrf": "x".repeat(43) });
    expect((await organizerEventCreateRoute(db, wrongCsrf.request, forbidden, create, prod)).status).toBe(403);
    expect(wrongCsrf.accessed()).toBe(false);
    const badKey = bodyTrackedRequest({ "idempotency-key": "bad-key" });
    expect((await organizerEventCreateRoute(db, badKey.request, authenticate, create, prod)).status).toBe(400);
    expect(badKey.accessed()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("validates create responses and uses 201 for new records and 200 for replay", async () => {
    const authenticate = vi.fn(async () => ({ status: "authenticated" as const, principal })) as unknown as typeof authenticateUserAccountSession;
    for (const replayed of [false, true]) {
      const create = vi.fn(async (_database: Database, input: Parameters<typeof createEventAsUserAccount>[1]) => {
        expect(await input.readBody()).toEqual({ ...intent, raceType: "STANDARD" });
        return { status: "created" as const, response: { formatVersion: 1 as const, replayed, requestId, eventId, raceId, createdAt: "2026-09-23T08:00:00.000Z" } };
      }) as unknown as typeof createEventAsUserAccount;
      const response = await organizerEventCreateRoute(db, mutation(), authenticate, create, prod);
      expect(response.status).toBe(replayed ? 200 : 201);
      expect(create).toHaveBeenCalledWith(db, expect.objectContaining({
        idempotencyKey: `organizer-event-create:${requestId}`,
        sessionToken,
        csrfCookie: csrf,
        csrfHeader: csrf
      }));
    }
  });

  it("lists only validated account events and clears session cookies on logout", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: { formatVersion: 1 as const, events: [] } })) as unknown as typeof listMyEventsAsUserAccount;
    const listed = await organizerEventsListRoute(db, req("GET", undefined, { cookie: accountCookies }), list, prod);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ formatVersion: 1, events: [] });
    const logout = vi.fn(async () => ({ status: "logged-out" as const })) as unknown as typeof logoutUserAccountSession;
    const loggedOut = await organizerLogoutRoute(db, req("POST", undefined, {
      origin: prod.O_TID_PUBLIC_ORIGIN, cookie: accountCookies, "x-otid-csrf": csrf
    }, "https://otid.example/api/organizer/logout"), logout, prod);
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.getSetCookie().join("\n")).toContain("Max-Age=0");
  });

  it("enters only the requested race and puts delegated credentials only in admin cookies", async () => {
    const enter = vi.fn(async () => ({ status: "entered" as const,
      response: { formatVersion: 1 as const, raceId, expiresAt: principal.expiresAt },
      sessionToken: `otid_org_session_v1.${sessionId}.${"r".repeat(43)}`, csrfToken: csrf })) as unknown as typeof enterRaceAsUserAccount;
    const response = await organizerRaceEnterRoute(db, req("POST", undefined, {
      origin: prod.O_TID_PUBLIC_ORIGIN, cookie: accountCookies, "x-otid-csrf": csrf
    }, `https://otid.example/api/organizer/races/${raceId}/enter`), raceId, enter, prod);
    expect(response.status).toBe(200);
    const responseBody = await response.clone().text();
    expect(await response.json()).toEqual({ formatVersion: 1, raceId, expiresAt: principal.expiresAt });
    expect(response.headers.getSetCookie().join("\n")).toContain("__Host-otid-race-administrator-session");
    expect(responseBody).not.toContain("otid_org_session_v1");
    expect(enter).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, requireCsrf: true, sessionToken }));
  });
});

describe("ADR-0168 självregistrering", () => {
  const registerRequest = (origin: string = prod.O_TID_PUBLIC_ORIGIN) => req("POST",
    JSON.stringify({ formatVersion: 1, loginName: "ny.arrangor", displayName: "Ny Arrangör", password: "hemligt-lösen" }),
    { origin, "content-type": "application/json" }, "https://otid.example/api/organizer/register");

  it("skapar konto, sätter inloggningskakor och svarar 201 utan hemligheter i kroppen", async () => {
    const register = vi.fn(async () => ({ status: "authenticated" as const,
      response: { formatVersion: 1 as const, accountId, displayName: "Ny Arrangör", expiresAt: principal.expiresAt },
      sessionToken, csrfToken: csrf })) as unknown as typeof registerUserAccount;
    const response = await organizerRegisterRoute(db, registerRequest(), register, prod);
    expect(response.status).toBe(201);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-organizer-session=");
    expect(cookies).toContain("HttpOnly");
    const text = await response.text();
    expect(text).not.toContain(sessionToken);
    expect(JSON.parse(text)).toMatchObject({ accountId, displayName: "Ny Arrangör" });
  });

  it("svarar 409 för upptaget namn och 400 för ogiltig begäran", async () => {
    const conflict = vi.fn(async () => ({ status: "conflict" as const })) as unknown as typeof registerUserAccount;
    expect((await organizerRegisterRoute(db, registerRequest(), conflict, prod)).status).toBe(409);
    const invalid = vi.fn(async () => ({ status: "invalid-request" as const })) as unknown as typeof registerUserAccount;
    expect((await organizerRegisterRoute(db, registerRequest(), invalid, prod)).status).toBe(400);
  });

  it("avvisar fel origin innan något registreras", async () => {
    const register = vi.fn() as unknown as typeof registerUserAccount;
    expect((await organizerRegisterRoute(db, registerRequest("https://evil.example"), register, prod)).status).toBe(403);
    expect(register).not.toHaveBeenCalled();
  });
});
