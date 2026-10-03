import { describe, expect, it, vi } from "vitest";
import type {
  authenticateEventCreationAdminSession,
  createEventAsAdmin,
  loginEventCreationAdmin,
  logoutEventCreationAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedEventCreationRoute,
  eventCreationLoginRoute,
  eventCreationLogoutRoute,
  eventCreationSessionStatusRoute
} from "./event-creation-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const credentialId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const eventId = "10000000-0000-4000-8000-000000000004";
const raceId = "10000000-0000-4000-8000-000000000005";
const accessCredential = `otid_org_event_create_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_event_create_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-event-creation-session=${sessionToken}`;
const csrfCookie = `__Host-otid-event-creation-csrf=${csrfToken}`;
const intent = {
  formatVersion: 1 as const,
  eventName: "Testtävling",
  raceName: "Individuellt",
  raceDate: "2026-08-31",
  timeZone: "Europe/Stockholm"
};
const created = {
  formatVersion: 1 as const,
  replayed: false,
  requestId,
  eventId,
  raceId,
  createdAt: "2026-08-31T10:00:00.000Z"
};

function request(method: "GET" | "POST" | "DELETE", body?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request("https://otid.example/api/events", init);
}

function mutationHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://otid.example",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken,
    "content-type": "application/json",
    "idempotency-key": `event-create:${requestId}`,
    ...extra
  };
}

