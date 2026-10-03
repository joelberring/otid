import { describe, expect, it } from "vitest";
import {
  manualPunchStartTimeCorrectionCandidateSchema,
  manualPunchStartTimeCorrectionIdempotencyKeySchema,
  manualPunchStartTimeCorrectionRequestSchema,
  manualPunchStartTimeCorrectionResponseSchema
} from "../src";

const id = "aabbccdd-1234-4567-8901-123456789012";
const secondId = "aabbccdd-1234-4567-8901-123456789013";
const hash = "a".repeat(64);
const source = { resultRevisionId: id, resultRevision: 4, readoutId: secondId, cause: "CARD_READOUT", courseVersionId: id,
  snapshotVersion: 7, startRule: "PUNCH", outcome: { status: "OK", reason: "COMPLETE" },
  startTime: "2026-09-20T08:00:00.000Z", finishTime: "2026-09-20T08:45:00.000Z", elapsedMs: 2_700_000,
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 300_000 }] } as const;
const request = { formatVersion: 1, requestId: id, entryId: secondId, expectedEntryVersion: 3, expectedClassId: id,
  expectedCourseVersionId: id, expectedSnapshotVersion: 7, expectedBasisHash: hash, expectedSourceResultRevisionId: id,
  expectedSourceResultRevision: 4, expectedReadoutId: secondId, expectedSourceStartTime: source.startTime,
  correctedStartTime: "2026-09-20T09:59:00.000+02:00", acknowledgedCorrection: true } as const;

describe("TASK104 PUNCH-startkontrakt", () => {
  it("kräver PUNCH-källa med sammanhängande splitter", () => {
    const candidate = { formatVersion: 1, raceId: id, entryId: secondId, entryName: "Anna Andersson", entryVersion: 3,
      classId: id, className: "D21", snapshotVersion: 7, basisHash: hash, source };
    expect(manualPunchStartTimeCorrectionCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(manualPunchStartTimeCorrectionCandidateSchema.safeParse({ ...candidate, source: { ...source, startRule: "FIXED" } }).success).toBe(false);
    expect(manualPunchStartTimeCorrectionCandidateSchema.safeParse({ ...candidate, source: { ...source, splits: [{ ...source.splits[0], legMs: 1 }] } }).success).toBe(false);
  });
  it("normaliserar offset och binder rätt idempotensnyckel", () => {
    expect(manualPunchStartTimeCorrectionRequestSchema.parse(request).correctedStartTime).toBe("2026-09-20T07:59:00.000Z");
    expect(manualPunchStartTimeCorrectionIdempotencyKeySchema.safeParse(`manual-punch-start-time-correction:${id}`).success).toBe(true);
    expect(manualPunchStartTimeCorrectionRequestSchema.safeParse({ ...request, acknowledgedCorrection: false }).success).toBe(false);
  });
  it("avvisar kvittens som inte binder den granskade starttiden", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, correctionId: id, raceId: id, entryId: secondId,
      classId: id, courseVersionId: id, sourceSnapshotVersion: 7, sourceBasisHash: hash, snapshotVersionAfter: 7,
      source, previousStartTime: source.startTime, correctedStartTime: "2026-09-20T07:59:00.000Z", elapsedMs: 2_760_000,
      createdResultRevisionId: secondId, createdResultRevision: 5, cause: "MANUAL_PUNCH_START_TIME_CORRECTION", request,
      correctedAt: "2026-09-20T09:00:00.000Z" };
    expect(manualPunchStartTimeCorrectionResponseSchema.safeParse(response).success).toBe(true);
    expect(manualPunchStartTimeCorrectionResponseSchema.safeParse({ ...response, elapsedMs: 1 }).success).toBe(false);
  });
});
