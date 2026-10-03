import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  didNotFinishWithdrawals,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0019_task_006j_did_not_finish_withdrawal.sql", import.meta.url),
  "utf8"
);
const migrationsReadme = readFileSync(
  new URL("../migrations/README.md", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK 006J database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_DID_NOT_FINISH");
    expect(auditActorKindEnum.enumValues).toContain("DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_DID_NOT_FINISH_WITHDRAWAL");
    expect(migration).toMatch(
      /"capability"::text <> 'WITHDRAW_DID_NOT_FINISH'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });

  it("registers migration 0019 and its forward-only restore policy", () => {
    expect(journal.entries?.find((entry) => entry.idx === 19)).toMatchObject({
      idx: 19,
      tag: "0019_task_006j_did_not_finish_withdrawal"
    });
    expect(migrationsReadme).toContain("0019_task_006j_did_not_finish_withdrawal.sql");
    expect(migrationsReadme).toContain("rätta framåt");
    expect(migrationsReadme).toContain("verifierad full PostgreSQL-backup");
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

  it("replaces lifetime entry uniqueness with a non-unique lifecycle lookup", () => {
    expect(migration).toContain('DROP INDEX "did_not_finish_decision_entry_uidx"');
    expect(migration).toMatch(
      /CREATE INDEX "did_not_finish_decision_race_entry_revision_idx"[\s\S]*?ON "did_not_finish_decision"\("race_id", "entry_id", "created_result_revision", "id"\)/
    );
    expect(migration).not.toContain('CREATE UNIQUE INDEX "did_not_finish_decision_race_entry_revision_idx"');
  });

  it("uses exact unique and deferred composite pairing constraints", () => {
    expect(migration).toContain("did_not_finish_decision_withdrawal_source_tuple_uidx");
    expect(migration).toContain("did_not_finish_withdrawal_request_uidx");
    expect(migration).toContain("did_not_finish_withdrawal_decision_uidx");
    expect(migration).toContain("did_not_finish_withdrawal_result_uidx");
    expect(migration).toContain("did_not_finish_withdrawal_created_result_uidx");
    expect(migration).toContain("did_not_finish_withdrawal_decision_fk");
    expect(migration).toContain("did_not_finish_withdrawal_latest_result_fk");
    expect(migration).toContain("did_not_finish_withdrawal_restored_from_fk");
    expect(migration).toContain("did_not_finish_withdrawal_result_pair_fk");
    expect(migration).toContain("result_revision_did_not_finish_withdrawal_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);
  });

  it("enforces the exact revision chain, policy and withdrawal reason", () => {
    expect(migration).toMatch(
      /"withdrawn_result_revision" = "target_result_revision" \+ 1[\s\S]*?"created_result_revision" = "expected_latest_result_revision" \+ 1/
    );
    expect(migration).toMatch(
      /"restored_from_result_revision" = "target_result_revision"[\s\S]*?OR "restored_from_result_revision" > "withdrawn_result_revision"/
    );
    expect(migration).toContain("CHECK (\"policy_version\" = 'did-not-finish-withdrawal-v1')");
    expect(migration).toContain("CHECK (\"reason\" = 'ERRONEOUS_MANUAL_DID_NOT_FINISH')");
  });

  it("requires exclusive null-readout restoration provenance and generic immutability", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_DID_NOT_FINISH_WITHDRAWAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"did_not_finish_decision_id" IS NULL[\s\S]*?"did_not_finish_withdrawal_id" IS NOT NULL[\s\S]*?\("status" = 'OK' AND "reason" = 'COMPLETE'\)/
    );
    expect(migration.match(/"did_not_finish_withdrawal_id" IS NULL/g)).toHaveLength(7);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toContain("CREATE FUNCTION");
  });
});
