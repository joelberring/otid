import { describe, expect, it, vi } from "vitest";
import type { authenticatePairingAdminSession, listSpeakerBoardAsAdmin, loginPairingAdmin, logoutPairingAdminSession } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { speakerBoardDataRoute, speakerBoardLoginRoute, speakerBoardLogoutRoute, speakerBoardSessionStatusRoute } from "./speaker-board-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const otherRaceId = "10000000-0000-4000-8000-000000000002";
const sessionToken = `otid_org_session_v1.${raceId}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const accessCredential = `otid_org_speaker_board_v1.${raceId}.${"a".repeat(43)}`;
const sessionCookie = `__Host-otid-speaker-board-session=${sessionToken}`;
const csrfCookie = `__Host-otid-speaker-board-csrf=${csrfToken}`;
const session = { formatVersion: 1 as const, raceId, capability: "VIEW_SPEAKER_BOARD" as const, expiresAt: "2026-09-06T23:00:00.000Z" };
const board = { formatVersion: 1 as const, raceId, eventName: "Syntetisk tävling", raceName: "Lång",
  raceSnapshotVersion: 3, timeZone: "Europe/Stockholm", generatedAt: "2026-09-06T22:00:00.000Z",
  selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION" as const, rows: [] };
function request(method = "GET", body?: string, headers: Record<string, string> = {}) {
  return new Request(`https://otid.example/api/admin/races/${raceId}/speaker-board`, {
    method, headers, ...(body === undefined ? {} : { body })
  });
}
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}
const loginRequest = (credential = accessCredential) => request("POST", JSON.stringify({ formatVersion: 1, accessCredential: credential }), {
  origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json"
});

