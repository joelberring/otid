import { describe, expect, it } from "vitest";
import { entryClassAdminErrorResponseSchema, entryClassAdminListResponseSchema, entryClassChangeIdempotencyKeySchema, entryClassChangeRequestSchema, entryClassChangeResponseSchema } from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "b0000000-0000-4000-8000-000000000002";
const entryId = "c0000000-0000-4000-8000-000000000003";
const previousClassId = "d0000000-0000-4000-8000-000000000004";
const classId = "e0000000-0000-4000-8000-000000000005";

describe("TASK 005H klassadministrationskontrakt", () => {

  it("kräver exakt idempotensnyckel och strikt optimistic-intent", () => {
    expect(entryClassChangeIdempotencyKeySchema.parse(`entry-class-change:${requestId}`))
      .toBe(`entry-class-change:${requestId}`);
    expect(entryClassChangeIdempotencyKeySchema.safeParse(`entry-class-change:${requestId.toUpperCase()}`).success)
      .toBe(false);
    const body = { formatVersion: 1, classId, expectedEntryVersion: 3 };
    expect(entryClassChangeRequestSchema.parse(body)).toEqual(body);
    expect(entryClassChangeRequestSchema.safeParse({ ...body, expectedEntryVersion: 0 }).success).toBe(false);
    expect(entryClassChangeRequestSchema.safeParse({ ...body, requestId }).success).toBe(false);
  });

  it("validerar minimalt racebundet listunderlag utan okända fält", () => {
    const response = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      classes: [{ id: previousClassId, name: "H21" }, { id: classId, name: "D21" }],
      entries: [{ id: entryId, displayName: "Ada Lovelace", organisationName: "OK Exempel", classId: previousClassId, version: 3 }]
    };
    expect(entryClassAdminListResponseSchema.parse(response)).toEqual(response);
    expect(entryClassAdminListResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], cardNumber: "12345" }]
    }).success).toBe(false);
    expect(entryClassAdminListResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], classId: entryId }]
    }).success).toBe(false);
  });

  it("låser exact-replay-svaret och versionsökningarna", () => {
    const response = {
      formatVersion: 1,
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
      changedAt: "2026-08-31T17:00:00.000Z"
    };
    expect(entryClassChangeResponseSchema.parse(response)).toEqual(response);
    expect(entryClassChangeResponseSchema.parse({ ...response, replayed: true }).replayed).toBe(true);
    expect(entryClassChangeResponseSchema.safeParse({ ...response, entryVersionAfter: 5 }).success).toBe(false);
    expect(entryClassChangeResponseSchema.safeParse({ ...response, classId: previousClassId }).success).toBe(false);
    expect(entryClassChangeResponseSchema.safeParse({ ...response, status: "stored" }).success).toBe(false);
  });

  it("ger endast stabila detaljfria fel", () => {
    for (const error of [
      "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"
    ]) {
      expect(entryClassAdminErrorResponseSchema.parse({ formatVersion: 1, error }))
        .toEqual({ formatVersion: 1, error });
    }
    expect(entryClassAdminErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "CONFLICT",
      details: "Deltagaren ändrades samtidigt"
    }).success).toBe(false);
  });
});
