import { expect, it } from "vitest";
import { entryReadoutHistoryResponseSchema } from "../src/entry-readout-history";
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const identity = { id: entryId, displayName: "Åsa Exempel" };
const item = { id: "30000000-0000-4000-8000-000000000001", readAt: "2026-09-09T10:00:00Z",
  cardNumber: "123456", entry: identity, firstServerAssessment: null };
const response = { formatVersion: 1, raceId, entry: identity,
  page: { formatVersion: 10, raceId, items: [item], nextCursor: null } };
it("represents a known entry with a bounded page or no linked readouts", () => {
  expect(entryReadoutHistoryResponseSchema.parse(response)).toEqual(response);
  expect(entryReadoutHistoryResponseSchema.parse({ ...response, page: { ...response.page, items: [] } }).entry).toEqual(identity);
});
it("rejects foreign race, missing identity and mixed entry projections", () => {
  for (const changed of [
    { ...response, page: { ...response.page, raceId: entryId } },
    ...[null, { ...identity, id: raceId }, { ...identity, displayName: "Annan" }].map(entry =>
      ({ ...response, page: { ...response.page, items: [{ ...item, entry }] } }))
  ]) expect(entryReadoutHistoryResponseSchema.safeParse(changed).success).toBe(false);
});
it("retains page bounds, duplicate rejection and strict data minimization", () => {
  expect(entryReadoutHistoryResponseSchema.safeParse({ ...response, page: { ...response.page, items: [item, item] } }).success).toBe(false);
  expect(entryReadoutHistoryResponseSchema.safeParse({ ...response, entry: { ...identity, organisation: "Private" } }).success).toBe(false);
  const items = Array.from({ length: 51 }, (_, index) => ({ ...item,
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  expect(entryReadoutHistoryResponseSchema.safeParse({ ...response, page: { ...response.page, items } }).success).toBe(false);
});
