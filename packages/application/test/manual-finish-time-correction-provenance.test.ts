import { describe, expect, it } from "vitest";
import { schema } from "@o-tid/database";
import { parseStrictStoredResultRevision, StoredResultRevisionConflict,
  type StoredManualFinishTimeCorrectionProof, type StoredManualFinishTimeCorrectionWithdrawalProof, type StoredResultRevision } from "../src/stored-result-revision";

const ids = { race: "10000000-0000-4000-8000-000000000001", entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003", course: "40000000-0000-4000-8000-000000000004",
  readout: "50000000-0000-4000-8000-000000000005", source: "60000000-0000-4000-8000-000000000006",
  corrected: "70000000-0000-4000-8000-000000000007", correction: "80000000-0000-4000-8000-000000000008",
  withdrawal: "90000000-0000-4000-8000-000000000009", restored: "a0000000-0000-4000-8000-000000000010" } as const;

const outcome = (finishTime: string, elapsedMs: number) => ({ status: "OK" as const, reason: "COMPLETE" as const,
  entryId: ids.entry, classId: ids.class, courseVersionId: ids.course, startTime: "2026-09-19T10:00:00.000Z",
  finishTime, elapsedMs, missingControls: [], extraPunches: [], splits: [] });

function revision(id: string, revisionNumber: number, cause: StoredResultRevision["cause"], evaluation: ReturnType<typeof outcome>, correctionId: string | null): StoredResultRevision {
  return { id, raceId: ids.race, entryId: ids.entry, readoutId: cause === "CARD_READOUT" ? ids.readout : null,
    didNotStartDecisionId: null, startCheckinDnsDecisionId: null, controlNeutralizationId: null,
    disqualificationDecisionId: null, disqualificationWithdrawalId: null, approvalDecisionId: null,
    approvalWithdrawalId: null, didNotFinishDecisionId: null, didNotFinishWithdrawalId: null,
    notCompetingDecisionId: null, notCompetingWithdrawalId: null, withoutTimingDecisionId: null,
    withoutTimingWithdrawalId: null, manualFinishTimeCorrectionId: correctionId, manualFinishTimeCorrectionWithdrawalId: null, manualPunchStartTimeCorrectionId: null, manualPunchStartTimeCorrectionWithdrawalId: null, revision: revisionNumber,
    cause, status: evaluation.status, reason: evaluation.reason, evaluation, engineVersion: "engine-v1",
    snapshotVersion: 1, courseVersionId: ids.course, published: true, createdAt: new Date("2026-09-19T10:05:00.000Z") };
}

describe("TASK093 stored correction proof", () => {
  it("keeps corrected revisions closed without proof and accepts an exact proof", () => {
    const source = revision(ids.source, 1, "CARD_READOUT", outcome("2026-09-19T10:01:00.000Z", 60_000), null);
    const corrected = revision(ids.corrected, 2, "MANUAL_FINISH_TIME_CORRECTION", outcome("2026-09-19T10:01:05.000Z", 65_000), ids.correction);
    expect(() => parseStrictStoredResultRevision(corrected)).toThrow(StoredResultRevisionConflict);
    const correction = { requestId: ids.correction, raceId: ids.race, entryId: ids.entry,
      sourceResultRevisionId: ids.source, sourceResultRevision: 1, sourceReadoutId: ids.readout,
      sourceFinishTime: new Date("2026-09-19T10:01:00.000Z"), correctedFinishTime: new Date("2026-09-19T10:01:05.000Z"),
      createdResultRevisionId: ids.corrected, createdResultRevision: 2 } as typeof schema.manualFinishTimeCorrections.$inferSelect;
    const proof = { correction, source, corrected } satisfies StoredManualFinishTimeCorrectionProof;
    expect(parseStrictStoredResultRevision(corrected, undefined, proof)).toEqual(corrected.evaluation);
    expect(() => parseStrictStoredResultRevision({ ...corrected, evaluation: outcome("2026-09-19T10:01:06.000Z", 60_006) }, undefined, proof)).toThrow(StoredResultRevisionConflict);
  });

  it("TASK094 accepts only an exact immutable restoration of the technical source", () => {
    const source = revision(ids.source, 1, "CARD_READOUT", outcome("2026-09-19T10:01:00.000Z", 60_000), null);
    const corrected = revision(ids.corrected, 2, "MANUAL_FINISH_TIME_CORRECTION", outcome("2026-09-19T10:01:05.000Z", 65_000), ids.correction);
    const restored = { ...revision(ids.restored, 3, "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", source.evaluation as ReturnType<typeof outcome>, null), manualFinishTimeCorrectionWithdrawalId: ids.withdrawal };
    const correction = { requestId: ids.correction, raceId: ids.race, entryId: ids.entry, sourceResultRevisionId: ids.source,
      sourceResultRevision: 1, sourceReadoutId: ids.readout, sourceFinishTime: new Date("2026-09-19T10:01:00.000Z"),
      correctedFinishTime: new Date("2026-09-19T10:01:05.000Z"), createdResultRevisionId: ids.corrected, createdResultRevision: 2 } as typeof schema.manualFinishTimeCorrections.$inferSelect;
    const withdrawal = { id: ids.withdrawal, requestId: "b0000000-0000-4000-8000-000000000011", raceId: ids.race, entryId: ids.entry,
      correctionId: ids.correction, sourceResultRevisionId: ids.source, sourceResultRevision: 1, correctedResultRevisionId: ids.corrected,
      correctedResultRevision: 2, createdResultRevisionId: ids.restored, createdResultRevision: 3 } as typeof schema.manualFinishTimeCorrectionWithdrawals.$inferSelect;
    const proof = { withdrawal, correction, source, corrected, restored } satisfies StoredManualFinishTimeCorrectionWithdrawalProof;
    expect(() => parseStrictStoredResultRevision(restored)).toThrow(StoredResultRevisionConflict);
    expect(parseStrictStoredResultRevision(restored, undefined, undefined, proof)).toEqual(source.evaluation);
    expect(() => parseStrictStoredResultRevision({ ...restored, evaluation: outcome("2026-09-19T10:01:01.000Z", 61_000) }, undefined, undefined, proof)).toThrow(StoredResultRevisionConflict);
  });
});
