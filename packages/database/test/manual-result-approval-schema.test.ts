import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultApprovalDecisions,
  resultApprovalWithdrawals,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0017_task_006h_manual_result_approval.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK 006H database schema", () => {
  it("keeps approval and withdrawal behind separate least-privilege capabilities", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("APPROVE_RESULT");
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_RESULT_APPROVAL");
    expect(auditActorKindEnum.enumValues).toContain("RESULT_APPROVAL_ACCESS_CREDENTIAL");
    expect(auditActorKindEnum.enumValues).toContain("RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL");
  });

  it("adds only manual approval causes and explicit provenance columns", () => {
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_RESULT_APPROVAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_RESULT_APPROVAL_WITHDRAWAL");
    expect(resultRevisions.approvalDecisionId.name).toBe("approval_decision_id");
    expect(resultRevisions.approvalWithdrawalId.name).toBe("approval_withdrawal_id");
  });

  it("keeps migration 0017 registered in the journal", () => {
    expect(journal.entries?.find((entry) => entry.idx === 17)).toMatchObject({
      idx: 17,
      tag: "0017_task_006h_manual_result_approval"
    });
  });

  it("freezes exact target and reciprocal created approval revision", () => {
    expect(resultApprovalDecisions.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(resultApprovalDecisions.targetResultRevision.name).toBe("target_result_revision");
    expect(resultApprovalDecisions.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(resultApprovalDecisions.createdResultRevision.name).toBe("created_result_revision");
    expect(resultApprovalDecisions.status.name).toBe("status");
    expect(resultApprovalDecisions.reason.name).toBe("reason");
  });

  it("freezes approval, observed head, restoration source and created revision", () => {
    expect(resultApprovalWithdrawals.approvalDecisionId.name).toBe("approval_decision_id");
    expect(resultApprovalWithdrawals.withdrawnResultRevisionId.name)
      .toBe("withdrawn_result_revision_id");
    expect(resultApprovalWithdrawals.withdrawnResultRevision.name)
      .toBe("withdrawn_result_revision");
    expect(resultApprovalWithdrawals.expectedLatestResultRevisionId.name)
      .toBe("expected_latest_result_revision_id");
    expect(resultApprovalWithdrawals.expectedLatestResultRevision.name)
      .toBe("expected_latest_result_revision");
    expect(resultApprovalWithdrawals.restoredFromResultRevisionId.name)
      .toBe("restored_from_result_revision_id");
    expect(resultApprovalWithdrawals.restoredFromResultRevision.name)
      .toBe("restored_from_result_revision");
    expect(resultApprovalWithdrawals.createdResultRevisionId.name)
      .toBe("created_result_revision_id");
    expect(resultApprovalWithdrawals.createdResultRevision.name)
      .toBe("created_result_revision");
  });

  it("uses declarative constraints and only the generic immutable trigger", () => {
    expect(migration).toContain("result_approval_decision_target_fk");
    expect(migration).toContain("result_approval_decision_result_pair_fk");
    expect(migration).toContain("result_revision_approval_decision_pair_fk");
    expect(migration).toContain("result_approval_withdrawal_decision_fk");
    expect(migration).toContain("result_approval_withdrawal_latest_result_fk");
    expect(migration).toContain("result_approval_withdrawal_restored_from_fk");
    expect(migration).toContain("result_approval_withdrawal_result_pair_fk");
    expect(migration).toContain("result_revision_approval_withdrawal_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(8);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(2);
    expect(migration).not.toContain("CREATE FUNCTION");
  });

  it("requires null direct readout and manual provenance for both approval paths", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_RESULT_APPROVAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"approval_decision_id" IS NOT NULL/
    );
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"approval_withdrawal_id" IS NOT NULL/
    );
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'[\s\S]*?\("status" = 'OK' AND "reason" = 'COMPLETE'\)[\s\S]*?'INVALID_TIME_ORDER'/
    );
  });
});
