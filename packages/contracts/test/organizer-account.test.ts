import { describe, expect, it } from "vitest";
import {
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerAccountSessionStatusSchema,
  organizerEventCreateIdempotencyKeySchema,
  organizerEventCreateRequestSchema,
  organizerEventCreateResponseSchema,
  organizerMyEventsResponseSchema,
  organizerRaceEnterResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const eventId = "abcdef12-3456-4123-8abc-123456789abc";
const raceId = "40000000-0000-4000-8000-000000000004";
const expiresAt = "2026-09-23T12:00:00.000Z";

describe("TASK150 arrangörskontokontrakt", () => {
  it("validerar kanoniskt konto-login och strikt svar/sessionstatus", () => {
    const login = { formatVersion: 1 as const, loginName: "ol.runner-1", password: "generated-secret" };
    expect(organizerAccountLoginRequestSchema.parse(login)).toEqual(login);
    for (const invalidName of ["OL.runner", "ab", " leading", "two words", "åsa.runner"]) {
      expect(organizerAccountLoginRequestSchema.safeParse({ ...login, loginName: invalidName }).success).toBe(false);
    }
    expect(organizerAccountLoginRequestSchema.safeParse({ ...login, surprise: true }).success).toBe(false);
    expect(organizerAccountLoginRequestSchema.safeParse({ ...login, password: "" }).success).toBe(false);

    const response = { formatVersion: 1 as const, accountId: eventId, displayName: "Ol Runner", expiresAt };
    expect(organizerAccountLoginResponseSchema.parse(response)).toEqual(response);
    expect(organizerAccountSessionStatusSchema.parse(response)).toEqual(response);
    expect(organizerAccountLoginResponseSchema.safeParse({ ...response, accountId: eventId.toUpperCase() }).success).toBe(false);
    expect(organizerAccountLoginResponseSchema.safeParse({ ...response, expiresAt: "tomorrow" }).success).toBe(false);
  });

  it("avgränsar kontoskapandets idempotensnyckel och återanvänder eventkontrakten", () => {
    expect(organizerEventCreateIdempotencyKeySchema.parse(`organizer-event-create:${requestId}`))
      .toBe(`organizer-event-create:${requestId}`);
    expect(organizerEventCreateIdempotencyKeySchema.safeParse(`organizer-event-create:${requestId.toUpperCase()}`).success).toBe(false);
    expect(organizerEventCreateIdempotencyKeySchema.safeParse(`event-create:${requestId}`).success).toBe(false);

    const request = {
      formatVersion: 1 as const,
      eventName: "Hösthelgen",
      raceName: "Medeldistans",
      raceDate: "2026-10-04",
      timeZone: "Europe/Stockholm"
    };
    // ADR-0170: kontots skapande lägger till tävlingstypen; saknas den blir det Tävling.
    expect(organizerEventCreateRequestSchema.parse(request)).toEqual({ ...request, raceType: "STANDARD" });
    expect(organizerEventCreateRequestSchema.parse({ ...request, raceType: "TRAINING" }).raceType).toBe("TRAINING");
    expect(organizerEventCreateRequestSchema.safeParse({ ...request, raceType: "OKÄND" }).success).toBe(false);
    expect(eventCreationRequestSchema.parse(request)).toEqual(request);
    expect(organizerEventCreateRequestSchema.safeParse({ ...request, ownerId: eventId }).success).toBe(false);

    const response = {
      formatVersion: 1 as const, replayed: false, requestId, eventId, raceId,
      createdAt: "2026-09-23T10:00:00.000Z"
    };
    expect(organizerEventCreateResponseSchema).toBe(eventCreationResponseSchema);
    expect(organizerEventCreateResponseSchema.parse(response)).toEqual(response);
    expect(organizerEventCreateResponseSchema.safeParse({ ...response, credential: "secret" }).success).toBe(false);
  });

  it("validerar minimal eventlista med races och race-enter-svar", () => {
    const response = {
      formatVersion: 1 as const,
      events: [{
        eventId,
        eventName: "Hösthelgen",
        role: "OWNER" as const,
        startsOn: "2026-10-04",
        timeZone: "Europe/Stockholm",
        races: [{ raceId, raceName: "Medeldistans", raceDate: "2026-10-04", raceType: "STANDARD" as const }]
      }]
    };
    const event = response.events[0]!;
    const race = event.races[0]!;
    expect(organizerMyEventsResponseSchema.parse(response)).toEqual(response);
    expect(organizerMyEventsResponseSchema.safeParse({ ...response, accountId: eventId }).success).toBe(false);
    expect(organizerMyEventsResponseSchema.safeParse({
      ...response,
      events: [{ ...event, races: [{ ...race, internalEntryCount: 12 }] }]
    }).success).toBe(false);
    expect(organizerMyEventsResponseSchema.safeParse({
      ...response,
      events: [{ ...event, eventId: eventId.toUpperCase() }]
    }).success).toBe(false);

    const enter = { formatVersion: 1 as const, raceId, expiresAt };
    expect(organizerRaceEnterResponseSchema.parse(enter)).toEqual(enter);
    expect(organizerRaceEnterResponseSchema.safeParse({ ...enter, accessToken: "secret" }).success).toBe(false);
    expect(organizerRaceEnterResponseSchema.safeParse({ ...enter, expiresAt: "tomorrow" }).success).toBe(false);
  });
});
