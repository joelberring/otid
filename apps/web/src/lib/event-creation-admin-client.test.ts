import { describe, expect, it } from "vitest";
import {
  createEventCreationAttempt,
  isDefinitiveEventCreationRejection,
  parseEventCreationResponse,
  readEventCreationCsrf
} from "./event-creation-admin-client";
import {
  EVENT_CREATION_LOOPBACK_COOKIE_NAMES,
  EVENT_CREATION_PRODUCTION_COOKIE_NAMES
} from "./event-creation-admin-cookies";

const requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const eventId = "10000000-0000-4000-8000-000000000002";
const raceId = "10000000-0000-4000-8000-000000000003";
const csrf = "c".repeat(43);

describe("event creation admin client", () => {
  it("normaliserar intent och genererar request-id exakt en gång", () => {
    let calls = 0;
    const attempt = createEventCreationAttempt({
      formatVersion: 1,
      eventName: "  Testtävling  ",
      raceName: " Individuellt ",
      raceDate: "2026-08-31",
      timeZone: " Europe/Stockholm "
    }, () => { calls += 1; return requestId; });
    expect(calls).toBe(1);
    expect(attempt).toEqual({
      requestId,
      request: {
        formatVersion: 1,
        eventName: "Testtävling",
        raceName: "Individuellt",
        raceDate: "2026-08-31",
        timeZone: "Europe/Stockholm"
      }
    });
  });

  it("avvisar okända fält, ogiltig tidszon och icke-kanoniskt uuid", () => {
    const base = {
      formatVersion: 1,
      eventName: "Testtävling",
      raceName: "Individuellt",
      raceDate: "2026-08-31",
      timeZone: "Europe/Stockholm"
    };
    expect(() => createEventCreationAttempt({ ...base, secret: "CANARY" }, () => requestId)).toThrow();
    expect(() => createEventCreationAttempt({ ...base, timeZone: "Stockholm" }, () => requestId)).toThrow();
    expect(() => createEventCreationAttempt(base, () => requestId.toUpperCase())).toThrow();
  });

  it("validerar strict response och binder den till samma request-id", () => {
    const attempt = createEventCreationAttempt({
      formatVersion: 1,
      eventName: "Testtävling",
      raceName: "Individuellt",
      raceDate: "2026-08-31",
      timeZone: "Europe/Stockholm"
    }, () => requestId);
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      eventId,
      raceId,
      createdAt: "2026-08-31T10:00:00.000Z"
    };
    expect(parseEventCreationResponse(response, attempt)).toEqual(response);
    expect(() => parseEventCreationResponse({ ...response, credential: "CANARY" }, attempt)).toThrow();
    expect(() => parseEventCreationResponse({ ...response, requestId: raceId }, attempt)).toThrow();
  });

  it("läser endast skapandeytans separata CSRF-cookie", () => {
    expect(readEventCreationCsrf(
      `${EVENT_CREATION_PRODUCTION_COOKIE_NAMES.csrf}=${csrf}; __Host-otid-race-overview-csrf=${"r".repeat(43)}`,
      new URL("https://otid.example/admin/events/new")
    )).toBe(csrf);
    expect(readEventCreationCsrf(
      `${EVENT_CREATION_LOOPBACK_COOKIE_NAMES.csrf}=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/events/new")
    )).toBe(csrf);
    expect(() => readEventCreationCsrf(
      `otid_import_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/events/new")
    )).toThrow();
  });

  it("klassar endast 400 och 409 som definitiva avslag", () => {
    expect(isDefinitiveEventCreationRejection(400)).toBe(true);
    expect(isDefinitiveEventCreationRejection(409)).toBe(true);
    for (const status of [401, 403, 500, 502, 503]) {
      expect(isDefinitiveEventCreationRejection(status)).toBe(false);
    }
  });
});
