import { describe, expect, it } from "vitest";
import {
  auditActorKindEnum,
  notCompetingDecisions,
  pairingAdminCapabilityEnum,
  resultRevisions,
  revisionCauseEnum
} from "../src/schema";

describe("TASK 006K database schema", () => {
  it("uses a separate bounded capability, actor and revision cause", () => {
    expect(pairingAdminCapabilityEnum.enumValues).toContain("DECIDE_OUT_OF_COMPETITION");
    expect(auditActorKindEnum.enumValues).toContain("OUT_OF_COMPETITION_ACCESS_CREDENTIAL");
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_OUT_OF_COMPETITION");
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
});
