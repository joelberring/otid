import { describe, expect, it } from "vitest";
import { createManuallyApprovedResult, type EvaluationResult } from "@o-tid/domain";
import { schema } from "@o-tid/database";
import { resolveStoredResultHeadStates } from "../src/result-revision-state";
import type {
  StoredResultApprovalDecision,
  StoredResultApprovalWithdrawal,
  StoredResultRevision
} from "../src/stored-result-revision";
import {
  parseStrictStoredResultRevision,
  validateStoredApproval,
  validateStoredApprovalWithdrawal
} from "../src/stored-result-revision";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  readout: "50000000-0000-4000-8000-000000000005",
  target: "60000000-0000-4000-8000-000000000006",
  decision: "70000000-0000-4000-8000-000000000007",
  approved: "80000000-0000-4000-8000-000000000008",
  withdrawal: "90000000-0000-4000-8000-000000000009",
  restored: "a0000000-0000-4000-8000-000000000010"
} as const;

const targetOutcome: EvaluationResult = {
  status: "MP",
  reason: "MISSING_CONTROL",
  entryId: ids.entry,
  classId: ids.class,
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

const decision: StoredResultApprovalDecision = {
  id: ids.decision,
  requestId: "b0000000-0000-4000-8000-000000000011",
  actorCredentialId: "c0000000-0000-4000-8000-000000000012",
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.class,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  targetResultRevisionId: ids.target,
  targetResultRevision: 1,
  policyVersion: "manual-result-approval-v1",
  status: "OK",
  reason: "MANUAL_APPROVAL",
  createdResultRevisionId: ids.approved,
  createdResultRevision: 2,
  decidedAt: new Date("2026-09-01T10:03:00.000Z")
};

const approved: StoredResultRevision = {
  ...target,
  id: ids.approved,
  readoutId: null,
  approvalDecisionId: ids.decision,
  revision: 2,
  cause: "MANUAL_RESULT_APPROVAL",
  status: "OK",
  reason: "MANUAL_APPROVAL",
  evaluation: createManuallyApprovedResult(targetOutcome),
  createdAt: new Date("2026-09-01T10:03:00.000Z")
};

const withdrawal: StoredResultApprovalWithdrawal = {
  id: ids.withdrawal,
  requestId: "d0000000-0000-4000-8000-000000000013",
  actorCredentialId: "e0000000-0000-4000-8000-000000000014",
  raceId: ids.race,
  entryId: ids.entry,
  expectedEntryVersion: 1,
  expectedClassId: ids.class,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 1,
  approvalDecisionId: ids.decision,
  withdrawnResultRevisionId: ids.approved,
  withdrawnResultRevision: 2,
  expectedLatestResultRevisionId: ids.approved,
  expectedLatestResultRevision: 2,
  restoredFromResultRevisionId: ids.target,
  restoredFromResultRevision: 1,
  policyVersion: "manual-result-approval-withdrawal-v1",
  reason: "ERRONEOUS_MANUAL_APPROVAL",
  createdResultRevisionId: ids.restored,
  createdResultRevision: 3,
  withdrawnAt: new Date("2026-09-01T10:04:00.000Z")
};

const restored: StoredResultRevision = {
  ...target,
  id: ids.restored,
  readoutId: null,
  approvalWithdrawalId: ids.withdrawal,
  revision: 3,
  cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
  createdAt: new Date("2026-09-01T10:04:00.000Z")
};

describe("TASK 006H approval-projection policy", () => {
  it("tolkar och bevisar approval → explicit teknisk restaurering", () => {
    expect(parseStrictStoredResultRevision(approved)).toEqual(approved.evaluation);
    expect(parseStrictStoredResultRevision(restored)).toEqual(targetOutcome);
    expect(() => validateStoredApproval(decision, target, approved)).not.toThrow();
    expect(() => validateStoredApprovalWithdrawal(withdrawal, decision, approved, target, restored)).not.toThrow();
  });

  it("avvisar approval-proveniens som försöker peka på en readout eller fel decision", () => {
    expect(() => parseStrictStoredResultRevision({ ...approved, readoutId: ids.readout })).toThrow();
    expect(() => validateStoredApproval({ ...decision, targetResultRevisionId: ids.approved }, target, approved)).toThrow();
    expect(() => validateStoredApprovalWithdrawal(
      { ...withdrawal, expectedLatestResultRevision: 1 }, decision, approved, target, restored
    )).toThrow();
  });

  it("låter aktiv approval ligga kvar som overlay över senare tekniskt huvud", async () => {
    const laterTechnical = {
      ...target,
      id: "f0000000-0000-4000-8000-000000000015",
      revision: 3
    };
    const rows = new Map<unknown, readonly unknown[]>([
      [schema.didNotStartWithdrawals, []],
      [schema.resultDisqualificationDecisions, []],
      [schema.resultApprovalDecisions, [decision]],
      [schema.resultApprovalWithdrawals, []],
      [schema.resultRevisions, [target, approved]]
    ]);
    const tx = {
      select: () => ({
        from: (table: unknown) => query(rows.get(table) ?? [])
      })
    } as never;

    const [state] = await resolveStoredResultHeadStates(tx, ids.race, [laterTechnical]);

    expect(state).toMatchObject({
      state: "ACTIVE_RESULT",
      head: { id: ids.approved, revision: 2 },
      selectedHead: { id: laterTechnical.id, revision: 3 },
      approval: { decision: { id: ids.decision }, withdrawal: null }
    });
  });
});

function query(values: readonly unknown[]) {
  const result = Promise.resolve(values);
  return Object.assign(result, {
    where: () => query(values),
    limit: (count: number) => query(values.slice(0, count)),
    orderBy: () => query(values)
  });
}
