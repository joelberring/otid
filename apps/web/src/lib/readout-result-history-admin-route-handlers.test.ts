import { describe, expect, it, vi } from "vitest";
import type {
  getReadoutHistoryAsAdmin,
  listReadoutHistoryAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  readoutHistoryDetailRoute,
  readoutHistoryListRoute,
  readoutResultHistoryAdminLoginRoute,
  readoutResultHistoryAdminLogoutRoute
} from "./readout-result-history-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const readoutId = "20000000-0000-4000-8000-000000000002";
const credentialId = "30000000-0000-4000-8000-000000000003";
const sessionId = "40000000-0000-4000-8000-000000000004";
const accessCredential = `otid_org_readout_result_history_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const sessionCookie = `__Host-otid-readout-result-history-session=${sessionToken}`;

function request(path: string, method = "GET", body?: BodyInit, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example${path}`, init);
}

describe("TASK 005N historyroutar", () => {
  it("loggar in endast med separat capability och sätter isolerade cookies", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "VIEW_READOUT_RESULT_HISTORY" as const,
        expiresAt: "2026-08-31T13:00:00.000Z" }, sessionToken, csrfToken: csrf })) as unknown as typeof loginPairingAdmin;
    const response = await readoutResultHistoryAdminLoginRoute(db, request("/session", "POST", JSON.stringify({
      formatVersion: 1, accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, { formatVersion: 1, accessCredential }, {
      expectedRaceId: raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY"
    });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-readout-result-history-session");
    expect(cookies).toContain("__Host-otid-readout-result-history-csrf");
    expect(cookies).not.toMatch(/race-overview|pairing-admin|import-admin/);
  });

  it("validerar query före use case och skickar session/cursor/limit", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId, items: [], nextCursor: null } })) as unknown as typeof listReadoutHistoryAsAdmin;
    const response = await readoutHistoryListRoute(db, request(`/api?limit=7`, "GET", undefined, {
      cookie: sessionCookie
    }), raceId, list, environment);
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(db, { sessionToken, raceId, limit: 7 });
    const invalid = await readoutHistoryListRoute(db, request("/api?offset=2"), raceId, list, environment);
    expect(invalid.status).toBe(400);
  });

  it("binder detalj till readout och maskerar extra canaryfält", async () => {
    const detail = { formatVersion: 1 as const, raceId,
      readout: { id: readoutId, cardNumber: "123", readAt: "2026-08-31T12:00:00.000Z",
        startPunchedAt: null, finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: null, entry: null,
      history: { upperRevision: 0, items: [], nextCursor: null } };
    const getDetail = vi.fn(async () => ({ status: "ok" as const,
      response: { ...detail, rawPayload: "CANARY" } })) as unknown as typeof getReadoutHistoryAsAdmin;
    const response = await readoutHistoryDetailRoute(db, request("/detail", "GET", undefined, {
      cookie: sessionCookie
    }), raceId, readoutId, getDetail, environment);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"formatVersion":1,"error":"INTERNAL_ERROR"}');
    expect(getDetail).toHaveBeenCalledWith(db, { sessionToken, raceId, readoutId, limit: 50 });
  });

  it("mappar auth/not-found detaljfritt och sätter privata headers", async () => {
    for (const [status, http] of [["unauthorized", 401], ["forbidden", 403], ["not-found", 404]] as const) {
      const list = vi.fn(async () => ({ status })) as unknown as typeof listReadoutHistoryAsAdmin;
      const response = await readoutHistoryListRoute(db, request("/api", "GET", undefined, {
        cookie: sessionCookie
      }), raceId, list, environment);
      expect(response.status).toBe(http);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("logout kräver origin/CSRF/tom body och rensar bara historycookies", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => ({
      status: await input.readBodyIsEmpty?.() ? "logged-out" as const : "invalid-request" as const
    })) as unknown as typeof logoutPairingAdminSession;
    const response = await readoutResultHistoryAdminLogoutRoute(db, request("/session", "DELETE", undefined, {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; __Host-otid-readout-result-history-csrf=${csrf}`,
      "x-otid-csrf": csrf
    }), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({
      raceId, capability: "VIEW_READOUT_RESULT_HISTORY", sessionToken, csrfCookie: csrf, csrfHeader: csrf
    }));
    expect(response.headers.getSetCookie().join("\n")).toMatch(/readout-result-history-(session|csrf)=deleted/);
  });
});
