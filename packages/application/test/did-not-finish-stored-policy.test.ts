import { describe, expect, it } from "vitest";
import { createDidNotFinishResult, type EvaluationResult } from "@o-tid/domain";
import type {
  StoredDidNotFinishDecision,
  StoredDidNotFinishWithdrawal,
  StoredResultRevision
} from "../src/stored-result-revision";
import {
  parseStrictStoredResultRevision,
  validateStoredDidNotFinish,
  validateStoredDidNotFinishWithdrawal
} from "../src/stored-result-revision";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  raceClass: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  readout: "50000000-0000-4000-8000-000000000005",
  target: "60000000-0000-4000-8000-000000000006",
  decision: "70000000-0000-4000-8000-000000000007",
  didNotFinish: "80000000-0000-4000-8000-000000000008",
  withdrawal: "90000000-0000-4000-8000-000000000009",
  restored: "a0000000-0000-4000-8000-000000000010"
} as const;

const targetOutcome: EvaluationResult = {
  status: "MP",
  reason: "MISSING_CONTROL",
  entryId: ids.entry,
  classId: ids.raceClass,
  courseVersionId: ids.course,
  startTime: "2026-09-01T10:00:00.000Z",
  finishTime: "2026-09-01T10:01:00.000Z",
  elapsedMs: 60_000,
  missingControls: [32],
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
  status: "MP",
  reason: "MISSING_CONTROL",
  evaluation: targetOutcome,
  engineVersion: "result-engine-v1",
  snapshotVersion: 1,
  courseVersionId: ids.course,
  published: true,
  createdAt: new Date("2026-09-01T10:02:00.000Z")
};

const decision: StoredDidNotFinishDecision = {
  id: ids.decision,
  requestId: "b0000000-0000-4000-8000-000000000011",
  actorCredentialId: "c0000000-0000-4000-8000-000000000012",
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.raceClass,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  targetResultRevisionId: ids.target,
  targetResultRevision: 1,
  policyVersion: "did-not-finish-v1",
  status: "DNF",
  reason: "DID_NOT_FINISH",
  createdResultRevisionId: ids.didNotFinish,
  createdResultRevision: 2,
  decidedAt: new Date("2026-09-01T10:03:00.000Z")
};

const didNotFinish: StoredResultRevision = {
  ...target,
  id: ids.didNotFinish,
  readoutId: null,
  didNotFinishDecisionId: ids.decision,
  revision: 2,
  cause: "MANUAL_DID_NOT_FINISH",
  status: "DNF",
  reason: "DID_NOT_FINISH",
  evaluation: createDidNotFinishResult(targetOutcome),
  engineVersion: "did-not-finish-v1",
  createdAt: new Date("2026-09-01T10:03:00.000Z")
};

const withdrawal: StoredDidNotFinishWithdrawal = {
  id: ids.withdrawal,
  requestId: "d0000000-0000-4000-8000-000000000013",
  actorCredentialId: "e0000000-0000-4000-8000-000000000014",
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.raceClass,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  didNotFinishDecisionId: ids.decision,
  targetResultRevisionId: ids.target,
  targetResultRevision: 1,
  withdrawnResultRevisionId: ids.didNotFinish,
  withdrawnResultRevision: 2,
  expectedLatestResultRevisionId: ids.didNotFinish,
  expectedLatestResultRevision: 2,
  restoredFromResultRevisionId: ids.target,
  restoredFromResultRevision: 1,
  policyVersion: "did-not-finish-withdrawal-v1",
  reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
  createdResultRevisionId: ids.restored,
  createdResultRevision: 3,
  withdrawnAt: new Date("2026-09-01T10:04:00.000Z")
};

const restored: StoredResultRevision = {
  ...target,
  id: ids.restored,
  readoutId: null,
  didNotFinishWithdrawalId: ids.withdrawal,
  revision: 3,
  cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  engineVersion: "did-not-finish-withdrawal-v1",
  createdAt: new Date("2026-09-01T10:04:00.000Z")
};

describe("TASK 006J stored DNF-withdrawal policy", () => {
  it("bevisar exakt decision, DNF, teknisk källa och restaurering", () => {
    expect(parseStrictStoredResultRevision(didNotFinish)).toEqual(didNotFinish.evaluation);
    expect(parseStrictStoredResultRevision(restored)).toEqual(targetOutcome);
    expect(() => validateStoredDidNotFinish(decision, target, didNotFinish)).not.toThrow();
    expect(() => validateStoredDidNotFinishWithdrawal(
      withdrawal,
      decision,
      target,
      didNotFinish,
      didNotFinish,
      target,
      restored
    )).not.toThrow();
  });

  it("ADR-0169 godtar withdrawal i en senare tävlingsversion när källan är oförändrad", () => {
    expect(() => validateStoredDidNotFinishWithdrawal(
      { ...withdrawal, expectedSnapshotVersion: 2 },
      decision,
      target,
      didNotFinish,
      didNotFinish,
      target,
      { ...restored, snapshotVersion: 2 }
    )).not.toThrow();
  });

  it.each([
    ["klass", { expectedClassId: "f0000000-0000-4000-8000-000000000015" }],
    ["bana", { expectedCourseVersionId: "f0000000-0000-4000-8000-000000000015" }],
    // ADR-0169: en senare tävlingsversion är tillåten, men aldrig en äldre än källans.
    ["snapshot", { expectedSnapshotVersion: 0 }]
  ])("avvisar withdrawal med motsägande fryst %s", (_name, override) => {
    expect(() => validateStoredDidNotFinishWithdrawal(
      { ...withdrawal, ...override },
      decision,
      target,
      didNotFinish,
      didNotFinish,
      target,
      restored
    )).toThrow();
  });
});
