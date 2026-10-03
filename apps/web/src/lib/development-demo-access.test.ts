import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin } from "@o-tid/application";
import { developmentDemoAccessEnabled, developmentDemoSessionRoute } from "./development-demo-access";

const raceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "10000000-0000-4000-8000-000000000002";
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const env = {
  NODE_ENV: "development", O_TID_DEV_AUTO_LOGIN_RACE_ID: raceId,
  O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://local@127.0.0.1:5432/otid_demo_task162"
} as const;
const db = {} as Database;
const issued = {
  formatVersion: 1 as const, accessCredential: `otid_org_race_admin_v1.${sessionId}.${"a".repeat(43)}`,
  credentialId: sessionId, raceId, capability: "MANAGE_RACE" as const, label: "Lokal utvecklingsåtkomst",
  issuedAt: "2026-09-24T10:00:00.000Z", expiresAt: "2026-09-24T18:00:00.000Z"
};
const loginResult = {
  status: "authenticated" as const,
  response: { formatVersion: 1 as const, raceId, capability: "MANAGE_RACE" as const, expiresAt: "2026-09-24T11:00:00.000Z" },
  sessionToken, csrfToken: csrf
};
const principal = { accessCredentialId: sessionId, raceId, capability: "MANAGE_RACE" as const,
  sessionId, expiresAt: loginResult.response.expiresAt };
function request(headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/admin", { method: "POST", headers: {
    origin: env.O_TID_PUBLIC_ORIGIN, host: "127.0.0.1:3000", ...headers
  } });
}
function services(actualDatabase = "otid_demo_task162") {
  return {
    currentDatabaseName: vi.fn(async () => actualDatabase),
    authenticate: vi.fn<typeof authenticatePairingAdminSession>(async () => ({ status: "unauthorized" })),
    issue: vi.fn<typeof issuePairingAdminAccessCredential>(async () => issued),
    login: vi.fn<typeof loginPairingAdmin>(async () => loginResult),
    now: () => new Date("2026-09-24T10:00:00.000Z")
  };
}

describe("lokal utvecklingsåtkomst till exakt demolopp", () => {
  it("kräver development, vald kanonisk race, loopback origin och demo-databas", () => {
    expect(developmentDemoAccessEnabled(raceId, env)).toBe(true);
    expect(developmentDemoAccessEnabled(raceId.toUpperCase(), env)).toBe(false);
    expect(developmentDemoAccessEnabled(raceId, { ...env, NODE_ENV: "production" })).toBe(false);
    expect(developmentDemoAccessEnabled(raceId, { ...env, NODE_ENV: "test" })).toBe(false);
    expect(developmentDemoAccessEnabled(raceId, { ...env, O_TID_DEMO_E2E: "1" })).toBe(false);
    expect(developmentDemoAccessEnabled(raceId, { ...env, O_TID_PUBLIC_ORIGIN: "https://127.0.0.1:3000" })).toBe(false);
    expect(developmentDemoAccessEnabled(raceId, { ...env, DATABASE_URL: "postgresql://host.example:5432/otid_demo_task162" })).toBe(false);
  });

  it("refuses another race and mismatched origin or Host before database access", async () => {
    const deps = services();
    expect((await developmentDemoSessionRoute(db, request(), "10000000-0000-4000-8000-000000000003", deps, env)).status).toBe(404);
    expect((await developmentDemoSessionRoute(db, request({ origin: "http://localhost:3000" }), raceId, deps, env)).status).toBe(403);
    expect((await developmentDemoSessionRoute(db, request({ host: "localhost:3000" }), raceId, deps, env)).status).toBe(403);
    expect(deps.currentDatabaseName).not.toHaveBeenCalled();
  });

  it("checks the actual database before creating any access rows", async () => {
    const deps = services("otid_demo_other");
    expect((await developmentDemoSessionRoute(db, request(), raceId, deps, env)).status).toBe(404);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.login).not.toHaveBeenCalled();
  });

  it("reuses a still-valid ordinary MANAGE_RACE session", async () => {
    const deps = services();
    deps.authenticate.mockResolvedValue({ status: "authenticated", principal });
    const response = await developmentDemoSessionRoute(db, request({ cookie:
      `otid_race_administrator_session=${sessionToken}; otid_race_administrator_csrf=${csrf}` }), raceId, deps, env);
    expect(response.status).toBe(200);
    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.login).not.toHaveBeenCalled();
    expect(deps.authenticate).toHaveBeenCalledWith(db, expect.objectContaining({
      sessionToken, raceId, capability: "MANAGE_RACE", csrfCookie: csrf, csrfHeader: csrf, requireCsrf: true
    }));
    expect(response.headers.get("set-cookie")).toContain(`otid_race_administrator_session=${sessionToken}`);
  });

  it("issues and logs in with a short-lived audited credential without returning it", async () => {
    const deps = services();
    // Next can use its internal hostname in request.url, independently of Host.
    const nextRequest = new Request("http://localhost:3000/api/admin", {
      method: "POST", headers: { origin: env.O_TID_PUBLIC_ORIGIN, host: "127.0.0.1:3000" }
    });
    const response = await developmentDemoSessionRoute(db, nextRequest, raceId, deps, env);
    expect(response.status).toBe(200);
    expect(deps.issue).toHaveBeenCalledWith(db, expect.objectContaining({
      raceId, capability: "MANAGE_RACE", label: "Lokal utvecklingsåtkomst",
      expiresAt: new Date("2026-09-24T18:00:00.000Z")
    }), { now: new Date("2026-09-24T10:00:00.000Z") });
    expect(deps.login).toHaveBeenCalledWith(db,
      { formatVersion: 1, accessCredential: issued.accessCredential },
      expect.objectContaining({ expectedRaceId: raceId, expectedCapability: "MANAGE_RACE" }));
    const body = await response.text();
    expect(body).not.toContain(issued.accessCredential);
    expect(body).not.toContain(sessionToken);
    expect(body).not.toContain(csrf);
    expect(body).toContain(raceId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toContain("otid_race_administrator_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects a request body and never calls a write service", async () => {
    const deps = services();
    const withBody = new Request("http://127.0.0.1:3000/api/admin", { method: "POST",
      headers: { origin: env.O_TID_PUBLIC_ORIGIN, host: "127.0.0.1:3000" }, body: "unexpected" });
    expect((await developmentDemoSessionRoute(db, withBody, raceId, deps, env)).status).toBe(400);
    expect(deps.currentDatabaseName).not.toHaveBeenCalled();
    expect(deps.issue).not.toHaveBeenCalled();
  });
});
