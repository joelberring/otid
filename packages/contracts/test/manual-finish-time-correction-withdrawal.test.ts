import { describe, expect, it } from "vitest";
import {
  manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema,
  manualFinishTimeCorrectionWithdrawalRequestSchema
} from "../src/manual-finish-time-correction-withdrawal";

const ids = { request: "10000000-0000-4000-8000-000000000001", entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003", course: "40000000-0000-4000-8000-000000000004",
  correction: "50000000-0000-4000-8000-000000000005", source: "60000000-0000-4000-8000-000000000006",
  corrected: "70000000-0000-4000-8000-000000000007" } as const;

describe("TASK094 finish correction withdrawal contract", () => {
  it("requires the exact adjacent source, correction and absolute head", () => {
    const request = { formatVersion: 1, requestId: ids.request, entryId: ids.entry, expectedEntryVersion: 1,
      expectedClassId: ids.class, expectedCourseVersionId: ids.course, expectedSnapshotVersion: 1,
      expectedBasisHash: "a".repeat(64), expectedCorrectionId: ids.correction,
      expectedSource: { id: ids.source, revision: 7 }, expectedCorrected: { id: ids.corrected, revision: 8 },
      expectedAbsoluteHead: { id: ids.corrected, revision: 8 }, acknowledgedWithdrawal: true };
    expect(manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse(request).success).toBe(true);
    expect(manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse({ ...request, expectedAbsoluteHead: { id: ids.source, revision: 7 } }).success).toBe(false);
    expect(manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema.safeParse(`manual-finish-time-correction-withdrawal:${ids.request}`).success).toBe(true);
  });
});
