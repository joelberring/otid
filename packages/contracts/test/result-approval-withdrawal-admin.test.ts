import { describe, expect, it } from "vitest";
import {
  resultApprovalWithdrawalAdminLoginResponseSchema,
  resultApprovalWithdrawalIdempotencyKeySchema,
  resultApprovalWithdrawalListResponseSchema,
  resultApprovalWithdrawalRequestSchema,
  resultApprovalWithdrawalResponseSchema
} from "../src";

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const raceId = id("1");
const entryId = id("2");
const classId = id("3");
const courseId = id("4");
const decisionId = id("5");
const targetId = id("6");
const approvedId = id("7");
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
  resultApprovalDecisionId: decisionId,
  decidedAt: "2026-09-01T08:00:00.000Z",
  targetResultRevision: {
    id: targetId,
    revision: 3,
    status: "MP" as const,
    reason: "MISSING_CONTROL" as const
  },
  approvedResultRevision: { id: approvedId, revision: 4 },
  absoluteResultRevision: { id: absoluteId, revision: 6 },
  restorationSourceResultRevision: {
    id: sourceId,
    revision: 6,
    status: "OK" as const,
    reason: "COMPLETE" as const
  },
  withdrawal: null
};

describe("resultApprovalWithdrawalAdmin", () => {
  it("har separat capability och kan frysa en senare teknisk OK som restaureringskälla", () => {
    expect(resultApprovalWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "WITHDRAW_RESULT_APPROVAL",
      expiresAt: "2026-09-01T09:00:00.000Z"
    }).capability).toBe("WITHDRAW_RESULT_APPROVAL");
    const response = resultApprovalWithdrawalListResponseSchema.parse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "manual-result-approval-withdrawal-v1",
      entries: [entry]
    });
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|rawPayload|startTime|finishTime/);
  });

  it("binder approval, absolut head och exakt teknisk restaureringskälla", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 4,
      expectedClassId: classId,
      expectedCourseVersionId: courseId,
      expectedSnapshotVersion: 8,
      expectedResultApprovalDecisionId: decisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedApprovedResultRevision: entry.approvedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-result-approval-withdrawal-v1"
    };
    expect(resultApprovalWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(resultApprovalWithdrawalRequestSchema.safeParse({
      ...request,
      expectedRestorationSourceResultRevision: {
        ...request.expectedRestorationSourceResultRevision,
        status: "MP"
      }
    }).success).toBe(false);
    expect(resultApprovalWithdrawalIdempotencyKeySchema.safeParse(
      `manual-result-approval-withdrawal:${requestId}`
    ).success).toBe(true);
  });

  it("validerar withdrawal-svar och state/metadata-samband", () => {
    expect(resultApprovalWithdrawalResponseSchema.safeParse({
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      resultApprovalWithdrawalId: withdrawalId,
      resultApprovalDecisionId: decisionId,
      approvedResultRevisionId: approvedId,
      restorationSourceResultRevisionId: sourceId,
      restorationResultRevisionId: restorationId,
      revision: 7,
      cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
      status: "OK",
      reason: "COMPLETE",
      policyVersion: "manual-result-approval-withdrawal-v1",
      snapshotVersion: 8,
      courseVersionId: courseId,
      withdrawnAt: "2026-09-01T08:10:00.000Z"
    }).success).toBe(true);
    expect(resultApprovalWithdrawalListResponseSchema.safeParse({
      formatVersion: 1,
      raceId,
      snapshotVersion: 8,
      policyVersion: "manual-result-approval-withdrawal-v1",
      entries: [{ ...entry, state: "WITHDRAWN" }]
    }).success).toBe(false);
  });
});
