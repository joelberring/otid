import { describe, expect, it } from "vitest";
import { administratorEntryChangesResponseSchema } from "../src/administrator-entry-changes";

const id = "10000000-0000-4000-8000-000000000001";
const item = { kind: "START_TIME", requestId: id, changedAt: "2026-09-12T10:00:00Z", entryVersionAfter: 22,
  snapshotVersionAfter: 25, changes: [{ field: "START_TIME", before: null, after: "2026-09-12T12:30:00.125+02:00" }] };
const response = { formatVersion: 1, raceId: id, entryId: id, entryVersion: 22, snapshotVersion: 25,
  generatedAt: "2026-09-12T11:00:00Z", timeZone: "Europe/Stockholm", items: [item], nextBeforeVersion: null };

describe("TASK039 deltagarhistorikkontrakt", () => {
  it("accepterar avgränsad tidsändring och tom sida men avvisar okända fält/ogiltig zon", () => {
    expect(administratorEntryChangesResponseSchema.safeParse(response).success).toBe(true);
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items: [] }).success).toBe(true);
    for (const altered of [{ timeZone: "Unknown/Zone" }, { credential: "private" }, { nextBeforeVersion: 22 }]) {
      expect(administratorEntryChangesResponseSchema.safeParse({ ...response, ...altered }).success).toBe(false);
    }
  });
  it("avvisar dubbla/framtida versioner, fel fältuppsättning och trasiga tidsvärden", () => {
    for (const items of [[item, item], [{ ...item, entryVersionAfter: 23 }], [{ ...item, snapshotVersionAfter: 26 }],
      [{ ...item, changes: [{ field: "CARD", before: null, after: "123" }] }],
      [{ ...item, changes: [{ field: "START_TIME", before: null, after: "12:30" }] }]]) {
      expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items }).success).toBe(false);
    }
  });
  it("binder hyrstatus och återlämning till kanoniska booleska före-/eftervärden", () => {
    const rental = { ...item, kind: "RENTAL", changes: [{ field: "RENTAL", before: "false", after: "true" }] };
    const returned = { ...item, kind: "RENTAL_RETURN", requestId: "10000000-0000-4000-8000-000000000002",
      entryVersionAfter: 21, changes: [{ field: "RENTAL_RETURN", before: "false", after: "true" }] };
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items: [rental, returned] }).success).toBe(true);
    for (const changes of [[{ field: "RENTAL", before: "false", after: "false" }],
      [{ field: "RENTAL", before: "no", after: "true" }], [{ field: "RENTAL_RETURN", before: null, after: "true" }]]) {
      expect(administratorEntryChangesResponseSchema.safeParse({ ...response,
        items: [{ ...rental, changes }] }).success).toBe(false);
    }
  });
  it("binder återanvändning till riktning och brickförändring utan deltagaridentitet", () => {
    const source = { ...item, kind: "RENTAL_REUSE", changes: [
      { field: "RENTAL_REUSE", before: "RETURNED_RENTAL", after: "GIVEN_AWAY" },
      { field: "CARD", before: "123", after: null }
    ] };
    const target = { ...source, requestId: "10000000-0000-4000-8000-000000000002", entryVersionAfter: 21,
      changes: [{ field: "RENTAL_REUSE", before: "NO_ACTIVE_CARD", after: "RECEIVED_NOT_RETURNED" },
        { field: "CARD", before: null, after: "123" }] };
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items: [source, target] }).success).toBe(true);
    for (const changes of [[{ field: "RENTAL_REUSE", before: "RETURNED_RENTAL", after: "RECEIVED_NOT_RETURNED" },
      { field: "CARD", before: "123", after: null }], [{ field: "RENTAL_REUSE", before: "RETURNED_RENTAL", after: "GIVEN_AWAY" }]]) {
      expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items: [{ ...source, changes }] }).success).toBe(false);
    }
  });
  it("binder nästa exklusiva sidgräns till sista av20 fallande versioner", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ ...item, entryVersionAfter: 22 - index,
      requestId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items, nextBeforeVersion: 3 }).success).toBe(true);
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items, nextBeforeVersion: 4 }).success).toBe(false);
    expect(administratorEntryChangesResponseSchema.safeParse({ ...response, items: [...items].reverse(), nextBeforeVersion: null }).success).toBe(false);
  });
});
