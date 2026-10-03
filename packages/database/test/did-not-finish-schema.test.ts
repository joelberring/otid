import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  didNotFinishDecisions,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0018_task_006i_explicit_did_not_finish.sql", import.meta.url),
  "utf8"
);
const schemaSource = readFileSync(new URL("../src/schema.ts", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK 006I database schema", () => {
  it("keeps DNF behind a separate least-privilege capability and actor kind", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_DID_NOT_FINISH");
    expect(auditActorKindEnum.enumValues).toContain("DID_NOT_FINISH_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DID_NOT_FINISH");
  });

  it("adds explicit result provenance and registers migration 0018", () => {
    expect(resultRevisions.didNotFinishDecisionId.name).toBe("did_not_finish_decision_id");
    expect(journal.entries?.find((entry) => entry.idx === 18)).toMatchObject({
      idx: 18,
      tag: "0018_task_006i_explicit_did_not_finish"
    });
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

  it("uses unique request, entry, target and result plus deferred reciprocal constraints", () => {
    expect(migration).toContain("did_not_finish_decision_request_uidx");
    expect(migration).toContain("did_not_finish_decision_entry_uidx");
    expect(migration).toContain("did_not_finish_decision_target_uidx");
    expect(migration).toContain("did_not_finish_decision_created_result_uidx");
    expect(migration).toContain("did_not_finish_decision_target_fk");
    expect(migration).toContain("did_not_finish_decision_result_pair_fk");
    expect(migration).toContain("result_revision_did_not_finish_decision_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(3);
  });

  it("requires null direct readout, exclusive DNF provenance and the generic immutable trigger", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_DID_NOT_FINISH'[\s\S]*?"readout_id" IS NULL[\s\S]*?"did_not_finish_decision_id" IS NOT NULL[\s\S]*?"status" = 'DNF'[\s\S]*?"reason" = 'DID_NOT_FINISH'/
    );
    expect(migration.match(/"did_not_finish_decision_id" IS NULL/g)).toHaveLength(6);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toContain("CREATE FUNCTION");
  });

  it("keeps all TASK 006H and TASK 006I write credentials bounded to eight hours in Drizzle", () => {
    expect(schemaSource).toContain("pairing_admin_result_approval_lifetime_check");
    expect(schemaSource).toContain("pairing_admin_result_approval_withdrawal_lifetime_check");
    expect(schemaSource).toContain("pairing_admin_did_not_finish_lifetime_check");
    expect(migration).toMatch(
      /"capability"::text <> 'DECIDE_DID_NOT_FINISH'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });
});
