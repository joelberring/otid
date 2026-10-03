import { describe, expect, it } from "vitest";
import { entryPaymentStatusChangeIdempotencyKeySchema, entryPaymentStatusChangeRequestSchema,
  entryPaymentStatusChangeResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id,
  expectedPaymentStatus: "UNMARKED" as const, expectedPaymentStatusVersion: 1,
  paymentStatus: "PAID" as const };

describe("TASK142 privat betalstatuskontrakt", () => {
  it("kräver en verklig, versionsbunden statusändring utan betaluppgifter", () => {
    expect(entryPaymentStatusChangeRequestSchema.safeParse(request).success).toBe(true);
    expect(entryPaymentStatusChangeRequestSchema.safeParse({ ...request, paymentStatus: "UNMARKED" }).success).toBe(false);
    expect(entryPaymentStatusChangeRequestSchema.safeParse({ ...request, amount: 100 }).success).toBe(false);
    expect(entryPaymentStatusChangeIdempotencyKeySchema.safeParse(`entry-payment-status-change:${id}`).success).toBe(true);
    expect(entryPaymentStatusChangeIdempotencyKeySchema.safeParse("entry-payment-status-change:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").success).toBe(true);
    expect(entryPaymentStatusChangeIdempotencyKeySchema.safeParse("entry-payment-status-change:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA").success).toBe(false);
  });

  it("binder kvittensen till samma deltagar- och separata betalstatusversion", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      previousPaymentStatus: "UNMARKED" as const, paymentStatus: "PAID" as const,
      entryVersionAtChange: 2, paymentStatusVersionBefore: 1, paymentStatusVersionAfter: 2,
      changedAt: "2026-09-22T10:00:00Z" };
    expect(entryPaymentStatusChangeResponseSchema.safeParse(response).success).toBe(true);
    expect(entryPaymentStatusChangeResponseSchema.safeParse({ ...response, paymentStatusVersionAfter: 1 }).success).toBe(false);
    expect(entryPaymentStatusChangeResponseSchema.safeParse({ ...response, previousPaymentStatus: "PAID" }).success).toBe(false);
  });
});
