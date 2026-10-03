import { describe, expect, it } from "vitest";
import { createWithoutTimingResult, type EvaluationResult } from "@o-tid/domain";
import type {
  StoredResultRevision,
  StoredWithoutTimingDecision,
  StoredWithoutTimingWithdrawal
} from "../src/stored-result-revision";
import {
  parseStrictStoredResultRevision,
  parseWithoutTimingRestorationTechnicalRevision,
  parseWithoutTimingTechnicalRevision,
  validateStoredWithoutTiming,
  validateStoredWithoutTimingWithdrawal
} from "../src/stored-result-revision";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  raceClass: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  readout: "50000000-0000-4000-8000-000000000005",
  target: "60000000-0000-4000-8000-000000000006",
  decision: "70000000-0000-4000-8000-000000000007",
  withoutTiming: "80000000-0000-4000-8000-000000000008",
  request: "90000000-0000-4000-8000-000000000009",
  actor: "a0000000-0000-4000-8000-000000000010",
  withdrawal: "b0000000-0000-4000-8000-000000000011",
  withdrawalRequest: "c0000000-0000-4000-8000-000000000012",
  withdrawalActor: "d0000000-0000-4000-8000-000000000013",
  restored: "e0000000-0000-4000-8000-000000000014"
} as const;

const targetOutcome: EvaluationResult = {
  status: "OK",
  reason: "COMPLETE",
  entryId: ids.entry,
  classId: ids.raceClass,
  courseVersionId: ids.course,
  startTime: "2026-09-01T10:00:00.000Z",
  finishTime: "2026-09-01T10:01:00.000Z",
  elapsedMs: 60_000,
  missingControls: [],
  extraPunches: [],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
};

const target: StoredResultRevision = {
  id: ids.target,
  raceId: ids.race,
  entryId: ids.entry,
  readoutId: ids.readout,
  didNotStartDecisionId: null,
  startCheckinDnsDecisionId: null,
  controlNeutralizationId: null,
  disqualificationDecisionId: null,
  disqualificationWithdrawalId: null,
  approvalDecisionId: null,
  approvalWithdrawalId: null,
  didNotFinishDecisionId: null,
  didNotFinishWithdrawalId: null,
  notCompetingDecisionId: null,
  notCompetingWithdrawalId: null,
  withoutTimingDecisionId: null,
  withoutTimingWithdrawalId: null,
      manualFinishTimeCorrectionId: null, manualFinishTimeCorrectionWithdrawalId: null, manualPunchStartTimeCorrectionId: null, manualPunchStartTimeCorrectionWithdrawalId: null,
  revision: 1,
  cause: "CARD_READOUT",
  status: "OK",
  reason: "COMPLETE",
  evaluation: targetOutcome,
  engineVersion: "result-engine-v1",
  snapshotVersion: 1,
  courseVersionId: ids.course,
  published: true,
  createdAt: new Date("2026-09-01T10:02:00.000Z")
};

const decision: StoredWithoutTimingDecision = {
  id: ids.decision,
  requestId: ids.request,
  actorCredentialId: ids.actor,
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.raceClass,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  targetResultRevisionId: ids.target,
  targetResultRevision: 1,
  policyVersion: "without-timing-v1",
  status: "NT",
  reason: "WITHOUT_TIMING",
  createdResultRevisionId: ids.withoutTiming,
  createdResultRevision: 2,
  decidedAt: new Date("2026-09-01T10:03:00.000Z")
};

const withoutTiming: StoredResultRevision = {
  ...target,
  id: ids.withoutTiming,
  readoutId: null,
  withoutTimingDecisionId: ids.decision,
  revision: 2,
  cause: "MANUAL_WITHOUT_TIMING",
  status: "NT",
  reason: "WITHOUT_TIMING",
  evaluation: createWithoutTimingResult(targetOutcome),
  engineVersion: "without-timing-v1",
  createdAt: new Date("2026-09-01T10:03:00.000Z")
};

