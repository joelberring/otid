import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  notCompetingWithdrawals,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0021_task_006l_out_of_competition_withdrawal.sql", import.meta.url),
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

describe("TASK 006L database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_OUT_OF_COMPETITION");
    expect(auditActorKindEnum.enumValues)
      .toContain("OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_OUT_OF_COMPETITION_WITHDRAWAL");
    expect(migration).toMatch(
      /"capability"::text <> 'WITHDRAW_OUT_OF_COMPETITION'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });

  it("registers migration 0021 and documents forward-only restoration", () => {
    expect(journal.entries?.find((entry) => entry.idx === 21)).toMatchObject({
      idx: 21,
      tag: "0021_task_006l_out_of_competition_withdrawal"
    });
    expect(migrationsReadme).toContain("0021_task_006l_out_of_competition_withdrawal.sql");
    expect(migrationsReadme).toContain("rätta framåt");
    expect(migrationsReadme).toContain("verifierad full PostgreSQL-backup");
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

  it("replaces temporary entry uniqueness with a non-unique lifecycle lookup", () => {
    expect(migration).toContain('DROP INDEX "not_competing_decision_entry_uidx"');
    expect(migration).toMatch(
      /CREATE INDEX "not_competing_decision_race_entry_revision_idx"[\s\S]*?ON "not_competing_decision"\("race_id", "entry_id", "created_result_revision", "id"\)/
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "not_competing_decision_race_entry_revision_idx"'
    );
  });

  it("uses exact unique and deferred composite pairing constraints", () => {
    expect(migration).toContain("not_competing_decision_withdrawal_source_tuple_uidx");
    expect(migration).toContain("not_competing_withdrawal_request_uidx");
    expect(migration).toContain("not_competing_withdrawal_decision_uidx");
    expect(migration).toContain("not_competing_withdrawal_result_uidx");
    expect(migration).toContain("not_competing_withdrawal_created_result_uidx");
    expect(migration).toContain("not_competing_withdrawal_decision_fk");
    expect(migration).toContain("not_competing_withdrawal_latest_result_fk");
    expect(migration).toContain("not_competing_withdrawal_restored_from_fk");
    expect(migration).toContain("not_competing_withdrawal_result_pair_fk");
    expect(migration).toContain("result_revision_not_competing_withdrawal_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);
  });

  it("enforces the exact revision chain, policy and withdrawal reason", () => {
    expect(migration).toMatch(
      /"withdrawn_result_revision" = "target_result_revision" \+ 1[\s\S]*?"created_result_revision" = "expected_latest_result_revision" \+ 1/
    );
    expect(migration).toMatch(
      /"restored_from_result_revision" = "target_result_revision"[\s\S]*?OR "restored_from_result_revision" > "withdrawn_result_revision"/
    );
    expect(migration).toContain(
      "CHECK (\"policy_version\" = 'out-of-competition-withdrawal-v1')"
    );
    expect(migration).toContain(
      "CHECK (\"reason\" = 'ERRONEOUS_MANUAL_OUT_OF_COMPETITION')"
    );
  });

  it("requires exclusive null-readout restoration provenance and immutability", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"not_competing_decision_id" IS NULL[\s\S]*?"not_competing_withdrawal_id" IS NOT NULL[\s\S]*?\("status" = 'OK' AND "reason" = 'COMPLETE'\)/
    );
    expect(migration.match(/"not_competing_withdrawal_id" IS NULL/g)).toHaveLength(9);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toContain("CREATE FUNCTION");
  });

  it("is expand-only and contains no history backfill or destructive rollback", () => {
    expect(migration).not.toMatch(/\bUPDATE\s+"result_revision"/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/);
  });
});
