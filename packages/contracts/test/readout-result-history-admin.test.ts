import { describe, expect, it } from "vitest";
import {
  readoutHistoryDetailResponseSchema,
  readoutHistoryListQuerySchema,
  readoutHistoryListResponseSchema,
  readoutResultHistoryAdminErrorResponseSchema,
  readoutResultHistoryAdminLoginRequestSchema
} from "../src";

const raceId = "10000000-0000-4000-8000-000000000001";
const readoutId = "20000000-0000-4000-8000-000000000002";
const entryId = "30000000-0000-4000-8000-000000000003";
const revisionId = "40000000-0000-4000-8000-000000000004";
const courseVersionId = "50000000-0000-4000-8000-000000000005";
const instant = "2026-08-31T12:00:00.000Z";

const assessment = {
  status: "OK" as const, reason: "COMPLETE" as const,
  engineVersion: "task-001-v1", snapshotVersion: 3, courseVersionId
};
const evaluation = {
  status: "OK" as const, reason: "COMPLETE" as const, entryId,
  classId: "60000000-0000-4000-8000-000000000006", courseVersionId,
  startTime: instant, finishTime: "2026-08-31T12:30:00.000Z", elapsedMs: 1_800_000,
  missingControls: [], extraPunches: [99],
  splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }]
};

