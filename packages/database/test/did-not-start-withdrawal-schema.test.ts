import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  didNotStartWithdrawals,
  pairingAdminCapabilityEnum
} from "../src/schema";

describe("TASK 006F database schema", () => {
  it("keeps withdrawal as a separate least-privilege audited lifecycle record", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_DID_NOT_START");
    expect(auditActorKindEnum.enumValues).toContain("DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL");

    expect(didNotStartWithdrawals.didNotStartDecisionId.name).toBe("did_not_start_decision_id");
    expect(didNotStartWithdrawals.withdrawnResultRevisionId.name).toBe("withdrawn_result_revision_id");
    expect(didNotStartWithdrawals.expectedLatestResultRevision.name).toBe("expected_latest_result_revision");
    expect(didNotStartWithdrawals.policyVersion.name).toBe("policy_version");
    expect(didNotStartWithdrawals.reason.name).toBe("reason");

    expect(didNotStartWithdrawals).not.toHaveProperty("status");
    expect(didNotStartWithdrawals).not.toHaveProperty("published");
    expect(didNotStartWithdrawals).not.toHaveProperty("readoutId");
  });
});
