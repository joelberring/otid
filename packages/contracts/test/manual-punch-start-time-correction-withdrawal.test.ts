import { describe, expect, it } from "vitest";
import {
  manualPunchStartTimeCorrectionWithdrawalCandidateSchema,
  manualPunchStartTimeCorrectionWithdrawalIdempotencyKeySchema,
  manualPunchStartTimeCorrectionWithdrawalRequestSchema,
  manualPunchStartTimeCorrectionWithdrawalResponseSchema
} from "../src";

const id = "aabbccdd-1234-4567-8901-123456789012";
const other = "aabbccdd-1234-4567-8901-123456789013";
const hash = "a".repeat(64);
const source = { id, revision: 4, startTime: "2026-09-20T08:00:00.000Z" } as const;
const corrected = { id: other, revision: 5, startTime: "2026-09-20T07:59:00.000Z" } as const;
const request = { formatVersion: 1, requestId: id, entryId: other, expectedEntryVersion: 3, expectedClassId: id,
  expectedCourseVersionId: id, expectedSnapshotVersion: 7, expectedBasisHash: hash, expectedCorrectionId: id,
  expectedSource: { id: source.id, revision: source.revision }, expectedCorrected: { id: corrected.id, revision: corrected.revision },
  expectedAbsoluteHead: { id: corrected.id, revision: corrected.revision }, acknowledgedWithdrawal: true } as const;

describe("TASK105 återtagandekontrakt för PUNCH-start", () => {
  it("binder det aktuella direkta korrigeringshuvudet", () => {
    const candidate = { formatVersion: 1, raceId: id, entryId: other, entryName: "Ada Test", entryVersion: 3,
      classId: id, className: "Öppen", courseVersionId: id, snapshotVersion: 7, basisHash: hash, correctionId: id,
      source, corrected, absoluteHead: { id: corrected.id, revision: corrected.revision } };
    expect(manualPunchStartTimeCorrectionWithdrawalCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(manualPunchStartTimeCorrectionWithdrawalCandidateSchema.safeParse({ ...candidate, absoluteHead: source }).success).toBe(false);
    expect(manualPunchStartTimeCorrectionWithdrawalRequestSchema.safeParse(request).success).toBe(true);
    expect(manualPunchStartTimeCorrectionWithdrawalRequestSchema.safeParse({ ...request, acknowledgedWithdrawal: false }).success).toBe(false);
    expect(manualPunchStartTimeCorrectionWithdrawalIdempotencyKeySchema.safeParse(`manual-punch-start-time-correction-withdrawal:${id}`).success).toBe(true);
  });
  it("kräver en kvittens som återställer exakt teknisk start", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, withdrawalId: other, raceId: id, entryId: other,
      classId: id, courseVersionId: id, snapshotVersion: 7, correctionId: id, source, corrected,
      created: { id: "aabbccdd-1234-4567-8901-123456789014", revision: 6, startTime: source.startTime },
      cause: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL", request, withdrawnAt: "2026-09-20T09:00:00.000Z" };
    expect(manualPunchStartTimeCorrectionWithdrawalResponseSchema.safeParse(response).success).toBe(true);
    expect(manualPunchStartTimeCorrectionWithdrawalResponseSchema.safeParse({ ...response, created: { ...response.created, startTime: corrected.startTime } }).success).toBe(false);
  });
});
