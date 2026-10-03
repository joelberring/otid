import { describe, expect, it } from "vitest";
import {
  shortenedCourseClassTransferCandidateSchema,
  shortenedCourseClassTransferIdempotencyKeySchema,
  shortenedCourseClassTransferPreviewRequestSchema,
  shortenedCourseClassTransferReceiptSchema,
  shortenedCourseClassTransferRequestSchema
} from "../src/shortened-course-class-transfer";

const id = (value: string) => `${value.padStart(8, "0")}-0000-4000-8000-000000000000`;
const ids = { race: id("1"), sourceClass: id("2"), sourceCourse: id("3"), sourceVersion: id("4"), entry: id("5"), entry2: id("6"),
  control: id("7"), control2: id("8"), request: id("9"), result: id("a"), readout: id("b"), shortCourse: id("c"), shortVersion: id("d"), shortClass: id("e") };
const hash = "a".repeat(64);
const controls = [{ courseControlId: ids.control, sequence: 1, controlCode: 31 }, { courseControlId: ids.control2, sequence: 2, controlCode: 32 }];
const request = { formatVersion: 1 as const, requestId: ids.request, sourceClassId: ids.sourceClass,
  expectedSourceCourseVersionId: ids.sourceVersion, expectedSourceStartRule: "FIXED" as const,
  expectedSnapshotVersion: 4, expectedBasisHash: hash, expectedSourceControlCount: 2, shortCourseName: "Kort H21", shortClassName: "H21 kort",
  controlPrefix: [controls[0]!], entryIds: [ids.entry] };

describe("TASK135 shortened course class transfer contracts", () => {
  it("keeps preview source order, only genuine source states, and start-time basis strict", () => {
    expect(shortenedCourseClassTransferPreviewRequestSchema.parse({ formatVersion: 1, sourceClassId: ids.sourceClass })).toBeTruthy();
    const candidate = { formatVersion: 1, raceId: ids.race, sourceClassId: ids.sourceClass, sourceClassName: "H21",
      sourceCourseId: ids.sourceCourse, sourceCourseName: "Långa", sourceCourseVersionId: ids.sourceVersion,
      sourceCourseVersion: 1, sourceStartRule: "FIXED" as const, snapshotVersion: 4, basisHash: hash, sourceControls: controls,
      entries: [{ entryId: ids.entry, entryVersion: 2, displayName: "Ada Löpare", startRule: "FIXED" as const,
        fixedStartTime: "2026-09-22T10:00:00.000Z", sourceResult: { kind: "NO_RESULT" as const } },
      { entryId: ids.entry2, entryVersion: 3, displayName: "Bo Löpare", startRule: "FIXED" as const,
        fixedStartTime: "2026-09-22T10:02:00.000Z", sourceResult: { kind: "CARD_READOUT_MP" as const,
          resultRevisionId: ids.result, resultRevision: 1, readoutId: ids.readout, snapshotVersion: 4,
          courseVersionId: ids.sourceVersion, status: "MP" as const, cause: "CARD_READOUT" as const, published: true as const } }] };
    expect(shortenedCourseClassTransferCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(shortenedCourseClassTransferCandidateSchema.safeParse({ ...candidate, sourceControls: [...controls].reverse() }).success).toBe(false);
    expect(shortenedCourseClassTransferCandidateSchema.safeParse({ ...candidate, entries: [{ ...candidate.entries[0]!, fixedStartTime: null }] }).success).toBe(false);
    expect(shortenedCourseClassTransferCandidateSchema.safeParse({ ...candidate, extra: true }).success).toBe(false);
  });

  it("requires a strict proper prefix and a canonical bounded selected entry manifest", () => {
    expect(shortenedCourseClassTransferRequestSchema.parse(request)).toEqual(request);
    expect(shortenedCourseClassTransferRequestSchema.safeParse({ ...request, controlPrefix: controls }).success).toBe(false);
    expect(shortenedCourseClassTransferRequestSchema.safeParse({ ...request, entryIds: [ids.entry2, ids.entry] }).success).toBe(false);
    expect(shortenedCourseClassTransferRequestSchema.safeParse({ ...request, entryIds: Array.from({ length: 101 }, () => ids.entry) }).success).toBe(false);
    expect(shortenedCourseClassTransferIdempotencyKeySchema.parse(`shortened-course-class-transfer:${ids.request}`)).toBeTruthy();
  });

  it("binds the receipt to the exact intent and forbids fabricated result effects", () => {
    const receipt = { formatVersion: 1, replayed: false, requestId: ids.request, transferId: ids.request, raceId: ids.race,
      sourceClassId: ids.sourceClass, sourceCourseVersionId: ids.sourceVersion, shortCourseId: ids.shortCourse,
      shortCourseVersionId: ids.shortVersion, shortClassId: ids.shortClass, sourceSnapshotVersion: 4, snapshotVersionAfter: 5,
      sourceBasisHash: hash, request, transferredAt: "2026-09-22T11:00:00.000Z",
      items: [{ entryId: ids.entry, entryVersionBefore: 2, entryVersionAfter: 3, effect: "MOVED_ONLY" as const,
        sourceResultRevisionId: null, sourceReadoutId: null, createdResultRevisionId: null, createdResultRevision: null, resultingStatus: null }] };
    expect(shortenedCourseClassTransferReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(shortenedCourseClassTransferReceiptSchema.safeParse({ ...receipt, items: [{ ...receipt.items[0]!, resultingStatus: "MP" }] }).success).toBe(false);
    expect(shortenedCourseClassTransferReceiptSchema.safeParse({ ...receipt, snapshotVersionAfter: 6 }).success).toBe(false);
  });
});
