import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultApprovalDecisions,
  resultApprovalWithdrawals,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

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
});
