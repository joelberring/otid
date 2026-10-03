import { describe, expect, it } from "vitest";
import {
  eventorConnectionsResponseSchema, eventorEventProjectionSchema, eventorExternalIdSchema, eventorProfileSchema,
  eventorImportIdempotencyKeySchema, eventorImportRequestSchema, eventorPreviewRequestSchema,
  eventorPreviewResponseSchema, eventorImportResponseSchema,
} from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const projection = {
  eventId: "00012-example", eventName: "Testtävling", startDate: "2026-09-05",
  races: [{ eventRaceId: "stage-one", raceName: "Etapp ett", raceDate: "2026-09-05" }],
};
const preview = {
  formatVersion: 1, environment: "testeventor-se", connectionId: id,
  fetchedAt: "2026-09-05T08:00:00Z", sourceHash: "a".repeat(64), projection,
};

describe("Eventor import boundary", () => {
  it("preserves opaque IDs and rejects unsafe or lossy identifiers", () => {
    for (const valid of ["00012", "opaque-id", "å/etapp"]) expect(eventorExternalIdSchema.parse(valid)).toBe(valid);
    for (const invalid of [12, "", ".", "..", " a", "a ", "a\n", "a\u0085", "\ud800", "a".repeat(257)]) {
      expect(eventorExternalIdSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("allows explicit zero/multiple race preview but not duplicate or invalid projection", () => {
    expect(eventorEventProjectionSchema.parse(projection)).toEqual(projection);
    expect(eventorEventProjectionSchema.safeParse({ ...projection, races: [] }).success).toBe(true);
    for (const invalid of [
      { ...projection, races: [...projection.races, ...projection.races] },
      { ...projection, startDate: "2026-02-30" }, { ...projection, startDate: "0000-01-01" },
      { ...projection, startClock: "24:00:00" }, { ...projection, email: "person@example.invalid" },
      { ...projection, eventName: "Bad\nName" },
    ]) expect(eventorEventProjectionSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires explicit race/timezone/hash and never accepts browser credentials or URLs", () => {
    const input = { formatVersion: 1, connectionId: id, eventId: projection.eventId };
    expect(eventorPreviewRequestSchema.parse(input)).toEqual(input);
    const commit = { ...input, eventRaceId: "stage-one", timeZone: "Europe/Stockholm", sourceHash: preview.sourceHash };
    expect(eventorImportRequestSchema.parse(commit)).toEqual(commit);
    expect(eventorImportRequestSchema.safeParse(input).success).toBe(false);
    for (const extra of [{ apiKey: "secret" }, { url: "https://example.invalid" }, { raceName: "edited" }]) {
      expect(eventorImportRequestSchema.safeParse({ ...commit, ...extra }).success).toBe(false);
    }
    expect(eventorImportRequestSchema.safeParse({ ...commit, timeZone: "Mars/Test" }).success).toBe(false);
    expect(eventorImportRequestSchema.safeParse({ ...commit, sourceHash: "A".repeat(64) }).success).toBe(false);
  });
  it("keeps preview, connection list and receipt minimal and strict", () => {
    expect(eventorPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(eventorPreviewResponseSchema.safeParse({ ...preview, rawXml: "private" }).success).toBe(false);
    const connection = { connectionId: id, label: "Test", environment: "testeventor-se" };
    expect(eventorConnectionsResponseSchema.safeParse({ formatVersion: 1, connections: [connection] }).success).toBe(true);
    expect(eventorConnectionsResponseSchema.safeParse({ formatVersion: 1, connections: [{ ...connection, ciphertext: "secret" }] }).success).toBe(false);
    const receipt = { formatVersion: 1, requestId: id, eventId: id, raceId: id, replayed: true,
      environment: "testeventor-se", externalEventId: projection.eventId, externalEventRaceId: "stage-one",
      sourceHash: preview.sourceHash, createdAt: preview.fetchedAt };
    expect(eventorImportResponseSchema.parse(receipt)).toEqual(receipt);
    expect(eventorImportResponseSchema.safeParse({ ...receipt, apiKey: "secret" }).success).toBe(false);
    expect(eventorProfileSchema.options).toEqual(["testeventor-se", "production-se"]);
    expect(eventorProfileSchema.safeParse("https://eventor.orientering.se").success).toBe(false);
    expect(eventorPreviewResponseSchema.parse({ ...preview, environment: "production-se" }).environment).toBe("production-se");
  });
  it("isolates idempotency keys and requires exact lowercase UUID", () => {
    expect(eventorImportIdempotencyKeySchema.parse(`eventor-import:${id}`)).toBe(`eventor-import:${id}`);
    for (const invalid of [`event-create:${id}`, `eventor-import:${id}\n`, `eventor-import:${id.replace("10000000", "AAAAAAAA")}`]) {
      expect(eventorImportIdempotencyKeySchema.safeParse(invalid).success).toBe(false);
    }
  });
});
