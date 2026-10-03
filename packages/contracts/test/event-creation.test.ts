import { describe, expect, it } from "vitest";
import {
  EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX,
  EVENT_CREATION_SESSION_TOKEN_PREFIX,
  eventCreationAccessCredentialSchema,
  eventCreationErrorResponseSchema,
  eventCreationIdempotencyKeySchema,
  eventCreationLoginRequestSchema,
  eventCreationLoginResponseSchema,
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  eventCreationSessionTokenSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000002";
const eventId = "30000000-0000-4000-8000-000000000003";
const raceId = "40000000-0000-4000-8000-000000000004";
const secret = "A".repeat(43);

describe("TASK 005K eventskapandekontrakt", () => {
  it("separerar accesscredential, sessiontoken och capability", () => {
    const accessCredential = `${EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX}.${credentialId}.${secret}`;
    const sessionToken = `${EVENT_CREATION_SESSION_TOKEN_PREFIX}.${credentialId}.${secret}`;
    expect(eventCreationAccessCredentialSchema.parse(accessCredential)).toBe(accessCredential);
    expect(eventCreationSessionTokenSchema.parse(sessionToken)).toBe(sessionToken);
    expect(eventCreationAccessCredentialSchema.safeParse(sessionToken).success).toBe(false);
    expect(eventCreationSessionTokenSchema.safeParse(accessCredential).success).toBe(false);
    for (const prefix of [
      "otid_org_pair_v1",
      "otid_org_import_v1",
      "otid_org_entry_class_v1",
      "otid_org_result_recalc_v1",
      "otid_org_race_overview_v1"
    ]) {
      expect(eventCreationAccessCredentialSchema.safeParse(`${prefix}.${credentialId}.${secret}`).success).toBe(false);
    }
    expect(eventCreationLoginRequestSchema.parse({ formatVersion: 1, accessCredential }))
      .toEqual({ formatVersion: 1, accessCredential });
    expect(eventCreationLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential, raceId }).success).toBe(false);
    expect(eventCreationLoginResponseSchema.parse({
      formatVersion: 1,
      capability: "CREATE_EVENT",
      expiresAt: "2026-08-31T18:00:00.000Z"
    }).capability).toBe("CREATE_EVENT");
  });

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

  it("kräver canonical request-id och validerar exact-replay-svaret", () => {
    expect(eventCreationIdempotencyKeySchema.parse(`event-create:${requestId}`)).toBe(`event-create:${requestId}`);
    expect(eventCreationIdempotencyKeySchema.safeParse(`event-create:${requestId.toUpperCase()}`).success).toBe(false);
    expect(eventCreationIdempotencyKeySchema.safeParse(`event-creation:${requestId}`).success).toBe(false);
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