function authenticated() {
  return {
    status: "authenticated" as const,
    principal: {
      accessCredentialId: credentialId,
      capability: "CREATE_EVENT" as const,
      sessionId,
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

function bodyTrackedRequest(headers: Record<string, string>) {
  let bodyAccessed = false;
  const tracked = request("POST", JSON.stringify(intent), headers);
  const body = tracked.body;
  Object.defineProperty(tracked, "body", {
    configurable: true,
    get() {
      bodyAccessed = true;
      return body;
    }
  });
  return {
    request: tracked,
    wasBodyAccessed: () => bodyAccessed
  };
}

describe("TASK 005K event creation routes", () => {
  it("loggar in globalt och sätter endast skapandecookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, capability: "CREATE_EVENT" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginEventCreationAdmin;
    const response = await eventCreationLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, { formatVersion: 1, accessCredential });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-event-creation-session");
    expect(cookies).toContain("__Host-otid-event-creation-csrf");
    expect(cookies).toContain("Secure");
    expect(cookies).not.toMatch(/pairing-admin|import-admin|entry-class|recalculation|race-overview/);
  });

  it("avvisar fel Origin och annat credentialprefix utan session eller cookies", async () => {
    const login = vi.fn() as unknown as typeof loginEventCreationAdmin;
    const wrongOrigin = await eventCreationLoginRoute(db, request("POST", "{}", {
      origin: "https://evil.example",
      "content-type": "application/json"
    }), login, environment);
    expect(wrongOrigin.status).toBe(403);
    const wrongCredential = await eventCreationLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential: `otid_org_race_overview_v1.${credentialId}.${"a".repeat(43)}`
    }), { origin: "https://otid.example", "content-type": "application/json" }), login, environment);
    expect(wrongCredential.status).toBe(401);
    expect(login).not.toHaveBeenCalled();
    expect(wrongCredential.headers.get("set-cookie")).toBeNull();
  });

  it("använder explicit separata loopbackcookies utan Secure", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, capability: "CREATE_EVENT" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginEventCreationAdmin;
    const response = await eventCreationLoginRoute(db, new Request("http://127.0.0.1:3000/api/admin/event-creation-session", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, accessCredential })
    }), login, { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("otid_event_creation_session");
    expect(cookies).toContain("otid_event_creation_csrf");
    expect(cookies).not.toContain("Secure");
  });

  it("sessionstatus använder endast den globala skapandesessionen", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const response = await eventCreationSessionStatusRoute(db, request("GET", undefined, {
      cookie: sessionCookie
    }), authenticate, environment);
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken }));
    expect(await response.json()).toEqual({
      formatVersion: 1,
      capability: "CREATE_EVENT",
      expiresAt: "2026-08-31T13:00:00.000Z"
    });
  });

  it("avvisar Origin och auth/CSRF före body-pull", async () => {
    const unauthorized = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn() as unknown as typeof createEventAsAdmin;
    const tracked = bodyTrackedRequest(mutationHeaders());
    const response = await authenticatedEventCreationRoute(db, tracked.request, unauthorized, create, environment);
    expect(response.status).toBe(401);
    expect(tracked.wasBodyAccessed()).toBe(false);
    expect(create).not.toHaveBeenCalled();

    const authenticate = vi.fn() as unknown as typeof authenticateEventCreationAdminSession;
    const wrongOrigin = bodyTrackedRequest(mutationHeaders({ origin: "https://evil.example" }));
    const forbidden = await authenticatedEventCreationRoute(db, wrongOrigin.request, authenticate, create, environment);
    expect(forbidden.status).toBe(403);
    expect(wrongOrigin.wasBodyAccessed()).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();

    const csrfRejected = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof authenticateEventCreationAdminSession;
    const wrongCsrf = bodyTrackedRequest(mutationHeaders({ "x-otid-csrf": "x".repeat(43) }));
    const csrfResponse = await authenticatedEventCreationRoute(db, wrongCsrf.request, csrfRejected, create, environment);
    expect(csrfResponse.status).toBe(403);
    expect(wrongCsrf.wasBodyAccessed()).toBe(false);
  });

  it("avvisar icke-kanonisk key före body-pull efter godkänd auth", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn() as unknown as typeof createEventAsAdmin;
    const tracked = bodyTrackedRequest(mutationHeaders({ "idempotency-key": "event-create:NOT-UUID" }));
    const response = await authenticatedEventCreationRoute(db, tracked.request, authenticate, create, environment);
    expect(response.status).toBe(400);
    expect(tracked.wasBodyAccessed()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["text/json", JSON.stringify(intent)],
    ["application/json; charset=utf-8", JSON.stringify(intent)],
    ["application/json", ""],
    ["application/json", "{"],
    ["application/json", JSON.stringify({ ...intent, secret: "CANARY" })],
    ["application/json", "x".repeat(4097)]
  ])("avvisar strikt body med content-type %s", async (contentType, body) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn() as unknown as typeof createEventAsAdmin;
    const response = await authenticatedEventCreationRoute(db, request("POST", body, mutationHeaders({
      "content-type": contentType
    })), authenticate, create, environment);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "INVALID_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  it("avvisar ogiltig UTF-8 och accepterar exakt 1–4096-gränsen utan rå feltext", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn() as unknown as typeof createEventAsAdmin;
    const response = await authenticatedEventCreationRoute(db, request("POST", new Uint8Array([0xff]), mutationHeaders()), authenticate, create, environment);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"formatVersion":1,"error":"INVALID_REQUEST"}');
  });

  it("returnerar 201 för create och 200 för strikt replay", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    for (const replayed of [false, true]) {
      const createImplementation = async (
        _db: Parameters<typeof createEventAsAdmin>[0],
        input: Parameters<typeof createEventAsAdmin>[1]
      ): ReturnType<typeof createEventAsAdmin> => {
        expect(await input.readBody()).toEqual(intent);
        return { status: "created" as const, response: { ...created, replayed } };
      };
      const create = vi.fn(createImplementation) as unknown as typeof createEventAsAdmin;
      const response = await authenticatedEventCreationRoute(db, request("POST", JSON.stringify(intent), mutationHeaders()), authenticate, create, environment);
      expect(response.status).toBe(replayed ? 200 : 201);
      expect(await response.json()).toEqual({ ...created, replayed });
      expect(create).toHaveBeenCalledWith(db, expect.objectContaining({
        sessionToken,
        csrfCookie: csrfToken,
        csrfHeader: csrfToken,
        idempotencyKey: `event-create:${requestId}`
      }));
    }
  });

  it("accepterar exakt 4096 bytes strikt JSON med avslutande whitespace", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn(async () => ({ status: "created" as const, response: created })) as unknown as typeof createEventAsAdmin;
    const baseBody = JSON.stringify(intent);
    const exactBody = baseBody + " ".repeat(4096 - new TextEncoder().encode(baseBody).byteLength);
    expect(new TextEncoder().encode(exactBody)).toHaveLength(4096);
    const response = await authenticatedEventCreationRoute(db, request("POST", exactBody, mutationHeaders()), authenticate, create, environment);
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });

  it("runtimevalidering blockerar extra privat svarsfält", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn(async () => ({
      status: "created" as const,
      response: { ...created, credentialHash: "CANARY" }
    })) as unknown as typeof createEventAsAdmin;
    const response = await authenticatedEventCreationRoute(db, request("POST", JSON.stringify(intent), mutationHeaders()), authenticate, create, environment);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("CANARY");
    expect(body).toBe('{"formatVersion":1,"error":"INTERNAL_ERROR"}');
  });

  it.each([
    ["unauthorized", 401, "UNAUTHORIZED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["invalid-request", 400, "INVALID_REQUEST"],
    ["conflict", 409, "CONFLICT"]
  ] as const)("mappar usecase-%s stabilt", async (status, expectedStatus, error) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticateEventCreationAdminSession;
    const create = vi.fn(async () => ({ status })) as unknown as typeof createEventAsAdmin;
    const response = await authenticatedEventCreationRoute(db, request("POST", JSON.stringify(intent), mutationHeaders()), authenticate, create, environment);
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ formatVersion: 1, error });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("logout kräver Origin, CSRF och tom body och rensar endast skapandecookies", async () => {
    const logoutImplementation = async (
      _db: Parameters<typeof logoutEventCreationAdminSession>[0],
      input: Parameters<typeof logoutEventCreationAdminSession>[1]
    ): ReturnType<typeof logoutEventCreationAdminSession> => {
      if (input.readBodyIsEmpty && !await input.readBodyIsEmpty()) return { status: "invalid-request" as const };
      return { status: "logged-out" as const };
    };
    const logout = vi.fn(logoutImplementation) as unknown as typeof logoutEventCreationAdminSession;
    const response = await eventCreationLogoutRoute(db, request("DELETE", undefined, {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; ${csrfCookie}`,
      "x-otid-csrf": csrfToken
    }), logout, environment);
    expect(response.status).toBe(204);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-event-creation-session=deleted");
    expect(cookies).toContain("__Host-otid-event-creation-csrf=deleted");
    expect(cookies).not.toMatch(/pairing-admin|import-admin|entry-class|recalculation|race-overview/);

    const bodyResponse = await eventCreationLogoutRoute(db, request("DELETE", "{}", {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; ${csrfCookie}`,
      "x-otid-csrf": csrfToken,
      "content-type": "application/json"
    }), logout, environment);
    expect(bodyResponse.status).toBe(400);
    expect(bodyResponse.headers.get("set-cookie")).toBeNull();
  });

  it("failar stängt vid saknad canonical origin", async () => {
    const response = await eventCreationSessionStatusRoute(db, request("GET"), vi.fn() as unknown as typeof authenticateEventCreationAdminSession, {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "INTERNAL_ERROR" });
  });
});
