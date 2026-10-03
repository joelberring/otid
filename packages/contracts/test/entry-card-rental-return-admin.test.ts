import { describe, expect, it } from "vitest";
import { entryCardRentalReturnChangeIdempotencyKeySchema, entryCardRentalReturnChangeRequestSchema,
  entryCardRentalReturnChangeResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedSnapshotVersion: 4,
  expectedAssignment: { id, cardNumber: "12345", isRental: true, rentalReturned: false }, rentalReturned: true };

describe("TASK076 hyrbrickans återlämningskontrakt", () => {
  it("binder aktiv hyrassignment och kräver en verklig statusändring", () => {
    expect(entryCardRentalReturnChangeRequestSchema.safeParse(request).success).toBe(true);
    expect(entryCardRentalReturnChangeRequestSchema.safeParse({ ...request, rentalReturned: false }).success).toBe(false);
    expect(entryCardRentalReturnChangeRequestSchema.safeParse({ ...request,
      expectedAssignment: { ...request.expectedAssignment, isRental: false } }).success).toBe(false);
    expect(entryCardRentalReturnChangeRequestSchema.safeParse({ ...request, paid: true }).success).toBe(false);
    expect(entryCardRentalReturnChangeIdempotencyKeySchema.safeParse(`entry-card-rental-return-change:${id}`).success).toBe(true);
  });

  it("kräver kvittens med oförändrad assignment och båda versionsökningarna", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      assignment: { id, cardNumber: "12345" }, previousRentalReturned: false, rentalReturned: true,
      entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-18T10:00:00Z" };
    expect(entryCardRentalReturnChangeResponseSchema.safeParse(response).success).toBe(true);
    expect(entryCardRentalReturnChangeResponseSchema.safeParse({ ...response, rentalReturned: false }).success).toBe(false);
    expect(entryCardRentalReturnChangeResponseSchema.safeParse({ ...response, snapshotVersionAfter: 4 }).success).toBe(false);
  });
});
