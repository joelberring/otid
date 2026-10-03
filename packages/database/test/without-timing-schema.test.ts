import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum,
  withoutTimingDecisions
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0022_task_006m_explicit_without_timing.sql", import.meta.url),
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

describe("TASK 006M database schema", () => {
  it("uses a separate bounded capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_WITHOUT_TIMING");
    expect(auditActorKindEnum.enumValues).toContain("WITHOUT_TIMING_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_WITHOUT_TIMING");
    expect(migration).toMatch(
      /"capability"::text <> 'DECIDE_WITHOUT_TIMING'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });

  it("registers migration 0022 and documents forward-only restoration", () => {
    expect(journal.entries?.find((entry) => entry.idx === 22)).toMatchObject({
      idx: 22,
      tag: "0022_task_006m_explicit_without_timing"
    });
    expect(migrationsReadme).toContain("0022_task_006m_explicit_without_timing.sql");
    expect(migrationsReadme).toContain("rätta framåt med en additiv migration");
    expect(migrationsReadme).toContain("verifierad full PostgreSQL-backup");
  });

  it("freezes exact intent, target and reciprocal NT revision", () => {
    expect(resultRevisions.withoutTimingDecisionId.name).toBe("without_timing_decision_id");
    expect(withoutTimingDecisions.expectedEntryVersion.name).toBe("expected_entry_version");
    expect(withoutTimingDecisions.expectedClassId.name).toBe("expected_class_id");
    expect(withoutTimingDecisions.expectedCourseVersionId.name).toBe("expected_course_version_id");
    expect(withoutTimingDecisions.expectedSnapshotVersion.name).toBe("expected_snapshot_version");
    expect(withoutTimingDecisions.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(withoutTimingDecisions.targetResultRevision.name).toBe("target_result_revision");
    expect(withoutTimingDecisions.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(withoutTimingDecisions.createdResultRevision.name).toBe("created_result_revision");
    expect(withoutTimingDecisions).not.toHaveProperty("readoutId");
  });

  it("uses entry uniqueness and exact reciprocal deferred pairs", () => {
    expect(migration).toContain("without_timing_decision_request_uidx");
    expect(migration).toContain("without_timing_decision_entry_uidx");
    expect(migration).toContain("without_timing_decision_target_uidx");
    expect(migration).toContain("without_timing_decision_created_result_uidx");
    expect(migration).toContain("without_timing_decision_target_fk");
    expect(migration).toContain("without_timing_decision_result_pair_fk");
    expect(migration).toContain("result_revision_without_timing_decision_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(3);
  });

  it("locks policy, NT status, reason and revision chain exactly", () => {
    expect(migration).toContain("CHECK (\"policy_version\" = 'without-timing-v1')");
    expect(migration).toContain(
      "CHECK (\"status\" = 'NT' AND \"reason\" = 'WITHOUT_TIMING')"
    );
    expect(migration).toMatch(
      /"created_result_revision" = "target_result_revision" \+ 1/
    );
    expect(migration).toMatch(
      /"target_result_revision_id" <> "created_result_revision_id"/
    );
  });

  it("requires exclusive null-readout NT provenance without target business rules", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_WITHOUT_TIMING'[\s\S]*?"readout_id" IS NULL[\s\S]*?"without_timing_decision_id" IS NOT NULL/
    );
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_WITHOUT_TIMING'[\s\S]*?"status" = 'NT'[\s\S]*?"reason" = 'WITHOUT_TIMING'/
    );
    expect(migration).toContain("num_nonnulls(");
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?VIEW/i);
  });

  it("uses the generic immutable trigger and remains expand-only", () => {
    expect(migration).toContain("without_timing_decision_immutable");
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toMatch(/\bUPDATE\s+"result_revision"/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/);
  });
});
