import { describe, expect, it } from "vitest";
import {
  DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
  didNotStartWithdrawalAdminErrorResponseSchema,
  didNotStartWithdrawalAdminLoginRequestSchema,
  didNotStartWithdrawalAdminLoginResponseSchema,
  didNotStartWithdrawalIdempotencyKeySchema,
  didNotStartWithdrawalListResponseSchema,
  didNotStartWithdrawalRequestSchema,
  didNotStartWithdrawalResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "b0000000-0000-4000-8000-000000000002";
const entryId = "c0000000-0000-4000-8000-000000000003";
const classId = "d0000000-0000-4000-8000-000000000004";
const courseVersionId = "e0000000-0000-4000-8000-000000000005";
const decisionId = "f0000000-0000-4000-8000-000000000006";
const revisionId = "a0000000-0000-4000-8000-000000000007";
const withdrawalId = "b0000000-0000-4000-8000-000000000008";
const laterRevisionId = "c0000000-0000-4000-8000-000000000009";
const instant = "2026-08-31T20:00:00.000Z";

const targetResultRevision = {
  id: revisionId,
  revision: 1,
  createdAt: instant,
  snapshotVersion: 7
} as const;

const dnsLatestResultRevision = {
  ...targetResultRevision,
  cause: "MANUAL_DID_NOT_START",
  status: "DNS",
  reason: "DID_NOT_START"
} as const;

const baseEntry = {
  id: entryId,
  displayName: "Ada Löpare",
  organisationName: "Centrum OK",
  classId,
  className: "D21",
  courseVersionId,
  entryVersion: 3,
  didNotStartDecisionId: decisionId,
  decidedAt: instant,
  state: "WITHDRAWABLE",
  targetResultRevision,
  latestResultRevision: dnsLatestResultRevision,
  withdrawal: null
} as const;

describe("TASK 006F DNS-återtagningskontrakt", () => {
  it("separerar credentialprefix och minsta capability", () => {
    const accessCredential = `otid_org_did_not_start_withdrawal_v1.${requestId}.${"A".repeat(43)}`;
    expect(didNotStartWithdrawalAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential }))
      .toEqual({ formatVersion: 1, accessCredential });
    expect(didNotStartWithdrawalAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: accessCredential.replace("did_not_start_withdrawal", "did_not_start")
    }).success).toBe(false);
    expect(didNotStartWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      expiresAt: instant
    }).capability).toBe("WITHDRAW_DID_NOT_START");
  });

  it("validerar bounded minimal lista och samtliga tre livscykeltillstånd", () => {
    const response = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      withdrawalPolicyVersion: "did-not-start-withdrawal-v1",
      entries: [baseEntry]
    } as const;
    expect(didNotStartWithdrawalListResponseSchema.parse(response)).toEqual(response);

    const withdrawn = {
      ...baseEntry,
      state: "WITHDRAWN",
      withdrawal: {
        id: withdrawalId,
        reason: "ERRONEOUS_MANUAL_DNS",
        policyVersion: "did-not-start-withdrawal-v1",
        withdrawnAt: instant
      }
    } as const;
    expect(didNotStartWithdrawalListResponseSchema.safeParse({ ...response, entries: [withdrawn] }).success)
      .toBe(true);

    const superseded = {
      ...baseEntry,
      state: "SUPERSEDED",
      latestResultRevision: {
        id: laterRevisionId,
        revision: 2,
        cause: "CARD_READOUT",
        status: "OK",
        reason: "COMPLETE",
        createdAt: instant,
        snapshotVersion: 7
      }
    } as const;
    expect(didNotStartWithdrawalListResponseSchema.safeParse({ ...response, entries: [superseded] }).success)
      .toBe(true);
    const restoredAfterNt = {
      ...response,
      entries: [{
        ...superseded,
        latestResultRevision: {
          ...superseded.latestResultRevision,
          revision: 4,
          cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
        }
      }]
    };
    expect(didNotStartWithdrawalListResponseSchema.parse(restoredAfterNt)).toEqual(restoredAfterNt);
    expect(didNotStartWithdrawalListResponseSchema.safeParse({
      ...response,
      entries: [{ ...baseEntry, cardNumber: "12345" }]
    }).success).toBe(false);
  });

  it("avvisar motsägande state, target och senaste revision", () => {
    const wrap = (entry: unknown) => ({
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      withdrawalPolicyVersion: "did-not-start-withdrawal-v1",
      entries: [entry]
    });
    expect(didNotStartWithdrawalListResponseSchema.safeParse(wrap({
      ...baseEntry,
      state: "WITHDRAWN"
    })).success).toBe(false);
    expect(didNotStartWithdrawalListResponseSchema.safeParse(wrap({
      ...baseEntry,
      state: "SUPERSEDED"
    })).success).toBe(false);
    expect(didNotStartWithdrawalListResponseSchema.safeParse(wrap({
      ...baseEntry,
      latestResultRevision: { ...dnsLatestResultRevision, cause: "CARD_READOUT" }
    })).success).toBe(false);
    expect(didNotStartWithdrawalListResponseSchema.safeParse(wrap({
      ...baseEntry,
      latestResultRevision: { ...dnsLatestResultRevision, id: laterRevisionId }
    })).success).toBe(false);
  });

  it("fryser current facts, exakt decision/revision, policy och canonical request-id", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 3,
      expectedClassId: classId,
      expectedCourseVersionId: courseVersionId,
      expectedSnapshotVersion: 7,
      expectedDidNotStartDecisionId: decisionId,
      expectedResultRevision: { id: revisionId, revision: 1 },
      policyVersion: "did-not-start-withdrawal-v1"
    } as const;
    expect(didNotStartWithdrawalRequestSchema.parse(request)).toEqual(request);
    expect(didNotStartWithdrawalRequestSchema.safeParse({ ...request, expectedResultRevision: revisionId }).success)
      .toBe(false);
    expect(didNotStartWithdrawalRequestSchema.safeParse({ ...request, policyVersion: "did-not-start-withdrawal-v2" }).success)
      .toBe(false);
    expect(didNotStartWithdrawalIdempotencyKeySchema.parse(`did-not-start-withdrawal:${requestId}`))
      .toBe(`did-not-start-withdrawal:${requestId}`);
    expect(didNotStartWithdrawalIdempotencyKeySchema.safeParse(
      `did-not-start-withdrawal:${requestId.toUpperCase()}`
    ).success).toBe(false);
  });

  it("returnerar immutable withdrawalmetadata utan ny resultatstatus eller readout", () => {
    const response = {
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      withdrawalId,
      didNotStartDecisionId: decisionId,
      withdrawnResultRevisionId: revisionId,
      withdrawnResultRevision: 1,
      withdrawalPolicyVersion: "did-not-start-withdrawal-v1",
      reason: "ERRONEOUS_MANUAL_DNS",
      withdrawnAt: instant
    } as const;
    expect(didNotStartWithdrawalResponseSchema.parse(response)).toEqual(response);
    expect(didNotStartWithdrawalResponseSchema.safeParse({ ...response, status: "WITHDRAWN" }).success)
      .toBe(false);
    expect(didNotStartWithdrawalResponseSchema.safeParse({ ...response, readoutId: revisionId }).success)
      .toBe(false);
    expect(DID_NOT_START_WITHDRAWAL_POLICY_VERSION).toBe("did-not-start-withdrawal-v1");
  });

  it("ger endast stabila, detaljfria fel", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"]) {
      expect(didNotStartWithdrawalAdminErrorResponseSchema.parse({ formatVersion: 1, error }).error).toBe(error);
    }
  });
});
