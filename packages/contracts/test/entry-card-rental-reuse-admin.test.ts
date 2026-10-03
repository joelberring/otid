import { describe, expect, it } from "vitest";
import { entryCardRentalReuseIdempotencyKeySchema, entryCardRentalReuseRequestSchema,
  entryCardRentalReuseResponseSchema } from "../src";

const sourceEntryId = "10000000-0000-4000-8000-000000000001";
const targetEntryId = "10000000-0000-4000-8000-000000000002";
const assignmentId = "10000000-0000-4000-8000-000000000003";
const targetAssignmentId = "10000000-0000-4000-8000-000000000004";
const request = { formatVersion: 1, expectedSnapshotVersion: 4,
  source: { entryId: sourceEntryId, classId: sourceEntryId, entryVersion: 2,
    assignment: { id: assignmentId, cardNumber: "12345", isRental: true, rentalReturned: true } },
  expectedTargetClassId: targetEntryId, expectedTargetEntryVersion: 3 };

describe("TASK143 återanvändning av återlämnad hyrbricka", () => {
  it("binder en uttryckligt återlämnad hyrassignment, två deltagargrunder och snapshot", () => {
    expect(entryCardRentalReuseRequestSchema.safeParse(request).success).toBe(true);
    expect(entryCardRentalReuseRequestSchema.safeParse({ ...request,
      source: { ...request.source, assignment: { ...request.source.assignment, rentalReturned: false } } }).success).toBe(false);
    expect(entryCardRentalReuseRequestSchema.safeParse({ ...request,
      source: { ...request.source, assignment: { ...request.source.assignment, isRental: false } } }).success).toBe(false);
    expect(entryCardRentalReuseIdempotencyKeySchema.safeParse(`entry-card-rental-reuse:${assignmentId}`).success).toBe(true);
  });

  it("kräver kvittens med ny målassignment, samma nummer och två versionssteg", () => {
    const response = { formatVersion: 1, replayed: false, requestId: assignmentId, raceId: sourceEntryId,
      source: { entryId: sourceEntryId, classId: sourceEntryId, assignment: { id: assignmentId, cardNumber: "12345" } },
      target: { entryId: targetEntryId, classId: targetEntryId,
        assignment: { id: targetAssignmentId, cardNumber: "12345", isRental: true, rentalReturned: false } },
      sourceEntryVersionBefore: 2, sourceEntryVersionAfter: 3,
      targetEntryVersionBefore: 3, targetEntryVersionAfter: 4,
      snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-22T10:00:00Z" };
    expect(entryCardRentalReuseResponseSchema.safeParse(response).success).toBe(true);
    expect(entryCardRentalReuseResponseSchema.safeParse({ ...response,
      target: { ...response.target, assignment: { ...response.target.assignment, cardNumber: "54321" } } }).success).toBe(false);
    expect(entryCardRentalReuseResponseSchema.safeParse({ ...response, sourceEntryVersionAfter: 2 }).success).toBe(false);
  });
});
