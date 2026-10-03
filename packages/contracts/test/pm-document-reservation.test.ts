import { describe, expect, it } from "vitest";
import { pmDocumentReservationResponseSchema } from "../src";

const id = "aaaaaaaa-0000-4000-8000-000000000001";
const response = { formatVersion: 1, uploadId: id, requestId: id, raceId: id, replayed: false, reservedAt: "2026-09-07T10:00:00.000Z" };
describe("PM reservation response", () => {
  it("accepts a reservation acknowledgment and exact retry flag without implying stored bytes", () => {
    expect(pmDocumentReservationResponseSchema.parse(response)).toEqual(response);
    expect(pmDocumentReservationResponseSchema.parse({ ...response, replayed: true }).replayed).toBe(true);
  });
  it("rejects malformed identities/times and any storage or scan assertion", () => {
    for (const invalid of [
      { ...response, uploadId: "wrong" }, { ...response, raceId: id.toUpperCase() },
      { ...response, reservedAt: "yesterday" }, { ...response, replayed: "true" },
      { ...response, scanStatus: "READY" }, { ...response, versionId: "v1" }
    ]) expect(pmDocumentReservationResponseSchema.safeParse(invalid).success).toBe(false);
  });
});
