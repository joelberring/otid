import { describe, expect, it } from "vitest";
import {
  OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
  outOfCompetitionWithdrawalAdminLoginRequestSchema,
  outOfCompetitionWithdrawalIdempotencyKeySchema,
  outOfCompetitionWithdrawalListResponseSchema,
  outOfCompetitionWithdrawalRequestSchema,
  outOfCompetitionWithdrawalResponseSchema
} from "../src";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003",
  course: "40000000-0000-4000-8000-000000000004",
  target: "50000000-0000-4000-8000-000000000005",
  ooc: "60000000-0000-4000-8000-000000000006",
  request: "70000000-0000-4000-8000-000000000007",
  decision: "80000000-0000-4000-8000-000000000008",
  withdrawal: "90000000-0000-4000-8000-000000000009",
  restoration: "a0000000-0000-4000-8000-000000000010"
};

const source = {
  id: ids.target,
  revision: 3,
  status: "MP" as const,
  reason: "MISSING_CONTROL" as const,
  cause: "CLASS_CHANGE_RECALCULATION" as const
};

const request = {
  formatVersion: 1,
  expectedEntryVersion: 2,
  expectedClassId: ids.class,
  expectedCourseVersionId: ids.course,
  expectedSnapshotVersion: 7,
  expectedNotCompetingDecisionId: ids.decision,
  expectedTargetResultRevision: { id: ids.target, revision: 3 },
  expectedOutOfCompetitionResultRevision: { id: ids.ooc, revision: 4 },
  expectedAbsoluteResultRevision: { id: ids.ooc, revision: 4 },
  expectedRestorationSourceResultRevision: source,
  reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
  policyVersion: OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION
};

describe("outOfCompetitionWithdrawalAdmin", () => {
  it("har en avskild capability, policy, request och idempotensnyckel", () => {
    expect(outOfCompetitionWithdrawalAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_out_of_competition_withdrawal_v1.${ids.race}.${"a".repeat(43)}`
    }).success).toBe(true);
    expect(outOfCompetitionWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(outOfCompetitionWithdrawalIdempotencyKeySchema.parse(`out-of-competition-withdrawal:${ids.request}`))
      .toBe(`out-of-competition-withdrawal:${ids.request}`);
    expect(outOfCompetitionWithdrawalRequestSchema.safeParse({
      ...request,
      expectedRestorationSourceResultRevision: { ...source, cause: "MANUAL_OUT_OF_COMPETITION" }
    }).success).toBe(false);
  });

  it("fryser target, OOC, absolut huvud och exakt källa i den privata listan", () => {
    const response = {
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
      entries: [{
        id: ids.entry,
        displayName: "Ada Löpare",
        organisationName: null,
        classId: ids.class,
        className: "D21",
        courseVersionId: ids.course,
        entryVersion: 2,
        state: "WITHDRAWABLE" as const,
        notCompetingDecisionId: ids.decision,
        decidedAt: "2026-09-01T10:00:00.000Z",
        targetResultRevision: { id: ids.target, revision: 3 },
        outOfCompetitionResultRevision: { id: ids.ooc, revision: 4 },
        absoluteResultRevision: { id: ids.ooc, revision: 4 },
        restorationSourceResultRevision: source,
        withdrawal: null
      }]
    };
    expect(outOfCompetitionWithdrawalListResponseSchema.parse(response)).toEqual(response);
    expect(outOfCompetitionWithdrawalListResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], restorationSourceResultRevision: { ...source, id: ids.ooc, revision: 4 } }]
    }).success).toBe(false);
  });

  it("återger endast den restaurerade tekniska statusen och fulla provenance-id:n", () => {
    const response = {
      formatVersion: 1,
      replayed: false,
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      outOfCompetitionWithdrawalId: ids.withdrawal,
      notCompetingDecisionId: ids.decision,
      outOfCompetitionResultRevisionId: ids.ooc,
      restorationSourceResultRevisionId: ids.target,
      restorationResultRevisionId: ids.restoration,
      revision: 5,
      cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" as const,
      status: "MP" as const,
      reason: "MISSING_CONTROL" as const,
      withdrawalReason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
      snapshotVersion: 7,
      courseVersionId: ids.course,
      withdrawnAt: "2026-09-01T10:01:00.000Z"
    };
    expect(outOfCompetitionWithdrawalResponseSchema.parse(response)).toEqual(response);
    expect(outOfCompetitionWithdrawalResponseSchema.safeParse({ ...response, reason: "COMPLETE" }).success).toBe(false);
  });
});
