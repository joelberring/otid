import { describe, expect, it } from "vitest";
import { entryCardChangeRequestSchema, entryCardChangeResponseSchema, entryCardAdminListResponseSchema } from "../src";
const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: id, expectedSnapshotVersion: 3,
  expectedAssignment: { id, cardNumber: "12345" }, cardNumber: "54321" };
describe("TASK 006P brickbyteskontrakt", () => {
  it("binder exakt tidigare assignment, kräver kanoniskt nytt nummer och avvisar extra mutationsfält", () => {
    expect(entryCardChangeRequestSchema.parse({ ...request, cardNumber: " 54321 " }).cardNumber).toBe("54321");
    expect(entryCardChangeRequestSchema.safeParse({ ...request, expectedAssignment: null }).success).toBe(true);
    for (const cardNumber of ["", "0", "0123", "-3", "1e3", "12 3", "a", "1".repeat(33)]) {
      expect(entryCardChangeRequestSchema.safeParse({ ...request, cardNumber }).success).toBe(false);
    }
    expect(entryCardChangeRequestSchema.safeParse({ ...request, expectedAssignment: { id } }).success).toBe(false);
    expect(entryCardChangeRequestSchema.safeParse({ ...request, active: true }).success).toBe(false);
  });
  it("tillåter inte ett motsägande listurval eller kvittens utan verkligt byte och versionsökning", () => {
    expect(entryCardAdminListResponseSchema.safeParse({ formatVersion: 1, raceId: id, snapshotVersion: 1,
      entries: [{ id, classId: id, displayName: "Test", className: "H21", version: 1,
        activeAssignment: request.expectedAssignment, multipleActiveAssignments: true }] }).success).toBe(false);
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      previousAssignment: request.expectedAssignment,
      activeAssignment: { id: "10000000-0000-4000-8000-000000000002", cardNumber: "54321" },
      entryVersionBefore: 1, entryVersionAfter: 2, snapshotVersionBefore: 3, snapshotVersionAfter: 4,
      changedAt: "2026-09-04T10:00:00Z" };
    expect(entryCardChangeResponseSchema.safeParse(response).success).toBe(true);
    expect(entryCardChangeResponseSchema.safeParse({ ...response, snapshotVersionAfter: 3 }).success).toBe(false);
    expect(entryCardChangeResponseSchema.safeParse({ ...response, activeAssignment: response.previousAssignment }).success).toBe(false);
  });
});
