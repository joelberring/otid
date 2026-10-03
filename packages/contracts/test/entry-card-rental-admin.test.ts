import { describe, expect, it } from "vitest";
import { entryCardRentalChangeIdempotencyKeySchema, entryCardRentalChangeRequestSchema,
  entryCardRentalChangeResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedSnapshotVersion: 4,
  expectedAssignment: { id, cardNumber: "12345", isRental: false }, isRental: true };

describe("TASK073 hyrbricksstatuskontrakt", () => {
  it("binder exakt aktiv brickkoppling och kräver en verklig statusändring", () => {
    expect(entryCardRentalChangeRequestSchema.safeParse(request).success).toBe(true);
    expect(entryCardRentalChangeRequestSchema.safeParse({ ...request, isRental: false }).success).toBe(false);
    expect(entryCardRentalChangeRequestSchema.safeParse({ ...request,
      expectedAssignment: { id, cardNumber: "12345" } }).success).toBe(false);
    expect(entryCardRentalChangeRequestSchema.safeParse({ ...request, paid: true }).success).toBe(false);
    expect(entryCardRentalChangeIdempotencyKeySchema.safeParse(`entry-card-rental-change:${id}`).success).toBe(true);
  });

  it("kräver kvittens med oförändrad assignment och båda versionsökningarna", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      assignment: { id, cardNumber: "12345" }, previousIsRental: false, isRental: true,
      entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-18T10:00:00Z" };
    expect(entryCardRentalChangeResponseSchema.safeParse(response).success).toBe(true);
    expect(entryCardRentalChangeResponseSchema.safeParse({ ...response, isRental: false }).success).toBe(false);
    expect(entryCardRentalChangeResponseSchema.safeParse({ ...response, snapshotVersionAfter: 4 }).success).toBe(false);
  });
});