describe("speaker HTTP boundary", () => {
  it("scopes login and returns only metadata with dedicated secure cookies", async () => {
    const login = vi.fn(async () => ({ status: "authenticated", response: session, sessionToken, csrfToken })) as unknown as typeof loginPairingAdmin;
    const response = await speakerBoardLoginRoute(db, loginRequest(), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(session);
    expect(login).toHaveBeenCalledWith(db, { formatVersion: 1, accessCredential }, { expectedRaceId: raceId, expectedCapability: "VIEW_SPEAKER_BOARD" });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-speaker-board-session=");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("__Host-otid-speaker-board-csrf=");
    for (const cookie of cookies) { expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Strict"); expect(cookie).not.toContain("Domain="); }
    privateResponse(response);
  });
  it("rejects wrong role, origin, oversized and malformed login before the service", async () => {
    const login = vi.fn() as unknown as typeof loginPairingAdmin;
    const headers = { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json" };
    for (const [req, code] of [
      [loginRequest(accessCredential.replace("speaker_board", "race_overview")), 401],
      [request("POST", "{}", { ...headers, origin: "https://evil.example" }), 403],
      [request("POST", " ".repeat(4097), headers), 400],
      [request("POST", "{", headers), 400],
      [request("POST", "{}", { ...headers, "content-type": "text/plain" }), 400]
    ] as const) {
      const response = await speakerBoardLoginRoute(db, req, raceId, login, environment);
      expect(response.status).toBe(code); privateResponse(response);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(login).not.toHaveBeenCalled();
  });
  it("passes only the speaker cookie to the protected data service", async () => {
    const read = vi.fn(async () => ({ status: "ok", response: board })) as unknown as typeof listSpeakerBoardAsAdmin;
    const response = await speakerBoardDataRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, read, environment);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(board); privateResponse(response);
    expect(read).toHaveBeenCalledWith(db, { raceId, sessionToken });
    for (const cookie of [`__Host-otid-race-overview-session=${sessionToken}`, `${sessionCookie}; ${sessionCookie}`]) {
      await speakerBoardDataRoute(db, request("GET", undefined, { cookie }), raceId, read, environment);
      expect(read).toHaveBeenLastCalledWith(db, { raceId, sessionToken: null });
    }
  });
  it("fails closed on wrong response scope, private extras and malformed rows", async () => {
    for (const payload of [{ ...board, raceId: otherRaceId }, { ...board, raw: "PRIVATE_CANARY" },
      { ...board, rows: [{ slot: 1, givenName: "PRIVATE_CANARY" }] }]) {
      const read = vi.fn(async () => ({ status: "ok", response: payload })) as unknown as typeof listSpeakerBoardAsAdmin;
      const response = await speakerBoardDataRoute(db, request(), raceId, read, environment);
      expect(response.status).toBe(500); privateResponse(response);
      expect(await response.text()).toBe('{"formatVersion":1,"error":"INTERNAL_ERROR"}');
    }
  });
  it("returns stable private error responses without leaking exceptions", async () => {
    for (const [status, code] of [["unauthorized", 401], ["forbidden", 403], ["not-found", 404]] as const) {
      const read = vi.fn(async () => ({ status })) as unknown as typeof listSpeakerBoardAsAdmin;
      const response = await speakerBoardDataRoute(db, request(), raceId, read, environment);
      expect(response.status).toBe(code); privateResponse(response);
    }
    const read = vi.fn(async () => { throw new Error("PRIVATE_CANARY"); }) as unknown as typeof listSpeakerBoardAsAdmin;
    const response = await speakerBoardDataRoute(db, request(), raceId, read, environment);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("PRIVATE_CANARY");
  });
  it("does not set a session from a mismatched login result", async () => {
    const login = vi.fn(async () => ({ status: "authenticated", response: { ...session, raceId: otherRaceId }, sessionToken, csrfToken })) as unknown as typeof loginPairingAdmin;
    const response = await speakerBoardLoginRoute(db, loginRequest(), raceId, login, environment);
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]);
  });
  it("scopes metadata-only session status and rejects mismatched principal", async () => {
    for (const principalRaceId of [raceId, otherRaceId]) {
      const authenticate = vi.fn(async () => ({ status: "authenticated", principal: { ...session, raceId: principalRaceId,
        accessCredentialId: raceId, sessionId: raceId } })) as unknown as typeof authenticatePairingAdminSession;
      const response = await speakerBoardSessionStatusRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, authenticate, environment);
      expect(response.status).toBe(principalRaceId === raceId ? 200 : 500); privateResponse(response);
      expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "VIEW_SPEAKER_BOARD", sessionToken }));
      if (principalRaceId === raceId) expect(await response.json()).toEqual(session);
    }
  });
  it("forwards logout CSRF proof and validates empty body before clearing only speaker cookies", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => ({
      status: await input.readBodyIsEmpty?.() ? "logged-out" : "invalid-request"
    })) as unknown as typeof logoutPairingAdminSession;
    const headers = { origin: environment.O_TID_PUBLIC_ORIGIN, cookie: `${sessionCookie}; ${csrfCookie}`, "x-otid-csrf": csrfToken };
    const response = await speakerBoardLogoutRoute(db, request("DELETE", undefined, headers), raceId, logout, environment);
    expect(response.status).toBe(204); privateResponse(response);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "VIEW_SPEAKER_BOARD", sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken }));
    expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const cookie of response.headers.getSetCookie()) { expect(cookie).toContain("__Host-otid-speaker-board-"); expect(cookie).toContain("Max-Age=0"); }
    const invalid = await speakerBoardLogoutRoute(db, request("DELETE", "{}", { ...headers, "content-type": "application/json" }), raceId, logout, environment);
    expect(invalid.status).toBe(400); expect(invalid.headers.getSetCookie()).toEqual([]);
  });
  it("rejects unsafe configuration before accessing private data", async () => {
    const read = vi.fn() as unknown as typeof listSpeakerBoardAsAdmin;
    const response = await speakerBoardDataRoute(db, request(), raceId, read, { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" });
    expect(response.status).toBe(500); privateResponse(response); expect(read).not.toHaveBeenCalled();
  });
});
