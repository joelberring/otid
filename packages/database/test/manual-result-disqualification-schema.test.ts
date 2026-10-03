import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultDisqualificationDecisions,
  resultDisqualificationWithdrawals,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0016_task_006g_manual_result_disqualification.sql", import.meta.url),
  "utf8"
);

describe("TASK 006G database schema", () => {
  it("keeps decision and withdrawal behind separate least-privilege capabilities", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DISQUALIFY_RESULT");
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_DISQUALIFICATION");
    expect(auditActorKindEnum.enumValues).toContain("RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL");
    expect(auditActorKindEnum.enumValues).toContain("RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL");
  });

  it("adds only manual persisted revision causes and explicit journal provenance", () => {
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DISQUALIFICATION");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DISQUALIFICATION_WITHDRAWAL");
    expect(resultRevisions.disqualificationDecisionId.name).toBe("disqualification_decision_id");
    expect(resultRevisions.disqualificationWithdrawalId.name).toBe("disqualification_withdrawal_id");
  });

  it("freezes the exact decision target and reciprocal created revision", () => {
    expect(resultDisqualificationDecisions.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(resultDisqualificationDecisions.targetResultRevision.name).toBe("target_result_revision");
    expect(resultDisqualificationDecisions.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(resultDisqualificationDecisions.createdResultRevision.name).toBe("created_result_revision");
    expect(resultDisqualificationDecisions.status.name).toBe("status");
    expect(resultDisqualificationDecisions.reason.name).toBe("reason");
    expect(resultDisqualificationDecisions).not.toHaveProperty("readoutId");
  });

  it("freezes active DSQ, observed head, restoration source and created revision", () => {
    expect(resultDisqualificationWithdrawals.disqualificationDecisionId.name)
      .toBe("disqualification_decision_id");
    expect(resultDisqualificationWithdrawals.withdrawnResultRevisionId.name)
      .toBe("withdrawn_result_revision_id");
    expect(resultDisqualificationWithdrawals.withdrawnResultRevision.name)
      .toBe("withdrawn_result_revision");
    expect(resultDisqualificationWithdrawals.expectedLatestResultRevisionId.name)
      .toBe("expected_latest_result_revision_id");
    expect(resultDisqualificationWithdrawals.expectedLatestResultRevision.name)
      .toBe("expected_latest_result_revision");
    expect(resultDisqualificationWithdrawals.restoredFromResultRevisionId.name)
      .toBe("restored_from_result_revision_id");
    expect(resultDisqualificationWithdrawals.restoredFromResultRevision.name)
      .toBe("restored_from_result_revision");
    expect(resultDisqualificationWithdrawals.createdResultRevisionId.name)
      .toBe("created_result_revision_id");
    expect(resultDisqualificationWithdrawals.createdResultRevision.name)
      .toBe("created_result_revision");
    expect(resultDisqualificationWithdrawals).not.toHaveProperty("readoutId");
  });

  it("uses only declarative pairing constraints and the generic immutable trigger", () => {
    expect(migration).toContain("result_disqualification_decision_target_fk");
    expect(migration).toContain("result_disqualification_decision_result_pair_fk");
    expect(migration).toContain("result_revision_disqualification_decision_pair_fk");
    expect(migration).toContain("result_disqualification_withdrawal_decision_fk");
    expect(migration).toContain("result_disqualification_withdrawal_latest_result_fk");
    expect(migration).toContain("result_disqualification_withdrawal_restored_from_fk");
    expect(migration).toContain("result_disqualification_withdrawal_result_pair_fk");
    expect(migration).toContain("result_revision_disqualification_withdrawal_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(8);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(2);
    expect(migration).not.toContain("CREATE FUNCTION");
  });

  it("requires null direct readout for both manual revision paths", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_DISQUALIFICATION'[\s\S]*?"readout_id" IS NULL[\s\S]*?"disqualification_decision_id" IS NOT NULL/
    );
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_DISQUALIFICATION_WITHDRAWAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"disqualification_withdrawal_id" IS NOT NULL/
    );
  });
});
