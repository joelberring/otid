import { describe, expect, it } from "vitest";
import {
  iofResultListExportAdminErrorResponseSchema,
  iofResultListExportAdminLoginRequestSchema,
  iofResultListExportAdminLoginResponseSchema,
  iofResultListExportMetadataSchema
} from "../src/iof-result-list-export";

const raceId = "11111111-1111-4111-8111-111111111111";
const credentialId = "22222222-2222-4222-8222-222222222222";
const credential = `otid_org_result_list_export_v1.${credentialId}.${"a".repeat(43)}`;

describe("IOF ResultList-exportkontrakt", () => {
  it("accepterar endast den separata capabilityns canonical credential och svar", () => {
    expect(iofResultListExportAdminLoginRequestSchema.parse({
      formatVersion: 1,
      accessCredential: credential
    }).accessCredential).toBe(credential);
    expect(iofResultListExportAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: credential.replace("result_list_export", "race_overview")
    }).success).toBe(false);
    expect(iofResultListExportAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      expiresAt: "2026-08-31T12:00:00.000Z"
    }).raceId).toBe(raceId);
  });

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
