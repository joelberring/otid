import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJsonBytes } from "@o-tid/contracts";
import type {
  StoredResultRevision,
  StoredShortenedCourseClassTransferProof
} from "../src/stored-result-revision";
import {
  parseStrictStoredResultRevision,
  StoredResultRevisionConflict
} from "../src/stored-result-revision";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  sourceClass: "30000000-0000-4000-8000-000000000003",
  sourceCourse: "40000000-0000-4000-8000-000000000004",
  sourceCourseVersion: "50000000-0000-4000-8000-000000000005",
  firstControl: "60000000-0000-4000-8000-000000000006",
  secondControl: "70000000-0000-4000-8000-000000000007",
  readout: "80000000-0000-4000-8000-000000000008",
  sourceResult: "90000000-0000-4000-8000-000000000009",
  request: "a0000000-0000-4000-8000-000000000010",
  shortCourse: "b0000000-0000-4000-8000-000000000011",
  shortCourseVersion: "c0000000-0000-4000-8000-000000000012",
  shortClass: "d0000000-0000-4000-8000-000000000013",
  createdResult: "e0000000-0000-4000-8000-000000000014"
} as const;

const sourceOutcome = {
  status: "MP" as const,
  reason: "MISSING_CONTROL" as const,
  entryId: ids.entry,
  classId: ids.sourceClass,
  courseVersionId: ids.sourceCourseVersion,
  startTime: "2026-09-22T12:00:00.000Z",
  finishTime: "2026-09-22T12:20:00.000Z",
  elapsedMs: 1_200_000,
  missingControls: [42],
  extraPunches: [],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 300_000 }]
};

const createdOutcome = {
  status: "OK" as const,
  reason: "COMPLETE" as const,
  entryId: ids.entry,
  classId: ids.shortClass,
  courseVersionId: ids.shortCourseVersion,
  startTime: "2026-09-22T12:00:00.000Z",
  finishTime: "2026-09-22T12:20:00.000Z",
  elapsedMs: 1_200_000,
  missingControls: [],
  extraPunches: [],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 300_000 }]
};

const source: StoredResultRevision = {
  id: ids.sourceResult, raceId: ids.race, entryId: ids.entry, readoutId: ids.readout,
  didNotStartDecisionId: null, startCheckinDnsDecisionId: null, controlNeutralizationId: null,
  disqualificationDecisionId: null, disqualificationWithdrawalId: null,
  approvalDecisionId: null, approvalWithdrawalId: null,
  didNotFinishDecisionId: null, didNotFinishWithdrawalId: null,
  notCompetingDecisionId: null, notCompetingWithdrawalId: null,
  withoutTimingDecisionId: null, withoutTimingWithdrawalId: null,
  manualFinishTimeCorrectionId: null, manualFinishTimeCorrectionWithdrawalId: null,
  manualPunchStartTimeCorrectionId: null, manualPunchStartTimeCorrectionWithdrawalId: null,
  shortenedCourseClassTransferId: null,
  revision: 1, cause: "CARD_READOUT", status: "MP", reason: "MISSING_CONTROL",
  evaluation: sourceOutcome, engineVersion: "result-engine-v1", snapshotVersion: 1,
  courseVersionId: ids.sourceCourseVersion, published: true,
  createdAt: new Date("2026-09-22T12:21:00.000Z")
};

