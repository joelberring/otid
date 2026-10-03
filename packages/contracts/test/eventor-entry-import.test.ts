import { describe, expect, it } from "vitest";
import {
  eventorEntryImportCommitRequestSchema, eventorEntryImportIdempotencyKeySchema,
  eventorEntryImportPreviewResponseSchema, eventorEntryImportResponseSchema,
} from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);

describe("Eventor entry import contracts", () => {
  it("requires hash-bound explicit one-to-one class mappings", () => {
    const request = { formatVersion: 1, grantId: id, eventClassesSourceHash: hash, entriesSourceHash: hash,
      mappings: [{ externalClassId: "D21", classId: id.replace("001", "002") }] };
    expect(eventorEntryImportCommitRequestSchema.parse(request)).toEqual(request);
    for (const invalid of [
      { ...request, mappings: [] },
      { ...request, mappings: [...request.mappings, ...request.mappings] },
      { ...request, mappings: [...request.mappings, { externalClassId: "H21", classId: request.mappings[0]!.classId }] },
      { ...request, apiKey: "secret" },
      { ...request, entriesSourceHash: "A".repeat(64) },
    ]) expect(eventorEntryImportCommitRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps previews and receipts aggregate-only and enforces accounting", () => {
    const preview = { formatVersion: 2, grantId: id, environment: "testeventor-se", eventClassesSourceHash: hash, entriesSourceHash: hash,
      entriesCount: 2, sourceClasses: [{ externalClassId: "D21", name: "Damer 21", entryCount: 2 }],
      targetClasses: [{ classId: id.replace("001", "002"), name: "Damer 21" }] };
    expect(eventorEntryImportPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(eventorEntryImportPreviewResponseSchema.parse({ ...preview, environment: "production-se" }).environment).toBe("production-se");
    expect(eventorEntryImportPreviewResponseSchema.safeParse({ ...preview, entriesCount: 1 }).success).toBe(false);
    for (const invalid of [
      { ...preview, formatVersion: 1 },
      { ...preview, environment: undefined },
      { ...preview, environment: "other" },
      { ...preview, apiKey: "private" },
      { ...preview, origin: "https://eventor.orientering.se" },
    ]) expect(eventorEntryImportPreviewResponseSchema.safeParse(invalid).success).toBe(false);
    const receipt = { formatVersion: 1, replayed: false, requestId: id, raceId: id.replace("001", "002"), grantId: id,
      eventClassesSourceHash: hash, entriesSourceHash: hash, entriesSeen: 2, entriesCreated: 1, entriesUnchanged: 1,
      snapshotVersionBefore: 3, snapshotVersionAfter: 4, createdAt: "2026-09-19T10:00:00Z" };
    expect(eventorEntryImportResponseSchema.parse(receipt)).toEqual(receipt);
    expect(eventorEntryImportResponseSchema.safeParse({ ...receipt, entriesCreated: 2 }).success).toBe(false);
    expect(eventorEntryImportResponseSchema.safeParse({ ...receipt, names: ["private"] }).success).toBe(false);
  });

  it("isolates retry keys from other Eventor operations", () => {
    expect(eventorEntryImportIdempotencyKeySchema.parse(`eventor-entry-import:${id}`)).toBe(`eventor-entry-import:${id}`);
    expect(eventorEntryImportIdempotencyKeySchema.safeParse(`eventor-import:${id}`).success).toBe(false);
  });
});
