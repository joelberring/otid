import { describe, expect, it } from "vitest";
import { manualFinishTimeCorrections, resultRevisions, revisionCauseEnum } from "../src/schema";

describe("TASK093 database schema", () => {
  it("registers the additive migration and explicit revision cause", () => {
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_FINISH_TIME_CORRECTION");
  });

  it("keeps immutable source, actor, finish times and reciprocal revision provenance", () => {
    expect(resultRevisions.manualFinishTimeCorrectionId.name).toBe("manual_finish_time_correction_id");
    expect(manualFinishTimeCorrections.sourceResultRevisionId.name).toBe("source_result_revision_id");
    expect(manualFinishTimeCorrections.sourceReadoutId.name).toBe("source_readout_id");
    expect(manualFinishTimeCorrections.sourceFinishTime.name).toBe("source_finish_time");
    expect(manualFinishTimeCorrections.correctedFinishTime.name).toBe("corrected_finish_time");
    expect(manualFinishTimeCorrections.createdResultRevisionId.name).toBe("created_result_revision_id");
  });
});
