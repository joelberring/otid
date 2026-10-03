import { describe, expect, it } from "vitest";
import {
  createEntryClassChangeAttempt,
  entryClassChangeBody,
  isDefinitiveEntryClassRejection,
  parseEntryClassAdminData,
  parseEntryClassChangeResponse
} from "./entry-class-admin-client";
import {
  ENTRY_CLASS_ADMIN_LOOPBACK_COOKIE_NAMES,
  ENTRY_CLASS_ADMIN_PRODUCTION_COOKIE_NAMES,
  entryClassAdminCookieNamesForUrl,
  readEntryClassAdminCsrfCookie
} from "./entry-class-admin-cookies";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const previousClassId = "10000000-0000-4000-8000-000000000003";
const classId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";

describe("TASK 005H klassadmin-klient", () => {
  it("skapar och fryser canonical request-id med exakt optimistic intent", () => {
    const attempt = createEntryClassChangeAttempt({
      entryId,
      displayName: "Ada Löpare",
      previousClassId,
      classId,
      expectedEntryVersion: 3
    }, { randomUUID: () => requestId } as unknown as Crypto);
    expect(attempt).toEqual({ requestId, entryId, displayName: "Ada Löpare", previousClassId, classId, expectedEntryVersion: 3 });
    expect(entryClassChangeBody(attempt)).toEqual({ formatVersion: 1, classId, expectedEntryVersion: 3 });
  });

  it("avvisar no-op och ogiltigt request-id före nätverk", () => {
    const base = { entryId, displayName: "Ada", previousClassId, classId: previousClassId, expectedEntryVersion: 1 };
    expect(() => createEntryClassChangeAttempt(base, { randomUUID: () => requestId } as unknown as Crypto)).toThrow("ogiltigt");
    expect(() => createEntryClassChangeAttempt({ ...base, classId }, { randomUUID: () => "FEL" } as unknown as Crypto)).toThrow("ogiltigt");
  });

  it("runtimevaliderar minimalt dataunderlag och racebindning", () => {
    const value = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      classes: [{ id: previousClassId, name: "H21" }, { id: classId, name: "D21" }],
      entries: [{ id: entryId, displayName: "Ada Löpare", organisationName: null, classId: previousClassId, version: 3 }]
    };
    expect(parseEntryClassAdminData(value, raceId)).toEqual(value);
    expect(() => parseEntryClassAdminData({ ...value, raceId: entryId }, raceId)).toThrow("ogiltigt klassadminsvar");
  });

  it("godtar endast svar bundet till samma frysta försök och versionsökning", () => {
    const attempt = { requestId, entryId, displayName: "Ada", previousClassId, classId, expectedEntryVersion: 3 };
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      raceId,
      entryId,
      previousClassId,
      classId,
      entryVersionBefore: 3,
      entryVersionAfter: 4,
      snapshotVersionBefore: 7,
      snapshotVersionAfter: 8,
      changedAt: "2026-08-31T12:00:00.000Z"
    };
    expect(parseEntryClassChangeResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseEntryClassChangeResponse({ ...response, classId: previousClassId }, attempt, raceId)).toThrow("ogiltigt klassadminsvar");
  });

  it("rensar endast definitiva negativa svar och behåller auth-/nät-/serverosäkerhet", () => {
    expect([400, 404, 409].every(isDefinitiveEntryClassRejection)).toBe(true);
    expect([401, 403, 500, 502, 503].some(isDefinitiveEntryClassRejection)).toBe(false);
  });

  it("väljer separata cookies och avvisar dubbla CSRF-värden", () => {
    expect(entryClassAdminCookieNamesForUrl(new URL("http://localhost:3000"))).toBe(ENTRY_CLASS_ADMIN_LOOPBACK_COOKIE_NAMES);
    expect(entryClassAdminCookieNamesForUrl(new URL("https://otid.example"))).toBe(ENTRY_CLASS_ADMIN_PRODUCTION_COOKIE_NAMES);
    const csrf = "c".repeat(43);
    expect(readEntryClassAdminCsrfCookie(`otid_entry_class_admin_csrf=${csrf}`, new URL("http://localhost:3000"))).toBe(csrf);
    expect(readEntryClassAdminCsrfCookie(`otid_entry_class_admin_csrf=${csrf}; otid_entry_class_admin_csrf=${csrf}`, new URL("http://localhost:3000"))).toBeUndefined();
  });
});
