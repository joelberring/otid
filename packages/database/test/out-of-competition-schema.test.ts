import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  notCompetingDecisions,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0020_task_006k_explicit_out_of_competition.sql", import.meta.url),
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

describe("TASK 006K database schema", () => {
  it("uses a separate bounded capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_OUT_OF_COMPETITION");
    expect(auditActorKindEnum.enumValues).toContain("OUT_OF_COMPETITION_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_OUT_OF_COMPETITION");
    expect(migration).toMatch(
      /"capability"::text <> 'DECIDE_OUT_OF_COMPETITION'[\s\S]*?"expires_at" <= "issued_at" \+ interval '8 hours'/
    );
  });

  it("registers migration 0020 and documents forward-only restoration", () => {
    expect(journal.entries?.find((entry) => entry.idx === 20)).toMatchObject({
      idx: 20,
      tag: "0020_task_006k_explicit_out_of_competition"
    });
    expect(migrationsReadme).toContain("0020_task_006k_explicit_out_of_competition.sql");
    expect(migrationsReadme).toContain("rätta framåt med en additiv migration");
    expect(migrationsReadme).toContain("verifierad full PostgreSQL-backup");
  });

  it("freezes exact intent, technical target and reciprocal OOC revision", () => {
    expect(resultRevisions.notCompetingDecisionId.name).toBe("not_competing_decision_id");
    expect(notCompetingDecisions.expectedEntryVersion.name).toBe("expected_entry_version");
    expect(notCompetingDecisions.expectedClassId.name).toBe("expected_class_id");
    expect(notCompetingDecisions.expectedCourseVersionId.name).toBe("expected_course_version_id");
    expect(notCompetingDecisions.expectedSnapshotVersion.name).toBe("expected_snapshot_version");
    expect(notCompetingDecisions.targetResultRevisionId.name).toBe("target_result_revision_id");
    expect(notCompetingDecisions.targetResultRevision.name).toBe("target_result_revision");
    expect(notCompetingDecisions.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(notCompetingDecisions.createdResultRevision.name).toBe("created_result_revision");
    expect(notCompetingDecisions).not.toHaveProperty("readoutId");
  });

  it("uses temporary entry uniqueness and exact reciprocal deferred pairs", () => {
    expect(migration).toContain("not_competing_decision_request_uidx");
    expect(migration).toContain("not_competing_decision_entry_uidx");
    expect(migration).toContain("not_competing_decision_target_uidx");
    expect(migration).toContain("not_competing_decision_created_result_uidx");
    expect(migration).toContain("not_competing_decision_target_fk");
    expect(migration).toContain("not_competing_decision_result_pair_fk");
    expect(migration).toContain("result_revision_not_competing_decision_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(3);
  });

  it("locks policy, OOC status, reason and revision chain exactly", () => {
    expect(migration).toContain("CHECK (\"policy_version\" = 'out-of-competition-v1')");
    expect(migration).toContain(
      "CHECK (\"status\" = 'OOC' AND \"reason\" = 'OUT_OF_COMPETITION')"
    );
    expect(migration).toMatch(
      /"created_result_revision" = "target_result_revision" \+ 1/
    );
    expect(migration).toMatch(
      /"target_result_revision_id" <> "created_result_revision_id"/
    );
  });

  it("requires exclusive null-readout OOC provenance and generic immutability", () => {
    expect(migration).toMatch(
      /"cause"::text = 'MANUAL_OUT_OF_COMPETITION'[\s\S]*?"readout_id" IS NULL[\s\S]*?"not_competing_decision_id" IS NOT NULL[\s\S]*?"status" = 'OOC'[\s\S]*?"reason" = 'OUT_OF_COMPETITION'/
    );
    expect(migration.match(/"not_competing_decision_id" IS NULL/g)).toHaveLength(8);
    expect(migration.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(1);
    expect(migration).not.toContain("CREATE FUNCTION");
  });

  it("is expand-only and contains no backfill or destructive history rollback", () => {
    expect(migration).not.toMatch(/\bUPDATE\s+"result_revision"/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/);
  });
});
