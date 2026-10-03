import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  getRaceOverviewAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  raceOverviewAdminDataRoute,
  raceOverviewAdminLoginRoute,
  raceOverviewAdminLogoutRoute,
  raceOverviewAdminSessionStatusRoute
} from "./race-overview-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const courseId = "10000000-0000-4000-8000-000000000003";
const credentialId = "10000000-0000-4000-8000-000000000004";
const sessionId = "10000000-0000-4000-8000-000000000005";
const accessCredential = `otid_org_race_overview_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-race-overview-session=${sessionToken}`;
const csrfCookie = `__Host-otid-race-overview-csrf=${csrfToken}`;

const overview = {
  formatVersion: 1 as const,
  race: {
    id: raceId,
    eventName: "Testtävling",
    name: "Individuellt",
    raceDate: "2026-08-31",
    timeZone: "Europe/Stockholm",
    snapshotVersion: 4
  },
  classes: [{ id: classId, name: "H21", startRule: "FIXED" as const, entryCount: 2 }],
  courses: [{ id: courseId, name: "Långa" }],
  counts: { classes: 1, courses: 1, entries: 2, activeCardAssignments: 2, readouts: 1, resultRevisions: 1, imports: 2 },
  latestActivity: { readoutAt: null, resultRevisionAt: null, importAt: null }
};

function request(method: "GET" | "POST" | "DELETE", body?: BodyInit, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/admin/races/${raceId}/overview`, init);
}

function authenticated() {
  return {
    status: "authenticated" as const,
    principal: {
      accessCredentialId: credentialId,
      raceId,
      capability: "VIEW_RACE_OVERVIEW" as const,
      sessionId,
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

describe("TASK 005J overview routes", () => {
  it("race- och capability-scopar login och sätter endast overviewcookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "VIEW_RACE_OVERVIEW" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await raceOverviewAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, { formatVersion: 1, accessCredential }, {
      expectedRaceId: raceId,
      expectedCapability: "VIEW_RACE_OVERVIEW"
    });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-race-overview-session");
    expect(cookies).toContain("__Host-otid-race-overview-csrf");
    expect(cookies).toContain("Secure");
    expect(cookies).not.toMatch(/pairing-admin|import-admin|entry-class|recalculation-admin/);
  });

  it("avvisar fel origin och credential före login utan cookies", async () => {
    const login = vi.fn() as unknown as typeof loginPairingAdmin;
    const wrongOrigin = await raceOverviewAdminLoginRoute(db, request("POST", "{}", {
      origin: "https://evil.example",
      "content-type": "application/json"
    }), raceId, login, environment);
    expect(wrongOrigin.status).toBe(403);
    const wrongCredential = await raceOverviewAdminLoginRoute(db, request("POST", JSON.stringify({
      formatVersion: 1,
      accessCredential: `otid_org_import_v1.${credentialId}.${"a".repeat(43)}`
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(wrongCredential.status).toBe(401);
    expect(login).not.toHaveBeenCalled();
    expect(wrongCredential.headers.get("set-cookie")).toBeNull();
  });

  it("status-GET använder endast VIEW_RACE_OVERVIEW-sessionen", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await raceOverviewAdminSessionStatusRoute(db, request("GET", undefined, {
      cookie: sessionCookie
    }), raceId, authenticate, environment);
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      sessionToken
    }));
  });

  it("overview-GET lämnar bara strikt DTO och privata headers", async () => {
    const getOverview = vi.fn(async () => ({ status: "ok" as const, response: overview })) as unknown as typeof getRaceOverviewAsAdmin;
    const response = await raceOverviewAdminDataRoute(db, request("GET", undefined, {
      cookie: sessionCookie
    }), raceId, getOverview, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(overview);
    expect(getOverview).toHaveBeenCalledWith(db, { sessionToken, raceId });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("runtimevalidering blockerar extra privat canary", async () => {
    const getOverview = vi.fn(async () => ({
      status: "ok" as const,
      response: { ...overview, originalXml: "CANARY-XML" }
    })) as unknown as typeof getRaceOverviewAsAdmin;
    const response = await raceOverviewAdminDataRoute(db, request("GET", undefined, {
      cookie: sessionCookie
    }), raceId, getOverview, environment);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"formatVersion":1,"error":"INTERNAL_ERROR"}');
    expect(body).not.toContain("CANARY");
  });

  it("mappar auth och not-found stabilt utan att läsa body", async () => {
    for (const [applicationStatus, httpStatus, error] of [
      ["unauthorized", 401, "UNAUTHORIZED"],
      ["forbidden", 403, "FORBIDDEN"],
      ["not-found", 404, "NOT_FOUND"]
    ] as const) {
      const getOverview = vi.fn(async () => ({ status: applicationStatus })) as unknown as typeof getRaceOverviewAsAdmin;
      const response = await raceOverviewAdminDataRoute(db, request("GET", undefined, {
        cookie: sessionCookie
      }), raceId, getOverview, environment);
      expect(response.status).toBe(httpStatus);
      expect(await response.json()).toEqual({ formatVersion: 1, error });
    }
  });

  it("logout kräver Origin, CSRF och exakt tom body samt rensar bara overviewcookies", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => ({
      status: await input.readBodyIsEmpty?.() ? "logged-out" as const : "invalid-request" as const
    })) as unknown as typeof logoutPairingAdminSession;
    const response = await raceOverviewAdminLogoutRoute(db, request("DELETE", undefined, {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; ${csrfCookie}`,
      "x-otid-csrf": csrfToken
    }), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      sessionToken,
      csrfCookie: csrfToken,
      csrfHeader: csrfToken
    }));
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-race-overview-session=deleted");
    expect(cookies).toContain("__Host-otid-race-overview-csrf=deleted");
    expect(cookies).not.toMatch(/pairing-admin|import-admin|entry-class|recalculation-admin/);
  });

  it("avvisar logoutbody och lämnar cookies orörda", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => ({
      status: await input.readBodyIsEmpty?.() ? "logged-out" as const : "invalid-request" as const
    })) as unknown as typeof logoutPairingAdminSession;
    const response = await raceOverviewAdminLogoutRoute(db, request("DELETE", "{}", {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; ${csrfCookie}`,
      "x-otid-csrf": csrfToken,
      "content-type": "application/json"
    }), raceId, logout, environment);
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