const withdrawal: StoredWithoutTimingWithdrawal = {
  id: ids.withdrawal,
  requestId: ids.withdrawalRequest,
  actorCredentialId: ids.withdrawalActor,
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.raceClass,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  withoutTimingDecisionId: ids.decision,
  targetResultRevisionId: ids.target,
  targetResultRevision: 1,
  withdrawnResultRevisionId: ids.withoutTiming,
  withdrawnResultRevision: 2,
  expectedLatestResultRevisionId: ids.withoutTiming,
  expectedLatestResultRevision: 2,
  restoredFromResultRevisionId: ids.target,
  restoredFromResultRevision: 1,
  policyVersion: "without-timing-withdrawal-v1",
  reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING",
  createdResultRevisionId: ids.restored,
  createdResultRevision: 3,
  withdrawnAt: new Date("2026-09-01T10:04:00.000Z")
};

const restored: StoredResultRevision = {
  ...target,
  id: ids.restored,
  readoutId: null,
  withoutTimingWithdrawalId: ids.withdrawal,
  revision: 3,
  cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  engineVersion: "without-timing-withdrawal-v1",
  createdAt: new Date("2026-09-01T10:04:00.000Z")
};

describe("TASK 006M stored without-timing policy", () => {
  it("bevisar exact technical OK target och status-only NT-revision", () => {
    expect(parseWithoutTimingTechnicalRevision(target)).toEqual(targetOutcome);
    expect(parseStrictStoredResultRevision(withoutTiming)).toEqual({
      status: "NT",
      reason: "WITHOUT_TIMING",
      entryId: ids.entry,
      classId: ids.raceClass,
      courseVersionId: ids.course
    });
    expect(() => validateStoredWithoutTiming(decision, target, withoutTiming)).not.toThrow();
  });

  it("avvisar MP, manuell källa och fel reciprocal provenance", () => {
    expect(() => parseWithoutTimingTechnicalRevision({
      ...target,
      status: "MP",
      reason: "MISSING_CONTROL",
      evaluation: { ...targetOutcome, status: "MP", reason: "MISSING_CONTROL", missingControls: [31] }
    })).toThrow();
    expect(() => parseWithoutTimingTechnicalRevision({ ...target, cause: "MANUAL_RESULT_APPROVAL", readoutId: null,
      approvalDecisionId: ids.decision, evaluation: {
        ...targetOutcome,
        status: "OK",
        reason: "MANUAL_APPROVAL",
        entryId: ids.entry,
        classId: ids.raceClass,
        courseVersionId: ids.course,
        startTime: "2026-09-01T10:00:00.000Z",
        finishTime: "2026-09-01T10:01:00.000Z",
        elapsedMs: 60_000
      },
      reason: "MANUAL_APPROVAL" })).toThrow();
    expect(() => validateStoredWithoutTiming(decision, target, { ...withoutTiming,
      withoutTimingDecisionId: ids.request })).toThrow();
  });

  it("återställer exakt det ursprungliga tekniska OK-utfallet via reciprocal withdrawal", () => {
    expect(parseWithoutTimingRestorationTechnicalRevision(target)).toEqual(targetOutcome);
    expect(() => validateStoredWithoutTimingWithdrawal(
      withdrawal,
      decision,
      target,
      withoutTiming,
      withoutTiming,
      target,
      restored
    )).not.toThrow();
    expect(parseStrictStoredResultRevision(restored)).toEqual(targetOutcome);
  });

  it("avvisar en withdrawal som byter källa eller fabricerar readout-proveniens", () => {
    expect(() => validateStoredWithoutTimingWithdrawal(
      { ...withdrawal, restoredFromResultRevisionId: ids.withoutTiming, restoredFromResultRevision: 2 },
      decision,
      target,
      withoutTiming,
      withoutTiming,
      withoutTiming,
      restored
    )).toThrow();
    expect(() => parseWithoutTimingRestorationTechnicalRevision(restored)).toThrow();
    expect(() => parseStrictStoredResultRevision({ ...restored, readoutId: ids.readout })).toThrow();
  });
});
