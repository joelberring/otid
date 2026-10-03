import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manualFinishTimeCorrections, resultRevisions, revisionCauseEnum } from "../src/schema";

const migration = readFileSync(
  new URL("../migrations/0058_task_093_manual_finish_time_correction.sql", import.meta.url),
  "utf8"
);
const provenanceMigration = readFileSync(
  new URL("../migrations/0059_task_093_manual_finish_time_provenance.sql", import.meta.url),
  "utf8"
);
const journal = JSON.parse(readFileSync(
  new URL("../migrations/meta/_journal.json", import.meta.url),
  "utf8"
)) as { entries?: Array<{ idx: number; tag: string }> };

describe("TASK093 database schema", () => {
  it("registers the additive migration and explicit revision cause", () => {
    expect(journal.entries?.find((entry) => entry.idx === 58)).toMatchObject({ idx: 58, tag: "0058_task_093_manual_finish_time_correction" });
    expect(journal.entries?.find((entry) => entry.idx === 59)).toMatchObject({ idx: 59, tag: "0059_task_093_manual_finish_time_provenance" });
    expect(revisionCauseEnum.enumValues).toContain("MANUAL_FINISH_TIME_CORRECTION");
    expect(migration).toContain("ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'MANUAL_FINISH_TIME_CORRECTION'");
  });

  it("keeps immutable source, actor, finish times and reciprocal revision provenance", () => {
    expect(resultRevisions.manualFinishTimeCorrectionId.name).toBe("manual_finish_time_correction_id");
    expect(manualFinishTimeCorrections.sourceResultRevisionId.name).toBe("source_result_revision_id");
    expect(manualFinishTimeCorrections.sourceReadoutId.name).toBe("source_readout_id");
    expect(manualFinishTimeCorrections.sourceFinishTime.name).toBe("source_finish_time");
    expect(manualFinishTimeCorrections.correctedFinishTime.name).toBe("corrected_finish_time");
    expect(manualFinishTimeCorrections.createdResultRevisionId.name).toBe("created_result_revision_id");
    expect(migration).toContain("manual_finish_time_correction_result_pair_fk");
    expect(migration).toContain("result_revision_manual_finish_time_correction_pair_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(2);
  });

  it("allows only the explicit correction cause with an exclusive journal reference", () => {
    expect(migration).toMatch(
      /cause::text = 'MANUAL_FINISH_TIME_CORRECTION'[\s\S]*?readout_id IS NULL[\s\S]*?manual_finish_time_correction_id IS NOT NULL/
    );
    expect(migration).toMatch(
      /cause::text <> 'MANUAL_FINISH_TIME_CORRECTION'[\s\S]*?manual_finish_time_correction_id IS NULL/
    );
    expect(migration).toContain("manual_finish_time_correction_immutable");
    expect(migration).not.toMatch(/\bUPDATE\s+result_revision\b/i);
    expect(migration).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE)\b/i);
    expect(provenanceMigration).toContain("MANUAL_FINISH_TIME_CORRECTION");
    expect(provenanceMigration).toContain("result_revision_source_provenance_check");
  });
});
