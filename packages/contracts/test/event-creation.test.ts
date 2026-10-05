import { describe, expect, it } from "vitest";
import { eventCreationErrorResponseSchema, eventCreationRequestSchema, eventCreationResponseSchema } from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000003";
const raceId = "40000000-0000-4000-8000-000000000004";

describe("skapa tävling-kontrakt", () => {
  it("normaliserar och validerar hela det strikta skapandeintentet", () => {
    const request = {
      formatVersion: 1 as const,
      eventName: "  Hösthelgen  ",
      raceName: " Medeldistans ",
      raceDate: "2026-08-31",
      timeZone: " Europe/Stockholm "
    };
    expect(eventCreationRequestSchema.parse(request)).toEqual({
      formatVersion: 1,
      eventName: "Hösthelgen",
      raceName: "Medeldistans",
      raceDate: "2026-08-31",
      timeZone: "Europe/Stockholm"
    });
    expect(eventCreationRequestSchema.safeParse({ ...request, name: "Äldre wirefält" }).success).toBe(false);
    expect(eventCreationRequestSchema.safeParse({ ...request, eventName: "x" }).success).toBe(false);
    expect(eventCreationRequestSchema.safeParse({ ...request, raceDate: "2026-02-30" }).success).toBe(false);
    expect(eventCreationRequestSchema.safeParse({ ...request, timeZone: "Mars/Olympus_Mons" }).success).toBe(false);
  });

  it("validerar exact-replay-svaret", () => {
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      eventId,
      raceId,
      createdAt: "2026-08-31T10:00:00.000Z"
    };
    expect(eventCreationResponseSchema.parse(response)).toEqual(response);
    expect(eventCreationResponseSchema.parse({ ...response, replayed: true }).replayed).toBe(true);
    expect(eventCreationResponseSchema.safeParse({ ...response, accessCredential: "hemligt" }).success).toBe(false);
  });

  it("ger endast stabila detaljfria fel", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT", "INTERNAL_ERROR"]) {
      expect(eventCreationErrorResponseSchema.parse({ formatVersion: 1, error }))
        .toEqual({ formatVersion: 1, error });
    }
    expect(eventCreationErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "CONFLICT",
      details: "Request-id återanvändes"
    }).success).toBe(false);
  });
});
