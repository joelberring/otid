import { describe, expect, it } from "vitest";
import { resultRevisions, revisionCauseEnum } from "../src/schema";

describe("steg 23: ett statusflöde i result_revision (ADR-0173 beslut 1)", () => {
  it("bär beslut och återtaganden som orsaker, inte som egna journaler", () => {
    for (const cause of ["MANUAL_DID_NOT_START", "MANUAL_DID_NOT_START_WITHDRAWAL", "MANUAL_DISQUALIFICATION",
      "MANUAL_DISQUALIFICATION_WITHDRAWAL", "MANUAL_RESULT_APPROVAL", "MANUAL_DID_NOT_FINISH", "MANUAL_OUT_OF_COMPETITION",
      "MANUAL_WITHOUT_TIMING", "MANUAL_FINISH_TIME_CORRECTION", "MANUAL_PUNCH_START_TIME_CORRECTION"]) {
      expect(revisionCauseEnum.enumValues).toContain(cause);
    }
    expect(resultRevisions).not.toHaveProperty("disqualificationDecisionId");
    expect(resultRevisions).not.toHaveProperty("manualFinishTimeCorrectionId");
  });

  it("sparar begärans-id och aktör på revisionen", () => {
    expect(resultRevisions.requestId.name).toBe("request_id");
    expect(resultRevisions.actorAccountId.name).toBe("actor_account_id");
  });
});
