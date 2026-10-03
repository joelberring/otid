import { describe, expect, it } from "vitest";
import {
  WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION,
  withoutTimingWithdrawalAdminLoginRequestSchema,
  withoutTimingWithdrawalAdminLoginResponseSchema,
  withoutTimingWithdrawalIdempotencyKeySchema,
  withoutTimingWithdrawalListResponseSchema,
  withoutTimingWithdrawalRequestSchema,
  withoutTimingWithdrawalResponseSchema
} from "../src";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  target: "50000000-0000-4000-8000-000000000005",
  withoutTiming: "60000000-0000-4000-8000-000000000006",
  later: "70000000-0000-4000-8000-000000000007",
  decision: "80000000-0000-4000-8000-000000000008",
  withdrawal: "90000000-0000-4000-8000-000000000009",
  restoration: "a0000000-0000-4000-8000-000000000010",
  request: "b0000000-0000-4000-8000-000000000011"
};

const laterSource = {
  id: ids.later, revision: 5, status: "MP" as const, reason: "MISSING_CONTROL" as const,
  cause: "EXPLICIT_RECALCULATION" as const
};
const request = {
  formatVersion: 1,
  expectedEntryVersion: 2,
  expectedClassId: ids.class,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 7,
  expectedWithoutTimingDecisionId: ids.decision,
  expectedTargetResultRevision: { id: ids.target, revision: 3 },
  expectedWithoutTimingResultRevision: { id: ids.withoutTiming, revision: 4 },
  expectedAbsoluteResultRevision: { id: ids.later, revision: 5 },
  expectedRestorationSourceResultRevision: laterSource,
  reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING" as const,
  policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION
};

describe("withoutTimingWithdrawalAdmin", () => {
  it("separerar credential, capability, policy och idempotencykey", () => {
    expect(withoutTimingWithdrawalAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_without_timing_withdrawal_v1.${ids.race}.${"A".repeat(43)}`
    }).success).toBe(true);
    expect(withoutTimingWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: ids.race, capability: "WITHDRAW_WITHOUT_TIMING", expiresAt: "2026-09-01T10:00:00.000Z"
    }).capability).toBe("WITHDRAW_WITHOUT_TIMING");
    expect(withoutTimingWithdrawalIdempotencyKeySchema.parse(`without-timing-withdrawal:${ids.request}`))
      .toBe(`without-timing-withdrawal:${ids.request}`);
  });

  it("binder exakt senare teknisk OK|MP-källa och avvisar fallback eller manuell cause", () => {
    expect(withoutTimingWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(withoutTimingWithdrawalRequestSchema.safeParse({
      ...request, expectedRestorationSourceResultRevision: { ...laterSource, id: ids.target, revision: 3 }
    }).success).toBe(false);
    expect(withoutTimingWithdrawalRequestSchema.safeParse({
      ...request, expectedRestorationSourceResultRevision: { ...laterSource, cause: "MANUAL_WITHOUT_TIMING" }
    }).success).toBe(false);
  });

  it("godtar originalets OK/COMPLETE endast när NT är absolut huvud", () => {
    expect(withoutTimingWithdrawalRequestSchema.safeParse({
      ...request,
      expectedAbsoluteResultRevision: { id: ids.withoutTiming, revision: 4 },
      expectedRestorationSourceResultRevision: {
        id: ids.target, revision: 3, status: "OK", reason: "COMPLETE", cause: "CARD_READOUT"
      }
    }).success).toBe(true);
  });

  it("publicerar endast lifecyclemetadata och den restaurerade tekniska statusen", () => {
    const entry = {
      id: ids.entry, displayName: "Ada Löpare", organisationName: null, classId: ids.class, className: "D21",
      courseVersionId: ids.course, entryVersion: 2, state: "WITHDRAWABLE" as const,
      withoutTimingDecisionId: ids.decision, decidedAt: "2026-09-01T10:00:00.000Z",
      targetResultRevision: request.expectedTargetResultRevision,
      withoutTimingResultRevision: request.expectedWithoutTimingResultRevision,
      absoluteResultRevision: request.expectedAbsoluteResultRevision,
      restorationSourceResultRevision: laterSource, withdrawal: null
    };
    expect(withoutTimingWithdrawalListResponseSchema.parse({
      formatVersion: 1, raceId: ids.race, snapshotVersion: 7,
      policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION, entries: [entry]
    }).entries).toHaveLength(1);
    expect(withoutTimingWithdrawalResponseSchema.safeParse({
      formatVersion: 1, replayed: false, requestId: ids.request, raceId: ids.race, entryId: ids.entry,
      withoutTimingWithdrawalId: ids.withdrawal, withoutTimingDecisionId: ids.decision,
      withoutTimingResultRevisionId: ids.withoutTiming, restorationSourceResultRevisionId: ids.later,
      restorationResultRevisionId: ids.restoration, revision: 6, cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
      status: "MP", reason: "MISSING_CONTROL", withdrawalReason: "ERRONEOUS_MANUAL_WITHOUT_TIMING",
      policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION, snapshotVersion: 7, courseVersionId: ids.course,
      withdrawnAt: "2026-09-01T10:01:00.000Z"
    }).success).toBe(true);
  });
});
