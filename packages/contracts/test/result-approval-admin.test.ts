import { describe, expect, it } from "vitest";
import {
  resultApprovalAdminLoginRequestSchema,
  resultApprovalCandidateResponseSchema,
  resultApprovalIdempotencyKeySchema,
  resultApprovalRequestSchema,
  resultApprovalResponseSchema
} from "../src";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  target: "50000000-0000-4000-8000-000000000005",
  request: "60000000-0000-4000-8000-000000000006",
  decision: "70000000-0000-4000-8000-000000000007",
  result: "80000000-0000-4000-8000-000000000008"
};

const target = {
  id: ids.target,
  revision: 3,
  status: "MP" as const,
  reason: "MISSING_CONTROL" as const,
  cause: "CARD_READOUT" as const,
  createdAt: "2026-09-01T08:00:00.000Z",
  snapshotVersion: 7
};

describe("resultApprovalAdmin", () => {
  it("separerar capability och exponerar bara approval-kandidatens identitet", () => {
    expect(resultApprovalAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_result_approval_v1.${ids.race}.${"a".repeat(43)}`
    }).success).toBe(true);
    const response = resultApprovalCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "manual-result-approval-v1",
      entries: [{
        id: ids.entry,
        displayName: "Ada Löpare",
        organisationName: null,
        classId: ids.class,
        className: "D21",
        courseVersionId: ids.course,
        entryVersion: 2,
        readiness: "READY",
        targetResultRevision: target
      }]
    });
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|raw|startTime|finishTime/);
  });

  it("tillåter endast tidskompletta tekniska MP-orsaker och target endast för READY", () => {
    const base = {
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "manual-result-approval-v1",
      entries: [{
        id: ids.entry,
        displayName: "Ada",
        organisationName: null,
        classId: ids.class,
        className: "D21",
        courseVersionId: ids.course,
        entryVersion: 2,
        readiness: "READY",
        targetResultRevision: target
      }]
    };
    expect(resultApprovalCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], targetResultRevision: null }]
    }).success).toBe(false);
    expect(resultApprovalCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], targetResultRevision: { ...target, reason: "MISSING_START" } }]
    }).success).toBe(false);
    expect(resultApprovalCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], readiness: "ACTIVE_DISQUALIFICATION", targetResultRevision: null }]
    }).success).toBe(true);
    expect(resultApprovalCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], readiness: "ACTIVE_OUT_OF_COMPETITION", targetResultRevision: null }]
    }).success).toBe(true);
  });

  it("binder revisionens status och orsak samt strikt idempotens", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 2,
      expectedClassId: ids.class,
      expectedCourseVersionId: ids.course,
      expectedSnapshotVersion: 7,
      expectedResultRevision: {
        id: ids.target,
        revision: 3,
        status: "MP" as const,
        reason: "MISSING_CONTROL" as const
      },
      policyVersion: "manual-result-approval-v1"
    };
    expect(resultApprovalRequestSchema.parse(request)).toEqual(request);
    expect(resultApprovalRequestSchema.safeParse({
      ...request,
      expectedResultRevision: { ...request.expectedResultRevision, reason: "COMPLETE" }
    }).success).toBe(false);
    expect(resultApprovalIdempotencyKeySchema.safeParse(`manual-result-approval:${ids.request}`).success)
      .toBe(true);
    expect(resultApprovalIdempotencyKeySchema.safeParse(`manual-disqualification:${ids.request}`).success)
      .toBe(false);
  });

  it("validerar append-only OK/MANUAL_APPROVAL-svaret", () => {
    expect(resultApprovalResponseSchema.safeParse({
      formatVersion: 1,
      replayed: false,
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      resultApprovalDecisionId: ids.decision,
      targetResultRevisionId: ids.target,
      targetResultRevision: 3,
      targetReason: "MISSING_CONTROL",
      resultRevisionId: ids.result,
      revision: 4,
      cause: "MANUAL_RESULT_APPROVAL",
      status: "OK",
      reason: "MANUAL_APPROVAL",
      policyVersion: "manual-result-approval-v1",
      snapshotVersion: 7,
      courseVersionId: ids.course,
      decidedAt: "2026-09-01T08:01:00.000Z"
    }).success).toBe(true);
  });
});
