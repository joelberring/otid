import { describe, expect, it } from "vitest";
import {
  resultDisqualificationWithdrawalAdminLoginResponseSchema,
  resultDisqualificationWithdrawalIdempotencyKeySchema,
  resultDisqualificationWithdrawalListResponseSchema,
  resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalResponseSchema
} from "../src";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const raceId = id("1");
const entryId = id("2");
const classId = id("3");
const courseId = id("4");
const decisionId = id("5");
const targetId = id("6");
const dsqId = id("7");
const absoluteId = id("8");
const sourceId = id("9");
const withdrawalId = id("a");
const restorationId = id("b");
const requestId = id("c");

const entry = {
  id: entryId,
  displayName: "Ada Löpare",
  organisationName: "Centrum OK",
  classId,
  className: "D21",
  courseVersionId: courseId,
  entryVersion: 4,
  state: "WITHDRAWABLE" as const,
  resultDisqualificationDecisionId: decisionId,
  decidedAt: "2026-08-31T20:00:00.000Z",
  targetResultRevision: { id: targetId, revision: 3 },
  disqualifiedResultRevision: { id: dsqId, revision: 4 },
  absoluteResultRevision: { id: absoluteId, revision: 6 },
  restorationSourceResultRevision: {
    id: sourceId,
    revision: 6,
    status: "MP" as const,
    reason: "MISSING_CONTROL" as const
  },
  withdrawal: null
};

describe("resultDisqualificationWithdrawalAdmin", () => {
  it("har separat capability och listar exakt withdrawal-intent utan känsliga fakta", () => {
    expect(resultDisqualificationWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "WITHDRAW_DISQUALIFICATION",
      expiresAt: "2026-08-31T21:00:00.000Z"
    }).capability).toBe("WITHDRAW_DISQUALIFICATION");
    const response = resultDisqualificationWithdrawalListResponseSchema.parse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "manual-disqualification-withdrawal-v1",
      entries: [entry]
    });
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|rawPayload|rawMessage|startTime|finishTime/);
  });

  it("binder decision, DSQ, absolut head och exakt restaureringskälla", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 4,
      expectedClassId: classId,
      expectedCourseVersionId: courseId,
      expectedSnapshotVersion: 8,
      expectedResultDisqualificationDecisionId: decisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedDisqualifiedResultRevision: entry.disqualifiedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-disqualification-withdrawal-v1"
    };
    expect(resultDisqualificationWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(resultDisqualificationWithdrawalRequestSchema.safeParse({
      ...request,
      expectedRestorationSourceResultRevision: {
        ...request.expectedRestorationSourceResultRevision,
        status: "OK"
      }
    }).success).toBe(false);
    expect(resultDisqualificationWithdrawalIdempotencyKeySchema.safeParse(
      `manual-disqualification-withdrawal:${requestId}`
    ).success).toBe(true);
  });

  it("validerar append-only restaureringssvaret och state/withdrawal-samband", () => {
    expect(resultDisqualificationWithdrawalResponseSchema.safeParse({
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      resultDisqualificationWithdrawalId: withdrawalId,
      resultDisqualificationDecisionId: decisionId,
      disqualifiedResultRevisionId: dsqId,
      restorationSourceResultRevisionId: sourceId,
      restorationResultRevisionId: restorationId,
      revision: 7,
      cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL",
      status: "MP",
      reason: "MISSING_CONTROL",
      policyVersion: "manual-disqualification-withdrawal-v1",
      snapshotVersion: 8,
      courseVersionId: courseId,
      withdrawnAt: "2026-08-31T20:10:00.000Z"
    }).success).toBe(true);
    expect(resultDisqualificationWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "manual-disqualification-withdrawal-v1",
      entries: [{ ...entry, state: "WITHDRAWN" }]
    }).success).toBe(false);
  });
});
