import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  didNotFinishWithdrawals,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

describe("TASK 006J database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_DID_NOT_FINISH");
    expect(auditActorKindEnum.enumValues).toContain("DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DID_NOT_FINISH_WITHDRAWAL");
  });

  it("freezes target, DNF, absolute head, source and reciprocal restoration", () => {
    expect(resultRevisions.didNotFinishWithdrawalId.name).toBe("did_not_finish_withdrawal_id");
    expect(didNotFinishWithdrawals.didNotFinishDecisionId.name).toBe("did_not_finish_decision_id");
    expect(didNotFinishWithdrawals.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(didNotFinishWithdrawals.targetResultRevision.name).toBe("target_result_revision");
    expect(didNotFinishWithdrawals.withdrawnResultRevisionId.name).toBe("withdrawn_result_revision_id");
    expect(didNotFinishWithdrawals.withdrawnResultRevision.name).toBe("withdrawn_result_revision");
    expect(didNotFinishWithdrawals.expectedLatestResultRevisionId.name)
      .toBe("expected_latest_result_revision_id");
    expect(didNotFinishWithdrawals.expectedLatestResultRevision.name)
      .toBe("expected_latest_result_revision");
    expect(didNotFinishWithdrawals.restoredFromResultRevisionId.name)
      .toBe("restored_from_result_revision_id");
    expect(didNotFinishWithdrawals.restoredFromResultRevision.name)
      .toBe("restored_from_result_revision");
    expect(didNotFinishWithdrawals.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(didNotFinishWithdrawals.createdResultRevision.name).toBe("created_result_revision");
    expect(didNotFinishWithdrawals).not.toHaveProperty("readoutId");
  });
});
