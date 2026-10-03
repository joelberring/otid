import { describe, expect, it } from "vitest";
import { fixedStartTimeSchema, entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema, entryStartTimeAdminListResponseSchema } from "../src";

const id = "aabbccdd-1234-4567-8901-123456789012";
describe("TASK 006O starttid", () => {
  it("kräver giltig tävlingszon även för tom lista", () => {
    const list = { formatVersion: 1, raceId: id, snapshotVersion: 1, entries: [] };
    expect(entryStartTimeAdminListResponseSchema.safeParse(list).success).toBe(false);
    expect(entryStartTimeAdminListResponseSchema.safeParse({ ...list, timeZone: "Invalid/Zone" }).success).toBe(false);
    expect(entryStartTimeAdminListResponseSchema.parse({ ...list, timeZone: "Europe/Stockholm" }).timeZone).toBe("Europe/Stockholm");
  });
  it("normaliserar offset och dygnsgräns till exakt UTC med millisekunder", () => {
    expect(fixedStartTimeSchema.parse("2026-09-04T00:01:02.123+02:00")).toBe("2026-09-03T22:01:02.123Z");
    expect(fixedStartTimeSchema.parse("2026-09-04T00:00:00-14:00")).toBe("2026-09-04T14:00:00.000Z");
    for (const value of ["2026-02-30T10:00:00Z", "2026-09-04T10:00:00", "2026-09-04T10:00Z",
      "2026-09-04T10:00:00.1234Z", "2026-09-04T10:00:00+14:01", "2026-09-04T10:00:00+15:00"]) {
      expect(fixedStartTimeSchema.safeParse(value).success, value).toBe(false);
    }
  });
  it("binder tidigare nullable tid men tillåter inte radering eller extra skrivfält", () => {
    const request = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: id,
      expectedSnapshotVersion: 3, expectedFixedStartTime: null, fixedStartTime: "2026-09-04T10:00:00Z" };
    expect(entryStartTimeChangeRequestSchema.safeParse(request).success).toBe(true);
    for (const changed of [{ ...request, fixedStartTime: null }, { ...request, startRule: "PUNCH" },
      { ...request, expectedEntryVersion: 2_147_483_648 }]) {
      expect(entryStartTimeChangeRequestSchema.safeParse(changed).success).toBe(false);
    }
  });
  it("kvitterar endast en verklig ändring med exakt en versionsökning", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      previousFixedStartTime: "2026-09-04T10:00:00Z", fixedStartTime: "2026-09-04T10:01:00Z",
      entryVersionBefore: 1, entryVersionAfter: 2, snapshotVersionBefore: 3, snapshotVersionAfter: 4,
      changedAt: "2026-09-04T12:00:00Z" };
    expect(entryStartTimeChangeResponseSchema.safeParse(response).success).toBe(true);
    expect(entryStartTimeChangeResponseSchema.safeParse({ ...response, snapshotVersionAfter: 5 }).success).toBe(false);
    expect(entryStartTimeChangeResponseSchema.safeParse({ ...response, fixedStartTime: response.previousFixedStartTime }).success).toBe(false);
  });
});
