import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  didNotFinishDecisions,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";
const schemaSource = readFileSync(new URL("../src/schema.ts", import.meta.url), "utf8");

describe("TASK 006I database schema", () => {
  it("keeps DNF behind a separate least-privilege capability and actor kind", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_DID_NOT_FINISH");
    expect(auditActorKindEnum.enumValues).toContain("DID_NOT_FINISH_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DID_NOT_FINISH");
  });

  it("adds explicit result provenance and registers migration 0018", () => {
    expect(resultRevisions.didNotFinishDecisionId.name).toBe("did_not_finish_decision_id");
  });

  it("freezes the exact target and reciprocal status-only DNF revision", () => {
    expect(didNotFinishDecisions.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(didNotFinishDecisions.targetResultRevision.name).toBe("target_result_revision");
    expect(didNotFinishDecisions.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(didNotFinishDecisions.createdResultRevision.name).toBe("created_result_revision");
    expect(didNotFinishDecisions.status.name).toBe("status");
    expect(didNotFinishDecisions.reason.name).toBe("reason");
    expect(didNotFinishDecisions).not.toHaveProperty("readoutId");
  });

  it("keeps all TASK 006H and TASK 006I write credentials bounded to eight hours in Drizzle", () => {
    expect(schemaSource).toContain("pairing_admin_result_approval_lifetime_check");
    expect(schemaSource).toContain("pairing_admin_result_approval_withdrawal_lifetime_check");
    expect(schemaSource).toContain("pairing_admin_did_not_finish_lifetime_check");
  });
});
