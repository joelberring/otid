import { describe, expect, it } from "vitest";
import {
  manualFinishTimeCorrectionCandidateSchema,
  manualFinishTimeCorrectionIdempotencyKeySchema,
  manualFinishTimeCorrectionRequestSchema,
  manualFinishTimeCorrectionResponseSchema
} from "../src";

const id = "aabbccdd-1234-4567-8901-123456789012";
const secondId = "aabbccdd-1234-4567-8901-123456789013";
const hash = "a".repeat(64);
const source = {
  resultRevisionId: id, resultRevision: 4, readoutId: secondId,
  cause: "CARD_READOUT", courseVersionId: id, snapshotVersion: 7,
  outcome: { status: "OK", reason: "COMPLETE" },
  startTime: "2026-09-19T08:00:00.000Z", finishTime: "2026-09-19T08:45:00.000Z",
  elapsedMs: 2_700_000, latestMatchedSplitElapsedMs: 2_650_000
} as const;
const request = {
  formatVersion: 1, requestId: id, entryId: secondId, expectedEntryVersion: 3,
  expectedClassId: id, expectedCourseVersionId: id, expectedSnapshotVersion: 7,
  expectedBasisHash: hash, expectedSourceResultRevisionId: id, expectedSourceResultRevision: 4,
  expectedReadoutId: secondId, expectedSourceFinishTime: source.finishTime,
  correctedFinishTime: "2026-09-19T10:46:00.000+02:00", acknowledgedCorrection: true
} as const;

describe("TASK093 manuell måltidskorrigering", () => {
  it("accepterar en strikt OK- eller MP-kandidat med komplett teknisk källa", () => {
    const candidate = {
      formatVersion: 1, raceId: id, entryId: secondId, entryName: "Anna Andersson", entryVersion: 3,
      classId: id, className: "D21", snapshotVersion: 7, basisHash: hash, source
    };
    expect(manualFinishTimeCorrectionCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(manualFinishTimeCorrectionCandidateSchema.safeParse({
      ...candidate, source: { ...source, outcome: { status: "MP", reason: "MISSING_CONTROL" } }
    }).success).toBe(true);
    expect(manualFinishTimeCorrectionCandidateSchema.safeParse({
      ...candidate, source: { ...source, cause: "MANUAL_RESULT_APPROVAL" }
    }).success).toBe(false);
    expect(manualFinishTimeCorrectionCandidateSchema.safeParse({
      ...candidate, source: { ...source, elapsedMs: source.elapsedMs - 1 }
    }).success).toBe(false);
  });

  it("normaliserar explicit offset men avvisar fri eller för precis tid och obekräftat intent", () => {
    expect(manualFinishTimeCorrectionRequestSchema.parse(request).correctedFinishTime)
      .toBe("2026-09-19T08:46:00.000Z");
    for (const changed of [
      { ...request, correctedFinishTime: "2026-09-19T08:46:00" },
      { ...request, correctedFinishTime: "2026-09-19T08:46:00.0001Z" },
      { ...request, acknowledgedCorrection: false },
      { ...request, extra: true }
    ]) expect(manualFinishTimeCorrectionRequestSchema.safeParse(changed).success).toBe(false);
    expect(manualFinishTimeCorrectionIdempotencyKeySchema.safeParse(`manual-finish-time-correction:${id}`).success).toBe(true);
  });

  it("kräver en kvittens som binder intent, källa och oförändrad snapshot", () => {
    const response = {
      formatVersion: 1, replayed: false, requestId: id, correctionId: secondId, raceId: id,
      entryId: secondId, classId: id, courseVersionId: id, sourceSnapshotVersion: 7,
      sourceBasisHash: hash, snapshotVersionAfter: 7, source,
      previousFinishTime: source.finishTime, correctedFinishTime: "2026-09-19T08:46:00.000Z",
      elapsedMs: 2_760_000, createdResultRevisionId: secondId, createdResultRevision: 5,
      cause: "MANUAL_FINISH_TIME_CORRECTION", request,
      correctedAt: "2026-09-19T09:00:00.000Z"
    };
    expect(manualFinishTimeCorrectionResponseSchema.safeParse(response).success).toBe(true);
    for (const changed of [
      { ...response, snapshotVersionAfter: 8 },
      { ...response, source: { ...source, readoutId: id } },
      { ...response, correctedFinishTime: source.finishTime },
      { ...response, elapsedMs: response.elapsedMs - 1 }
    ]) expect(manualFinishTimeCorrectionResponseSchema.safeParse(changed).success).toBe(false);
  });
});
