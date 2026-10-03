import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum,
  withoutTimingWithdrawals
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0023_task_006n_without_timing_withdrawal.sql", import.meta.url),
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

describe("TASK 006N database schema", () => {
  it("uses a separate bounded withdrawal capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("WITHDRAW_WITHOUT_TIMING");
    expect(auditActorKindEnum.enumValues)
      .toContain("WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_WITHOUT_TIMING_WITHDRAWAL");
    expect(migration).toMatch(
      /"capability"::text <> 'WITHDRAW_WITHOUT_TIMING'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });

  it("registers migration 0023 and documents forward-only restoration", () => {
    expect(journal.entries?.find((entry) => entry.idx === 23)).toMatchObject({
      idx: 23,
      tag: "0023_task_006n_without_timing_withdrawal"
    });
    expect(migrationsReadme).toContain("0023_task_006n_without_timing_withdrawal.sql");
    expect(migrationsReadme).toContain("rätta framåt");
    expect(migrationsReadme).toContain("verifierad full PostgreSQL-backup");
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

  it("replaces temporary entry uniqueness with a non-unique lifecycle lookup", () => {
    expect(migration).toContain('DROP INDEX "without_timing_decision_entry_uidx"');
    expect(migration).toMatch(
      /CREATE INDEX "without_timing_decision_race_entry_revision_idx"[\s\S]*?ON "without_timing_decision"\("race_id", "entry_id", "created_result_revision", "id"\)/
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "without_timing_decision_race_entry_revision_idx"'
    );
  });

  it("uses exact unique and deferred composite pairing constraints", () => {
    expect(migration).toContain("without_timing_decision_withdrawal_source_tuple_uidx");
    expect(migration).toContain("without_timing_withdrawal_request_uidx");
    expect(migration).toContain("without_timing_withdrawal_decision_uidx");
    expect(migration).toContain("without_timing_withdrawal_result_uidx");
    expect(migration).toContain("without_timing_withdrawal_created_result_uidx");
    expect(migration).toContain("without_timing_withdrawal_decision_fk");
    expect(migration).toContain("without_timing_withdrawal_latest_result_fk");
    expect(migration).toContain("without_timing_withdrawal_restored_from_fk");
    expect(migration).toContain("without_timing_withdrawal_result_pair_fk");
    expect(migration).toContain("result_revision_without_timing_withdrawal_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);
  });

  it("locks the exact revision chain, policy and withdrawal reason", () => {
    expect(migration).toMatch(
      /"withdrawn_result_revision" = "target_result_revision" \+ 1[\s\S]*?"created_result_revision" = "expected_latest_result_revision" \+ 1/
    );
    expect(migration).toMatch(
      /"restored_from_result_revision" = "target_result_revision"[\s\S]*?OR "restored_from_result_revision" > "withdrawn_result_revision"/
    );
    expect(migration).toContain(
      "CHECK (\"policy_version\" = 'without-timing-withdrawal-v1')"
    );
    expect(migration).toContain(
      "CHECK (\"reason\" = 'ERRONEOUS_MANUAL_WITHOUT_TIMING')"
    );
  });

  it("requires exclusive null-readout restoration provenance for technical OK or MP", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_WITHOUT_TIMING_WITHDRAWAL'[\s\S]*?"readout_id" IS NULL[\s\S]*?"without_timing_withdrawal_id" IS NOT NULL/
    );
    expect(migration).toMatch(
      /'MANUAL_WITHOUT_TIMING_WITHDRAWAL'\)[\s\S]*?\("status" = 'OK' AND "reason" = 'COMPLETE'\)[\s\S]*?"status" = 'MP'/
    );
    expect(migration).toContain("num_nonnulls(");
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?VIEW/i);
  });

  it("uses the generic immutable trigger and leaves historical rows untouched", () => {
    expect(migration).toContain("without_timing_withdrawal_immutable");
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toMatch(/\bUPDATE\s+"result_revision"/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/);
  });
});
