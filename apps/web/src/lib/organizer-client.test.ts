import { describe, expect, it, vi } from "vitest";
import {
  createOrganizerAttempt,
  parseOrganizerAdminGrantResponse,
  parseOrganizerAdminList,
  parseOrganizerAdminRevokeResponse,
  restoreOrganizerAdminAttempt,
  saveOrganizerAdminAttempt,
  clearOrganizerAdminAttempt,
  parseOrganizerCreateResponse,
  parseOrganizerLoginRequest,
  readOrganizerCsrf
} from "./organizer-client";

const id = "11111111-1111-4111-8111-111111111111";
const csrf = "c".repeat(43);
const eventId = "22222222-2222-4222-8222-222222222222";

describe("organizer browser client", () => {
  it("normalizes the login name but keeps the password in the request only", () => {
    expect(parseOrganizerLoginRequest("  OLLE.KLUBB ", "hemligt")).toEqual({
      formatVersion: 1,
      loginName: "olle.klubb",
      password: "hemligt"
    });
  });

  it("uses only the organizer CSRF cookie for loopback and production", () => {
    expect(readOrganizerCsrf(`otid_organizer_csrf=${csrf}; other=${csrf}`, new URL("http://127.0.0.1:3000/organizer"))).toBe(csrf);
    expect(readOrganizerCsrf(`__Host-otid-organizer-csrf=${csrf}; otid_organizer_csrf=${"x".repeat(43)}`, new URL("https://otid.example/organizer"))).toBe(csrf);
    expect(() => readOrganizerCsrf(`__Host-otid-organizer-csrf=${csrf}; __Host-otid-organizer-csrf=${csrf}`, new URL("https://otid.example/organizer"))).toThrow();
  });

  it("validates and binds the create confirmation to the retained request id", () => {
    const attempt = createOrganizerAttempt({
      formatVersion: 1,
      eventName: "Klubbtävling",
      raceName: "Lång",
      raceDate: "2026-10-03",
      timeZone: "Europe/Stockholm"
    }, id, () => id);
    expect(attempt.accountId).toBe(id);
    expect(parseOrganizerCreateResponse({
      formatVersion: 1,
      replayed: true,
      requestId: id,
      eventId: id,
      raceId: id,
      createdAt: "2026-09-23T09:00:00Z"
    }, attempt).raceId).toBe(id);
    expect(() => parseOrganizerCreateResponse({
      formatVersion: 1,
      replayed: true,
      requestId: "22222222-2222-4222-8222-222222222222",
      eventId: id,
      raceId: id,
      createdAt: "2026-09-23T09:00:00Z"
    }, attempt)).toThrow();
  });

  it("validates administrator history and binds grant confirmation to the retained intent", () => {
    const attempt = { accountId: id, action: "grant" as const, eventId, requestId: id,
      request: { formatVersion: 1, requestId: id, eventId, loginName: "coadmin", role: "ADMIN" } };
    expect(parseOrganizerAdminList({ formatVersion: 1, eventId, grants: [] }).eventId).toBe(eventId);
    expect(parseOrganizerAdminGrantResponse({ formatVersion: 1, replayed: true, requestId: id, eventId,
      grantId: id, accountId: eventId, loginName: "coadmin", displayName: "Medarrangör", role: "ADMIN",
      grantedAt: "2026-09-23T09:00:00Z" }, attempt).replayed).toBe(true);
    expect(() => parseOrganizerAdminGrantResponse({ formatVersion: 1, replayed: true, requestId: id, eventId,
      grantId: id, accountId: eventId, loginName: "someoneelse", displayName: "Medarrangör", role: "ADMIN",
      grantedAt: "2026-09-23T09:00:00Z" }, attempt)).toThrow();
    expect(() => parseOrganizerAdminGrantResponse({ formatVersion: 1, replayed: true,
      requestId: "33333333-3333-4333-8333-333333333333", eventId, grantId: id, accountId: eventId,
      loginName: "coadmin", displayName: "Medarrangör", role: "ADMIN", grantedAt: "2026-09-23T09:00:00Z" }, attempt)).toThrow();
    const revokeAttempt = { accountId: id, action: "revoke" as const, eventId, requestId: id,
      request: { formatVersion: 1, requestId: id, eventId, grantId: eventId } };
    const revoked = { formatVersion: 1, replayed: false, requestId: id, eventId, grantId: eventId,
      revokedAt: "2026-09-23T09:00:00Z" };
    expect(parseOrganizerAdminRevokeResponse(revoked, revokeAttempt).grantId).toBe(eventId);
    expect(() => parseOrganizerAdminRevokeResponse({ ...revoked, grantId: id }, revokeAttempt)).toThrow();
  });

  it("retains and restores the pending exact administrator request in session storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: {
      setItem: (key: string, value: string) => values.set(key, value),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key)
    } });
    const attempt = { accountId: id, action: "grant" as const, eventId, requestId: id,
      request: { formatVersion: 1, requestId: id, eventId, loginName: "coadmin", role: "ADMIN" } };
    saveOrganizerAdminAttempt(attempt);
    expect(restoreOrganizerAdminAttempt(id, eventId)).toEqual(attempt);
    clearOrganizerAdminAttempt(id, eventId);
    expect(restoreOrganizerAdminAttempt(id, eventId)).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
