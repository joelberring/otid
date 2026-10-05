import { describe, expect, it } from "vitest";
import {
  createOrganizerAttempt,
  parseOrganizerCreateResponse,
  parseOrganizerLoginRequest,
  readOrganizerCsrf
} from "./organizer-client";

const id = "11111111-1111-4111-8111-111111111111";
const csrf = "c".repeat(43);

describe("organizer browser client", () => {
  it("normalizes the email address but keeps the password in the request only", () => {
    expect(parseOrganizerLoginRequest("  Olle.Klubb@Exempel.SE ", "hemligt")).toEqual({
      formatVersion: 1,
      email: "olle.klubb@exempel.se",
      password: "hemligt"
    });
    expect(() => parseOrganizerLoginRequest("olle.klubb", "hemligt")).toThrow("giltig e-postadress");
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
});
