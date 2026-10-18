import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum,
  withoutTimingWithdrawals
} from "../src/schema";

describe("TASK 006N database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_WITHOUT_TIMING");
    expect(auditActorKindEnum.enumValues)
      .toContain("WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_WITHOUT_TIMING_WITHDRAWAL");
  });

  it("freezes the NT decision, absolute head, source and reciprocal restoration", () => {
    expect(resultRevisions.withoutTimingWithdrawalId.name).toBe("without_timing_withdrawal_id");
    expect(withoutTimingWithdrawals.withoutTimingDecisionId.name).toBe("without_timing_decision_id");
    expect(withoutTimingWithdrawals.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(withoutTimingWithdrawals.withdrawnResultRevisionId.name)
      .toBe("withdrawn_result_revision_id");
    expect(withoutTimingWithdrawals.expectedLatestResultRevisionId.name)
      .toBe("expected_latest_result_revision_id");
    expect(withoutTimingWithdrawals.restoredFromResultRevisionId.name)
      .toBe("restored_from_result_revision_id");
    expect(withoutTimingWithdrawals.createdResultRevisionId.name)
      .toBe("created_result_revision_id");
    expect(withoutTimingWithdrawals).not.toHaveProperty("readoutId");
  });
});
