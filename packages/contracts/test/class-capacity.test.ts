import { expect, it } from "vitest";
import { classCapacityRequestSchema, classCapacityResponseSchema } from "../src";
it("TASK029 kapacitet skiljer obegränsad från stängd och avvisar no-op", () => {
  const value = { formatVersion: 1, expectedCapacityVersion: 1, expectedMaxEntries: null, maxEntries: 0 };
  expect(classCapacityRequestSchema.safeParse(value).success).toBe(true);
  for (const maxEntries of [null, -1, 10_001, 1.5]) expect(classCapacityRequestSchema.safeParse({ ...value, maxEntries }).success).toBe(false);
});
it("TASK029 kvittens kräver versionssteg och tillräcklig kapacitet", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const value = { formatVersion: 1, replayed: false, requestId: id, raceId: id, classId: id,
    previousMaxEntries: null, maxEntries: 5, versionBefore: 1, versionAfter: 2, entryCount: 5, changedAt: "2026-09-12T12:00:00Z" };
  expect(classCapacityResponseSchema.safeParse(value).success).toBe(true);
  expect(classCapacityResponseSchema.safeParse({ ...value, entryCount: 6 }).success).toBe(false);
  expect(classCapacityResponseSchema.safeParse({ ...value, versionAfter: 3 }).success).toBe(false);
});