const created: StoredResultRevision = {
  ...source,
  id: ids.createdResult,
  revision: 2,
  cause: "SHORTENED_COURSE_CLASS_TRANSFER",
  status: "OK",
  reason: "COMPLETE",
  evaluation: createdOutcome,
  snapshotVersion: 2,
  courseVersionId: ids.shortCourseVersion,
  shortenedCourseClassTransferId: ids.request,
  createdAt: new Date("2026-09-22T12:22:00.000Z")
};

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function proof(): StoredShortenedCourseClassTransferProof {
  const controlPrefix = [{ courseControlId: ids.firstControl, sequence: 1, controlCode: 31 }];
  const semantic = {
    formatVersion: 1 as const,
    raceId: ids.race,
    sourceClassId: ids.sourceClass,
    sourceClassName: "Öppen",
    sourceCourseId: ids.sourceCourse,
    sourceCourseName: "Långa",
    sourceCourseVersionId: ids.sourceCourseVersion,
    sourceCourseVersion: 1,
    sourceStartRule: "PUNCH" as const,
    snapshotVersion: 1,
    sourceControls: [...controlPrefix, { courseControlId: ids.secondControl, sequence: 2, controlCode: 42 }],
    entries: [{
      entryId: ids.entry,
      entryVersion: 1,
      displayName: "Ada Exempel",
      startRule: "PUNCH" as const,
      fixedStartTime: null,
      sourceResult: {
        kind: "CARD_READOUT_MP" as const,
        resultRevisionId: ids.sourceResult,
        resultRevision: 1,
        readoutId: ids.readout,
        snapshotVersion: 1,
        courseVersionId: ids.sourceCourseVersion,
        status: "MP" as const,
        cause: "CARD_READOUT" as const,
        published: true as const
      }
    }]
  };
  const frozenBasis = { kind: "SHORTENED_COURSE_CLASS_TRANSFER_BASIS", semantic };
  const sourceHash = hash(frozenBasis);
  const request = {
    formatVersion: 1 as const,
    requestId: ids.request,
    sourceClassId: ids.sourceClass,
    expectedSourceCourseVersionId: ids.sourceCourseVersion,
    expectedSourceStartRule: "PUNCH" as const,
    expectedSnapshotVersion: 1,
    expectedBasisHash: sourceHash,
    shortCourseName: "Långa kort",
    shortClassName: "Öppen kort",
    expectedSourceControlCount: 2,
    controlPrefix,
    entryIds: [ids.entry]
  };
  const response = {
    formatVersion: 1 as const,
    replayed: false,
    requestId: ids.request,
    transferId: ids.request,
    raceId: ids.race,
    sourceClassId: ids.sourceClass,
    sourceCourseVersionId: ids.sourceCourseVersion,
    shortCourseId: ids.shortCourse,
    shortCourseVersionId: ids.shortCourseVersion,
    shortClassId: ids.shortClass,
    sourceSnapshotVersion: 1,
    snapshotVersionAfter: 2,
    sourceBasisHash: sourceHash,
    request,
    transferredAt: "2026-09-22T12:22:00.000Z",
    items: [{
      entryId: ids.entry,
      entryVersionBefore: 1,
      entryVersionAfter: 2,
      effect: "MOVED_AND_REEVALUATED" as const,
      sourceResultRevisionId: ids.sourceResult,
      sourceReadoutId: ids.readout,
      createdResultRevisionId: ids.createdResult,
      createdResultRevision: 2,
      resultingStatus: "OK" as const
    }]
  };
  return {
    transfer: {
      requestId: ids.request,
      raceId: ids.race,
      sourceClassId: ids.sourceClass,
      sourceCourseId: ids.sourceCourse,
      sourceCourseVersionId: ids.sourceCourseVersion,
      shortCourseId: ids.shortCourse,
      shortCourseVersionId: ids.shortCourseVersion,
      shortClassId: ids.shortClass,
      sourceSnapshotVersion: 1,
      sourceHash,
      frozenBasis,
      request,
      response
    },
    item: {
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      entryVersionBefore: 1,
      entryVersionAfter: 2,
      sourceResultRevisionId: ids.sourceResult,
      sourceResultRevision: 1,
      sourceReadoutId: ids.readout,
      createdResultRevisionId: ids.createdResult,
      createdResultRevision: 2
    },
    source,
    created
  } as unknown as StoredShortenedCourseClassTransferProof;
}

describe("TASK135 stored shortened-course transfer provenance", () => {
  it("accepts the exact frozen basis but rejects a semantic change behind its old hash", () => {
    const valid = proof();
    expect(parseStrictStoredResultRevision(valid.created, undefined, undefined, undefined, undefined, undefined, valid))
      .toEqual(createdOutcome);

    const mutatedFrozenBasis = {
      ...valid.transfer.frozenBasis,
      semantic: {
        ...(valid.transfer.frozenBasis as { semantic: Record<string, unknown> }).semantic,
        sourceClassName: "Manipulerad klass"
      }
    };
    const tampered = {
      ...valid,
      transfer: { ...valid.transfer, frozenBasis: mutatedFrozenBasis }
    } as StoredShortenedCourseClassTransferProof;
    expect(() => parseStrictStoredResultRevision(tampered.created, undefined, undefined, undefined, undefined, undefined, tampered))
      .toThrow(StoredResultRevisionConflict);
  });
});
