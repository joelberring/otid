import { describe, expect, it } from "vitest";
import { iofResultListExportAdminErrorResponseSchema, iofResultListExportMetadataSchema } from "../src/iof-result-list-export";

const raceId = "11111111-1111-4111-8111-111111111111";

describe("IOF ResultList-exportkontrakt", () => {

  it("binder bounded metadata och hash utan privata projektioner", () => {
    expect(iofResultListExportMetadataSchema.parse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 4,
      classCount: 2,
      resultCount: 3,
      staleResultCount: 1,
      omittedEntryCount: 7,
      sha256: "b".repeat(64)
    }).resultCount).toBe(3);
    expect(iofResultListExportMetadataSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 4,
      classCount: 2,
      resultCount: 1,
      staleResultCount: 2,
      omittedEntryCount: 0,
      sha256: "b".repeat(64)
    }).success).toBe(false);
  });

  it("avvisar okända fält och tillåter detaljfria exportfel", () => {
    expect(iofResultListExportMetadataSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 1,
      classCount: 0,
      resultCount: 0,
      staleResultCount: 0,
      omittedEntryCount: 0,
      sha256: "c".repeat(64),
      names: []
    }).success).toBe(false);
    expect(iofResultListExportAdminErrorResponseSchema.parse({
      formatVersion: 1,
      error: "CONFLICT"
    }).error).toBe("CONFLICT");
  });
});
