import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum,
  withoutTimingDecisions
} from "../src/schema";

describe("TASK 006M database schema", () => {
  it("uses a separate bounded capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_WITHOUT_TIMING");
    expect(auditActorKindEnum.enumValues).toContain("WITHOUT_TIMING_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_WITHOUT_TIMING");
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
});