describe("TASK 005N historikkontrakt", () => {
  it("separerar credentialprefix och begränsar queries", () => {
    const accessCredential = `otid_org_readout_result_history_v1.${raceId}.${"A".repeat(43)}`;
    expect(readoutResultHistoryAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential }).accessCredential)
      .toBe(accessCredential);
    expect(readoutResultHistoryAdminLoginRequestSchema.safeParse({
      formatVersion: 1, accessCredential: accessCredential.replace("readout_result_history", "race_overview")
    }).success).toBe(false);
    expect(readoutHistoryListQuerySchema.parse({}).limit).toBe(50);
    expect(readoutHistoryListQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(readoutHistoryListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(readoutHistoryListQuerySchema.safeParse({ limit: "1", offset: "2" }).success).toBe(false);
  });

  it("validerar känd och okänd readout utan fabricerad revision", () => {
    expect(readoutHistoryListResponseSchema.parse({
      formatVersion: 1, raceId, nextCursor: null,
      items: [{ id: readoutId, readAt: instant, cardNumber: "12345",
        entry: { id: entryId, displayName: "Ada Lovelace" }, firstServerAssessment: assessment }]
    }).items).toHaveLength(1);
    expect(readoutHistoryDetailResponseSchema.parse({
      formatVersion: 1, raceId,
      readout: { id: readoutId, cardNumber: "999", readAt: instant, startPunchedAt: null,
        finishPunchedAt: instant, punches: [] },
      firstServerAssessment: { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", engineVersion: "v1",
        snapshotVersion: 1, courseVersionId: null },
      entry: null, history: { upperRevision: 0, items: [], nextCursor: null }
    }).entry).toBeNull();
  });

  it("läser NT endast i format 8 med status-only och explicit provenance", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const withoutTiming = {
      status: "NT" as const, reason: "WITHOUT_TIMING" as const, entryId,
      classId: "60000000-0000-4000-8000-000000000006", courseVersionId
    };
    const v8 = {
      formatVersion: 8 as const, raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment, entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 2, nextCursor: null, items: [{
        id: revisionId, revision: 2,
        source: { kind: "MANUAL_WITHOUT_TIMING" as const, withoutTimingDecisionId: decisionId, targetResultRevisionId: targetId },
        cause: "MANUAL_WITHOUT_TIMING" as const, status: "NT" as const, reason: "WITHOUT_TIMING" as const,
        engineVersion: "without-timing-v1", snapshotVersion: 3, courseVersionId, published: true, createdAt: instant,
        evaluation: withoutTiming
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(v8).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...v8, formatVersion: 7 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...v8, history: { ...v8.history, items: [{ ...v8.history.items[0], evaluation: { ...withoutTiming, elapsedMs: 1 } }] }
    }).success).toBe(false);
    expect(readoutHistoryListResponseSchema.safeParse({ formatVersion: 8, raceId, nextCursor: null, items: [] }).success).toBe(true);
  });

  it("validerar full immutable revision och dess evaluation", () => {
    const detail = {
      formatVersion: 1 as const, raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [{ code: 31, punchedAt: instant }] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 1, nextCursor: null, items: [{
        id: revisionId, revision: 1, readoutId, cause: "CARD_READOUT" as const,
        status: "OK" as const, reason: "COMPLETE" as const, engineVersion: "task-001-v1",
        snapshotVersion: 3, courseVersionId, published: false, createdAt: instant, evaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...detail,
      history: { ...detail.history, items: [{ ...detail.history.items[0], reason: "MISSING_CONTROL" }] }
    }).success).toBe(false);
  });

  it("kan representera en historisk DNS-revision utan fabricerad readout", () => {
    const detail = {
      formatVersion: 1 as const, raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [{ code: 31, punchedAt: instant }] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 2, nextCursor: null, items: [{
        id: revisionId, revision: 1, readoutId: null, cause: "MANUAL_DID_NOT_START" as const,
        status: "DNS" as const, reason: "DID_NOT_START" as const, engineVersion: "did-not-start-v1",
        snapshotVersion: 3, courseVersionId, published: true, createdAt: instant,
        evaluation: {
          status: "DNS" as const, reason: "DID_NOT_START" as const, entryId,
          classId: "60000000-0000-4000-8000-000000000006", courseVersionId
        }
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(detail).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...detail,
      history: { ...detail.history, items: [{ ...detail.history.items[0], readoutId }] }
    }).success).toBe(false);
  });

  it("läser format 2 med diskriminerad DSQ- och withdrawalproveniens medan v1 är oförändrat", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const withdrawalId = "80000000-0000-4000-8000-000000000008";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const restoredId = "a0000000-0000-4000-8000-00000000000a";
    const dsqEvaluation = {
      ...evaluation,
      status: "DSQ" as const,
      reason: "MANUAL_DISQUALIFICATION" as const
    };
    const v2 = {
      formatVersion: 2 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 3, nextCursor: null, items: [{
        id: revisionId,
        revision: 2,
        source: {
          kind: "MANUAL_DISQUALIFICATION" as const,
          resultDisqualificationDecisionId: decisionId,
          targetResultRevisionId: targetId
        },
        cause: "MANUAL_DISQUALIFICATION" as const,
        status: "DSQ" as const,
        reason: "MANUAL_DISQUALIFICATION" as const,
        engineVersion: "manual-disqualification-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation: dsqEvaluation
      }, {
        id: restoredId,
        revision: 3,
        source: {
          kind: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const,
          resultDisqualificationWithdrawalId: withdrawalId,
          resultDisqualificationDecisionId: decisionId,
          targetResultRevisionId: targetId,
          disqualifiedResultRevisionId: revisionId,
          restorationSourceResultRevisionId: targetId
        },
        cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const,
        status: "OK" as const,
        reason: "COMPLETE" as const,
        engineVersion: "manual-disqualification-withdrawal-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(v2).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...v2, formatVersion: 1 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...v2,
      history: { ...v2.history, items: [{
        ...v2.history.items[0],
        source: { kind: "READOUT_RESULT", readoutId }
      }] }
    }).success).toBe(false);
    expect(readoutHistoryListResponseSchema.safeParse({
      formatVersion: 7,
      raceId,
      nextCursor: null,
      items: [{ id: readoutId, readAt: instant, cardNumber: "12345",
        entry: { id: entryId, displayName: "Ada Lovelace" }, firstServerAssessment: assessment }]
    }).success).toBe(true);
  });

  it("läser format 3 med approval-proveniens medan format 2 förblir fryst", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const approvedEvaluation = {
      ...evaluation,
      status: "OK" as const,
      reason: "MANUAL_APPROVAL" as const,
      missingControls: [45]
    };
    const v3 = {
      formatVersion: 3 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 2, nextCursor: null, items: [{
        id: revisionId,
        revision: 2,
        source: {
          kind: "MANUAL_RESULT_APPROVAL" as const,
          resultApprovalDecisionId: decisionId,
          targetResultRevisionId: targetId
        },
        cause: "MANUAL_RESULT_APPROVAL" as const,
        status: "OK" as const,
        reason: "MANUAL_APPROVAL" as const,
        engineVersion: "manual-result-approval-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation: approvedEvaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(v3).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...v3, formatVersion: 2 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...v3,
      history: { ...v3.history, items: [{ ...v3.history.items[0], source: { kind: "READOUT_RESULT", readoutId } }] }
    }).success).toBe(false);
  });

  it("läser format 4 med status-only DNF-proveniens medan v3 förblir fryst", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const dnfEvaluation = {
      status: "DNF" as const,
      reason: "DID_NOT_FINISH" as const,
      entryId,
      classId: "60000000-0000-4000-8000-000000000006",
      courseVersionId
    };
    const v4 = {
      formatVersion: 4 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 2, nextCursor: null, items: [{
        id: revisionId,
        revision: 2,
        source: {
          kind: "MANUAL_DID_NOT_FINISH" as const,
          didNotFinishDecisionId: decisionId,
          targetResultRevisionId: targetId
        },
        cause: "MANUAL_DID_NOT_FINISH" as const,
        status: "DNF" as const,
        reason: "DID_NOT_FINISH" as const,
        engineVersion: "manual-did-not-finish-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation: dnfEvaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(v4).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...v4, formatVersion: 3 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...v4,
      history: { ...v4.history, items: [{ ...v4.history.items[0], evaluation: { ...dnfEvaluation, elapsedMs: 1 } }] }
    }).success).toBe(false);
  });

  it("läser format 5 med full DNF-withdrawalproveniens medan v4 förblir fryst", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const withdrawalId = "80000000-0000-4000-8000-000000000008";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const didNotFinishId = "a0000000-0000-4000-8000-00000000000a";
    const restorationSourceId = "b0000000-0000-4000-8000-00000000000b";
    const restored = {
      formatVersion: 5 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 5, nextCursor: null, items: [{
        id: revisionId,
        revision: 5,
        source: {
          kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const,
          didNotFinishWithdrawalId: withdrawalId,
          didNotFinishDecisionId: decisionId,
          targetResultRevisionId: targetId,
          didNotFinishResultRevisionId: didNotFinishId,
          restorationSourceResultRevisionId: restorationSourceId
        },
        cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const,
        status: "OK" as const,
        reason: "COMPLETE" as const,
        engineVersion: "did-not-finish-withdrawal-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.safeParse(restored).success).toBe(true);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...restored, formatVersion: 4 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...restored,
      formatVersion: 4,
      history: { ...restored.history, items: [{
        ...restored.history.items[0],
        source: { kind: "READOUT_RESULT", readoutId }
      }] }
    }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...restored,
      history: { ...restored.history, items: [{
        ...restored.history.items[0],
        source: { kind: "READOUT_RESULT", readoutId }
      }] }
    }).success).toBe(false);
    expect(readoutHistoryListResponseSchema.safeParse({
      formatVersion: 5,
      raceId,
      nextCursor: null,
      items: [{ id: readoutId, readAt: instant, cardNumber: "12345",
        entry: { id: entryId, displayName: "Ada Lovelace" }, firstServerAssessment: assessment }]
    }).success).toBe(true);
  });

  it("läser format 6 med OOC-targetproveniens och bevarad teknisk fakta", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const outOfCompetitionEvaluation = {
      ...evaluation,
      status: "OOC" as const,
      reason: "OUT_OF_COMPETITION" as const
    };
    const outOfCompetition = {
      formatVersion: 6 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 2, nextCursor: null, items: [{
        id: revisionId,
        revision: 2,
        source: {
          kind: "MANUAL_OUT_OF_COMPETITION" as const,
          notCompetingDecisionId: decisionId,
          targetResultRevisionId: targetId
        },
        cause: "MANUAL_OUT_OF_COMPETITION" as const,
        status: "OOC" as const,
        reason: "OUT_OF_COMPETITION" as const,
        engineVersion: "out-of-competition-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation: outOfCompetitionEvaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.parse(outOfCompetition)).toEqual(outOfCompetition);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...outOfCompetition, formatVersion: 5
    }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...outOfCompetition,
      history: { ...outOfCompetition.history, items: [{
        ...outOfCompetition.history.items[0],
        source: { kind: "READOUT_RESULT", readoutId }
      }] }
    }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...outOfCompetition,
      history: { ...outOfCompetition.history, items: [{
        ...outOfCompetition.history.items[0],
        status: "MP",
        reason: "MISSING_CONTROL"
      }] }
    }).success).toBe(false);
  });

  it("läser format 7 med full OOC-withdrawalproveniens och restaurerad MP", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const targetId = "90000000-0000-4000-8000-000000000009";
    const oocId = "a0000000-0000-4000-8000-000000000010";
    const withdrawalId = "b0000000-0000-4000-8000-000000000011";
    const restoredEvaluation = {
      ...evaluation,
      status: "MP" as const,
      reason: "MISSING_CONTROL" as const,
      missingControls: [32]
    };
    const restored = {
      formatVersion: 7 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 5, nextCursor: null, items: [{
        id: revisionId,
        revision: 5,
        source: {
          kind: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" as const,
          notCompetingWithdrawalId: withdrawalId,
          notCompetingDecisionId: decisionId,
          targetResultRevisionId: targetId,
          outOfCompetitionResultRevisionId: oocId,
          absoluteResultRevisionId: oocId,
          absoluteResultRevision: 4,
          restorationSourceResultRevisionId: targetId
        },
        cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" as const,
        status: "MP" as const,
        reason: "MISSING_CONTROL" as const,
        engineVersion: "out-of-competition-withdrawal-v1",
        snapshotVersion: 3,
        courseVersionId,
        published: true,
        createdAt: instant,
        evaluation: restoredEvaluation
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.parse(restored)).toEqual(restored);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...restored,
      history: { ...restored.history, items: [{
        ...restored.history.items[0]!,
        source: { ...restored.history.items[0]!.source, kind: "READOUT_RESULT", readoutId }
      }] }
    }).success).toBe(false);
  });

  it("läser format 9 med full NT-withdrawalproveniens och restaurerad MP", () => {
    const targetId = "70000000-0000-4000-8000-000000000007";
    const withoutTimingId = "80000000-0000-4000-8000-000000000008";
    const withdrawalId = "90000000-0000-4000-8000-000000000009";
    const restored = {
      formatVersion: 9 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 5, nextCursor: null, items: [{
        id: revisionId, revision: 5,
        source: {
          kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL" as const,
          withoutTimingWithdrawalId: withdrawalId,
          withoutTimingDecisionId: "a0000000-0000-4000-8000-000000000010",
          targetResultRevisionId: targetId,
          withoutTimingResultRevisionId: withoutTimingId,
          absoluteResultRevisionId: withoutTimingId,
          absoluteResultRevision: 4,
          restorationSourceResultRevisionId: targetId
        },
        cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL" as const,
        status: "MP" as const, reason: "MISSING_CONTROL" as const,
        engineVersion: "without-timing-withdrawal-v1", snapshotVersion: 3, courseVersionId, published: true,
        createdAt: instant,
        evaluation: { ...evaluation, status: "MP" as const, reason: "MISSING_CONTROL" as const, missingControls: [32] }
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.parse(restored)).toEqual(restored);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...restored, history: { ...restored.history, items: [{
        ...restored.history.items[0]!, status: "NT", reason: "WITHOUT_TIMING"
      }] }
    }).success).toBe(false);
    expect(readoutHistoryListResponseSchema.safeParse({ formatVersion: 9, raceId, nextCursor: null, items: [] }).success)
      .toBe(true);
  });

  it("läser format 10 med strikt avpricknings-DNS-kedja och senare återtagande", () => {
    const decisionId = "70000000-0000-4000-8000-000000000007";
    const operationRequestId = "80000000-0000-4000-8000-000000000008";
    const startCheckinRevisionId = "90000000-0000-4000-8000-000000000009";
    const withdrawalId = "a0000000-0000-4000-8000-000000000010";
    const detail = {
      formatVersion: 10 as const,
      raceId,
      readout: { id: readoutId, cardNumber: "12345", readAt: instant, startPunchedAt: instant,
        finishPunchedAt: "2026-08-31T12:30:00.000Z", punches: [] },
      firstServerAssessment: assessment,
      entry: { id: entryId, displayName: "Ada Lovelace" },
      history: { upperRevision: 1, nextCursor: null, items: [{
        id: revisionId, revision: 1,
        source: {
          kind: "START_CHECKIN_DID_NOT_START" as const,
          startCheckinDnsDecisionId: decisionId,
          operationRequestId,
          startCheckinRevisionId,
          operationalRevision: 4,
          withdrawal: {
            id: withdrawalId,
            operationRequestId: "b0000000-0000-4000-8000-000000000011",
            startCheckinRevisionId: "c0000000-0000-4000-8000-000000000012",
            operationalRevision: 5
          }
        },
        cause: "START_CHECKIN_DID_NOT_START" as const,
        status: "DNS" as const, reason: "DID_NOT_START" as const,
        engineVersion: "start-checkin-dns-v1", snapshotVersion: 3, courseVersionId, published: true,
        createdAt: instant,
        evaluation: {
          status: "DNS" as const, reason: "DID_NOT_START" as const, entryId,
          classId: "60000000-0000-4000-8000-000000000006", courseVersionId
        }
      }] }
    };
    expect(readoutHistoryDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(readoutHistoryDetailResponseSchema.safeParse({ ...detail, formatVersion: 9 }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...detail,
      history: { ...detail.history, items: [{
        ...detail.history.items[0]!,
        source: { ...detail.history.items[0]!.source, withdrawal: {
          ...detail.history.items[0]!.source.withdrawal, operationalRevision: 4
        } }
      }] }
    }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...detail,
      history: { ...detail.history, items: [{ ...detail.history.items[0]!, cause: "MANUAL_DID_NOT_START" } ] }
    }).success).toBe(false);
    expect(readoutHistoryDetailResponseSchema.safeParse({
      ...detail,
      history: { ...detail.history, items: [{ ...detail.history.items[0]!, status: "OK", reason: "COMPLETE" } ] }
    }).success).toBe(false);
    expect(readoutHistoryListResponseSchema.safeParse({ formatVersion: 10, raceId, nextCursor: null, items: [] }).success)
      .toBe(true);
  });

  it("avvisar förbjudna canaryfält på alla nivåer", () => {
    const base = { formatVersion: 1, raceId, nextCursor: null, items: [] };
    for (const field of ["rawPayload", "rawMessageId", "deviceId", "sessionId", "localSequence",
      "packageVersion", "contentHash", "evaluationHash", "originalXml", "credentialLabel", "secretHash"]) {
      expect(readoutHistoryListResponseSchema.safeParse({ ...base, [field]: "canary" }).success).toBe(false);
    }
    expect(readoutHistoryListResponseSchema.safeParse({
      ...base,
      items: [{ id: readoutId, readAt: instant, cardNumber: "123", entry: null,
        firstServerAssessment: null, rawMessageId: revisionId }]
    }).success).toBe(false);
  });

  it("ger endast detaljfria fel", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INTERNAL_ERROR"]) {
      expect(readoutResultHistoryAdminErrorResponseSchema.parse({ formatVersion: 1, error }).error).toBe(error);
    }
    expect(readoutResultHistoryAdminErrorResponseSchema.safeParse({
      formatVersion: 1, error: "UNAUTHORIZED", details: "spärrad"
    }).success).toBe(false);
  });
});
