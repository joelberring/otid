import { describe, expect, it } from "vitest";
import {
  iofResultListExportFilename,
  parseFrozenRaceFinalizations,
  parseIofResultListExportMetadata,
  readIofResultListExportAdminCsrf,
  validateFrozenIofResultListResponse
} from "./iof-result-list-export-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const sha256 = "a".repeat(64);
const finalizationId = "10000000-0000-4000-8000-000000000002";

function response(overrides: Record<string, string> = {}) {
  return new Response(null, { headers: {
    etag: `"sha256-${sha256}"`,
    "content-disposition": `attachment; filename="otid-result-list-${raceId}.xml"`,
    "x-otid-content-sha256": sha256,
    "x-otid-race-id": raceId,
    "x-otid-snapshot-version": "7",
    "x-otid-class-count": "2",
    "x-otid-result-count": "3",
    "x-otid-stale-result-count": "1",
    "x-otid-omitted-entry-count": "4",
    ...overrides
  } });
}

describe("TASK 006B exportklient", () => {
  it("binder validerad metadata, ETag och filnamn till loppet", () => {
    expect(parseIofResultListExportMetadata(response(), raceId)).toEqual({
      formatVersion: 1, raceId, snapshotVersion: 7, classCount: 2, resultCount: 3,
      staleResultCount: 1, omittedEntryCount: 4, sha256
    });
    expect(iofResultListExportFilename(response(), raceId)).toBe(`otid-result-list-${raceId}.xml`);
  });

  it("avvisar race-, hash-, heltals- och filnamnsavvikelser", () => {
    expect(() => parseIofResultListExportMetadata(response({ "x-otid-race-id":
      "20000000-0000-4000-8000-000000000002" }), raceId)).toThrow();
    // En proxy som komprimerar ändrar ETag; det ska inte stoppa exporten.
    expect(parseIofResultListExportMetadata(response({ etag: `"sha256-${"a".repeat(64)}-zstd"` }), raceId).sha256).toHaveLength(64);
    expect(() => parseIofResultListExportMetadata(response({ "x-otid-result-count": "03" }), raceId)).toThrow();
    expect(() => iofResultListExportFilename(response({ "content-disposition": "attachment; filename=CANARY.xml" }), raceId)).toThrow();
  });

  it("läser endast exportens miljöbundna och entydiga CSRF-cookie", () => {
    const csrf = "c".repeat(43);
    expect(readIofResultListExportAdminCsrf(
      `otid_result_list_export_csrf=${csrf}; other=value`, new URL("http://127.0.0.1:3000/admin")
    )).toBe(csrf);
    expect(() => readIofResultListExportAdminCsrf(
      `otid_result_list_export_csrf=${csrf}; otid_result_list_export_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin")
    )).toThrow();
  });

  it("validerar fryst finaliseringslista och binder Complete-headers till exakt manifest", () => {
    const finalization = {
      id: finalizationId,
      raceId,
      scope: "RACE" as const,
      classId: null,
      scopeRevision: 2,
      sourceSnapshotVersion: 7,
      basisHash: "b".repeat(64),
      frozenProjectionHash: "c".repeat(64),
      entryCount: 3,
      classCount: 2,
      completeXmlSha256: sha256,
      finalizedAt: "2026-08-31T10:00:00.000Z"
    };
    expect(parseFrozenRaceFinalizations({
      formatVersion: 1,
      raceId,
      finalizations: [finalization]
    }, raceId).finalizations).toEqual([finalization]);

    const completeResponse = new Response(null, { headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="otid-complete-result-list-${raceId}-r2.xml"`,
      etag: `"sha256-${sha256}"`,
      "x-otid-content-sha256": sha256,
      "x-otid-race-id": raceId,
      "x-otid-finalization-id": finalizationId,
      "x-otid-finalization-revision": "2",
      "x-otid-snapshot-version": "7",
      "x-otid-class-count": "2",
      "x-otid-result-count": "3"
    } });
    expect(validateFrozenIofResultListResponse(completeResponse, finalization))
      .toBe(`otid-complete-result-list-${raceId}-r2.xml`);
    completeResponse.headers.set("x-otid-finalization-revision", "3");
    expect(() => validateFrozenIofResultListResponse(completeResponse, finalization)).toThrow();
  });
});
