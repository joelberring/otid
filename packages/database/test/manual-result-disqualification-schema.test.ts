import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultDisqualificationDecisions,
  resultDisqualificationWithdrawals,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

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
});
