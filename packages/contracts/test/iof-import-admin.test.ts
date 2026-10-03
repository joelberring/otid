import { describe, expect, it } from "vitest";
import {
  IOF_IMPORT_MAX_BYTES,
  iofImportErrorResponseSchema,
  iofImportIdempotencyKeySchema,
  iofImportLoginRequestSchema,
  iofImportLoginResponseSchema,
  iofImportResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "20000000-0000-4000-8000-000000000002";
const importFileId = "30000000-0000-4000-8000-000000000003";

describe("TASK 005G IOF-importkontrakt", () => {
  it("separerar importcredential och race-scopad login från pairing", () => {
    const request = {
      formatVersion: 1 as const,
      accessCredential: `otid_org_import_v1.${requestId}.${"A".repeat(43)}`
    };
    expect(iofImportLoginRequestSchema.parse(request)).toEqual(request);
    expect(iofImportLoginRequestSchema.safeParse({
      ...request,
      accessCredential: request.accessCredential.replace("otid_org_import_v1", "otid_org_pair_v1")
    }).success).toBe(false);
    expect(iofImportLoginRequestSchema.safeParse({ ...request, raceId }).success).toBe(false);
    expect(iofImportLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "IMPORT_IOF",
      expiresAt: "2026-08-31T11:00:00.000Z"
    }).capability).toBe("IMPORT_IOF");
    expect(iofImportLoginResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      capability: "PAIR_STATION",
      expiresAt: "2026-08-31T11:00:00.000Z"
    }).success).toBe(false);
  });

  it("kräver exakt content-oberoende request-UUID i idempotensnyckeln", () => {
    expect(iofImportIdempotencyKeySchema.parse(`iof-import:${requestId}`)).toBe(`iof-import:${requestId}`);
    expect(iofImportIdempotencyKeySchema.safeParse(requestId).success).toBe(false);
    expect(iofImportIdempotencyKeySchema.safeParse(`iof-import:${requestId.toUpperCase()}`).success).toBe(false);
    expect(iofImportIdempotencyKeySchema.safeParse(`iof-import:${requestId}:extra`).success).toBe(false);
  });

  it("validerar stored/replayed CourseData-resultat strikt", () => {
    const response = {
      formatVersion: 1 as const,
      status: "stored" as const,
      replayed: false,
      requestId,
      raceId,
      importFileId,
      contentHash: "a".repeat(64),
      byteCount: 2048,
      report: {
        kind: "CourseData" as const,
        warnings: ["Startregel saknas; PUNCH används"],
        imported: { courses: 2, classes: 3 }
      }
    };
    expect(iofImportResponseSchema.parse(response)).toEqual(response);
    expect(iofImportResponseSchema.parse({ ...response, replayed: true }).status).toBe("stored");
    expect(iofImportResponseSchema.safeParse({ ...response, originalXml: "<CourseData/>" }).success).toBe(false);
    expect(iofImportResponseSchema.safeParse({ ...response, byteCount: IOF_IMPORT_MAX_BYTES + 1 }).success).toBe(false);
  });

  it("validerar content-duplicate EntryList och stabila detaljfria fel", () => {
    const response = {
      formatVersion: 1,
      status: "duplicate",
      replayed: false,
      requestId,
      raceId,
      importFileId,
      contentHash: "b".repeat(64),
      byteCount: 1024,
      report: { kind: "EntryList", warnings: [], imported: { entries: 42 } }
    };
    expect(iofImportResponseSchema.parse(response)).toEqual(response);
    expect(iofImportResponseSchema.safeParse({
      ...response,
      report: { kind: "EntryList", warnings: [], imported: { entries: 42, names: ["Ada"] } }
    }).success).toBe(false);
    for (const error of [
      "UNAUTHORIZED", "FORBIDDEN", "INVALID_REQUEST", "INVALID_IOF_XML", "CONFLICT", "INTERNAL_ERROR"
    ]) {
      expect(iofImportErrorResponseSchema.parse({ formatVersion: 1, error })).toEqual({ formatVersion: 1, error });
    }
    expect(iofImportErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "INVALID_IOF_XML",
      details: "XML-innehåll"
    }).success).toBe(false);
  });

  it("validerar StartList-rapportens avgränsade mutationssammanfattning strikt", () => {
    const response = {
      formatVersion: 1 as const,
      status: "stored" as const,
      replayed: false,
      requestId,
      raceId,
      importFileId,
      contentHash: "c".repeat(64),
      byteCount: 1536,
      report: {
        kind: "StartList" as const,
        warnings: [],
        imported: { classes: 2, entries: 42 },
        changed: { classes: 1, entries: 3 },
        resultsRequiringRecalculation: 2,
        snapshotChanged: true
      }
    };
    expect(iofImportResponseSchema.parse(response)).toEqual(response);
    expect(iofImportResponseSchema.safeParse({
      ...response,
      report: { ...response.report, changed: { classes: 1 } }
    }).success).toBe(false);
    expect(iofImportResponseSchema.safeParse({
      ...response,
      report: { ...response.report, resultsRequiringRecalculation: -1 }
    }).success).toBe(false);
    expect(iofImportResponseSchema.safeParse({
      ...response,
      report: { ...response.report, snapshotChanged: "true" }
    }).success).toBe(false);
  });
});
