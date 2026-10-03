import { describe, expect, it } from "vitest";
import {
  didNotFinishWithdrawalAdminLoginRequestSchema,
  didNotFinishWithdrawalAdminLoginResponseSchema,
  didNotFinishWithdrawalIdempotencyKeySchema,
  didNotFinishWithdrawalListResponseSchema,
  didNotFinishWithdrawalRequestSchema,
  didNotFinishWithdrawalResponseSchema
} from "../src";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const raceId = id("1");
const entryId = id("2");
const classId = id("3");
const courseId = id("4");
const decisionId = id("5");
const targetId = id("6");
const didNotFinishId = id("7");
const absoluteId = id("8");
const withdrawalId = id("9");
const restorationId = id("a");
const requestId = id("b");

const entry = {
  id: entryId,
  displayName: "Ada Löpare",
  organisationName: "Centrum OK",
  classId,
  className: "D21",
  courseVersionId: courseId,
  entryVersion: 4,
  state: "WITHDRAWABLE" as const,
  didNotFinishDecisionId: decisionId,
  decidedAt: "2026-09-01T08:00:00.000Z",
  targetResultRevision: { id: targetId, revision: 1 },
  didNotFinishResultRevision: { id: didNotFinishId, revision: 2 },
  absoluteResultRevision: { id: absoluteId, revision: 4 },
  restorationSourceResultRevision: {
    id: absoluteId,
    revision: 4,
    status: "MP" as const,
    reason: "MISSING_CONTROL" as const
  },
  withdrawal: null
};

describe("didNotFinishWithdrawalAdmin", () => {
  it("har eget credentialprefix och separat capability", () => {
    expect(didNotFinishWithdrawalAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_did_not_finish_withdrawal_v1.${raceId}.${"A".repeat(43)}`
    }).success).toBe(true);
    expect(didNotFinishWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "WITHDRAW_DID_NOT_FINISH",
      expiresAt: "2026-09-01T09:00:00.000Z"
    }).capability).toBe("WITHDRAW_DID_NOT_FINISH");
  });

  it("lämnar endast minimal lifecycle-, display- och versionsdata", () => {
    const response = didNotFinishWithdrawalListResponseSchema.parse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [entry]
    });
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|rawPayload|startTime|finishTime|elapsedMs/);
  });

  it("binder exakt DNF-kedja, absolut huvud och senare teknisk restaureringskälla", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 4,
      expectedClassId: classId,
      expectedCourseVersionId: courseId,
      expectedSnapshotVersion: 8,
      expectedDidNotFinishDecisionId: decisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedDidNotFinishResultRevision: entry.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const
    };
    expect(didNotFinishWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(didNotFinishWithdrawalRequestSchema.safeParse({
      ...request,
      expectedRestorationSourceResultRevision: {
        ...request.expectedRestorationSourceResultRevision,
        id: targetId,
        revision: 1
      }
    }).success).toBe(false);
    expect(didNotFinishWithdrawalRequestSchema.safeParse({
      ...request,
      expectedDidNotFinishResultRevision: { id: didNotFinishId, revision: 3 }
    }).success).toBe(false);
    expect(didNotFinishWithdrawalIdempotencyKeySchema.safeParse(
      `did-not-finish-withdrawal:${requestId}`
    ).success).toBe(true);
  });

  it("godtar originaltarget endast när DNF är absolut huvud", () => {
    expect(didNotFinishWithdrawalRequestSchema.safeParse({
      formatVersion: 1,
      expectedEntryVersion: 4,
      expectedClassId: classId,
      expectedCourseVersionId: courseId,
      expectedSnapshotVersion: 8,
      expectedDidNotFinishDecisionId: decisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedDidNotFinishResultRevision: entry.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: entry.didNotFinishResultRevision,
      expectedRestorationSourceResultRevision: {
        ...entry.restorationSourceResultRevision,
        id: targetId,
        revision: 1
      },
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
      policyVersion: "did-not-finish-withdrawal-v1"
    }).success).toBe(true);
  });

  it("validerar restaurerat OK|MP-svar och state/metadata-samband", () => {
    expect(didNotFinishWithdrawalResponseSchema.safeParse({
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      didNotFinishWithdrawalId: withdrawalId,
      didNotFinishDecisionId: decisionId,
      didNotFinishResultRevisionId: didNotFinishId,
      restorationSourceResultRevisionId: absoluteId,
      restorationResultRevisionId: restorationId,
      revision: 5,
      cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
      status: "MP",
      reason: "MISSING_CONTROL",
      withdrawalReason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
      policyVersion: "did-not-finish-withdrawal-v1",
      snapshotVersion: 8,
      courseVersionId: courseId,
      withdrawnAt: "2026-09-01T08:10:00.000Z"
    }).success).toBe(true);
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [{ ...entry, state: "WITHDRAWN" }]
    }).success).toBe(false);
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [{
        ...entry,
        state: "WITHDRAWN",
        absoluteResultRevision: { id: restorationId, revision: 5 },
        withdrawal: {
          id: withdrawalId,
          restorationResultRevision: { id: restorationId, revision: 5 },
          reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
          policyVersion: "did-not-finish-withdrawal-v1",
          withdrawnAt: "2026-09-01T08:10:00.000Z"
        }
      }]
    }).success).toBe(true);
  });

  it("godtar att originaltarget återställs efter den mellanliggande DNF-revisionen", () => {
    const noLaterTechnical = {
      ...entry,
      state: "WITHDRAWN" as const,
      absoluteResultRevision: { id: restorationId, revision: 3 },
      restorationSourceResultRevision: {
        id: targetId,
        revision: 1,
        status: "MP" as const,
        reason: "MISSING_CONTROL" as const
      },
      withdrawal: {
        id: withdrawalId,
        restorationResultRevision: { id: restorationId, revision: 3 },
        reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
        policyVersion: "did-not-finish-withdrawal-v1" as const,
        withdrawnAt: "2026-09-01T08:10:00.000Z"
      }
    };
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [noLaterTechnical]
    }).success).toBe(true);
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [{
        ...noLaterTechnical,
        withdrawal: {
          ...noLaterTechnical.withdrawal,
          restorationResultRevision: { id: restorationId, revision: 4 }
        }
      }]
    }).success).toBe(false);
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [{
        ...noLaterTechnical,
        restorationSourceResultRevision: {
          ...noLaterTechnical.restorationSourceResultRevision,
          id: absoluteId
        }
      }]
    }).success).toBe(false);
    expect(didNotFinishWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "did-not-finish-withdrawal-v1",
      entries: [{
        ...noLaterTechnical,
        restorationSourceResultRevision: {
          ...noLaterTechnical.restorationSourceResultRevision,
          id: absoluteId,
          revision: 2
        }
      }]
    }).success).toBe(false);
  });
});
