import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  notCompetingWithdrawals,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

describe("TASK 006L database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_OUT_OF_COMPETITION");
    expect(auditActorKindEnum.enumValues)
      .toContain("OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_OUT_OF_COMPETITION_WITHDRAWAL");
  });

  it("freezes OOC chain, observed absolute head, source and reciprocal restoration", () => {
    expect(resultRevisions.notCompetingWithdrawalId.name).toBe("not_competing_withdrawal_id");
    expect(notCompetingWithdrawals.notCompetingDecisionId.name).toBe("not_competing_decision_id");
    expect(notCompetingWithdrawals.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(notCompetingWithdrawals.withdrawnResultRevisionId.name).toBe("withdrawn_result_revision_id");
    expect(notCompetingWithdrawals.expectedLatestResultRevisionId.name)
      .toBe("expected_latest_result_revision_id");
    expect(notCompetingWithdrawals.restoredFromResultRevisionId.name)
      .toBe("restored_from_result_revision_id");
    expect(notCompetingWithdrawals.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(notCompetingWithdrawals).not.toHaveProperty("readoutId");
  });
});
