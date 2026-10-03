import { describe, expect, it } from "vitest";
import {
  didNotStartAdminErrorResponseSchema,
  didNotStartAdminLoginRequestSchema,
  didNotStartAdminLoginResponseSchema,
  didNotStartCandidateResponseSchema,
  didNotStartIdempotencyKeySchema,
  didNotStartRequestSchema,
  didNotStartResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const raceId = "b0000000-0000-4000-8000-000000000002";
const entryId = "c0000000-0000-4000-8000-000000000003";
const classId = "d0000000-0000-4000-8000-000000000004";
const courseVersionId = "e0000000-0000-4000-8000-000000000005";
const decisionId = "f0000000-0000-4000-8000-000000000006";
const revisionId = "a0000000-0000-4000-8000-000000000007";
const instant = "2026-08-31T19:00:00.000Z";

describe("TASK 006E ej-startkontrakt", () => {
  it("separerar DNS-credentialprefix och capability", () => {
    const accessCredential = `otid_org_did_not_start_v1.${requestId}.${"A".repeat(43)}`;
    expect(didNotStartAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential }).accessCredential)
      .toBe(accessCredential);
    expect(didNotStartAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: accessCredential.replace("did_not_start", "result_recalc")
    }).success).toBe(false);
    expect(didNotStartAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId, capability: "DECIDE_DID_NOT_START", expiresAt: instant
    }).capability).toBe("DECIDE_DID_NOT_START");
  });

  it("exponerar endast kandidatens frysta operatörsunderlag", () => {
    const response = {
      formatVersion: 1,
      raceId,
      snapshotVersion: 7,
      decisionPolicyVersion: "did-not-start-v1",
      entries: [{
        id: entryId,
        displayName: "Ada Löpare",
        organisationName: "Centrum OK",
        classId,
        className: "D21",
        courseVersionId,
        entryVersion: 3,
        readiness: "READY",
        latestResultRevision: null
      }]
    } as const;
    expect(didNotStartCandidateResponseSchema.parse(response)).toEqual(response);
    expect(didNotStartCandidateResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], cardNumber: "12345" }]
    }).success).toBe(false);
    expect(didNotStartCandidateResponseSchema.safeParse({
      ...response,
      entries: [{ ...response.entries[0], readiness: "HAS_RESULT" }]
    }).success).toBe(false);
  });

  it("fryser tomt revisionshuvud, policy och canonical idempotensnyckel", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 3,
      expectedClassId: classId,
      expectedCourseVersionId: courseVersionId,
      expectedSnapshotVersion: 7,
      expectedLatestResultRevision: null,
      policyVersion: "did-not-start-v1"
    } as const;
    expect(didNotStartRequestSchema.parse(request)).toEqual(request);
    expect(didNotStartRequestSchema.safeParse({ ...request, expectedLatestResultRevision: { id: revisionId } }).success)
      .toBe(false);
    expect(didNotStartRequestSchema.safeParse({ ...request, policyVersion: "did-not-start-v2" }).success).toBe(false);
    expect(didNotStartIdempotencyKeySchema.parse(`did-not-start:${requestId}`)).toBe(`did-not-start:${requestId}`);
    expect(didNotStartIdempotencyKeySchema.safeParse(`did-not-start:${requestId.toUpperCase()}`).success).toBe(false);
  });

  it("låser det status-only svar som inte innehåller en readout", () => {
    const response = {
      formatVersion: 1,
      replayed: false,
      requestId,
      raceId,
      entryId,
      didNotStartDecisionId: decisionId,
      resultRevisionId: revisionId,
      revision: 1,
      cause: "MANUAL_DID_NOT_START",
      status: "DNS",
      reason: "DID_NOT_START",
      decisionPolicyVersion: "did-not-start-v1",
      snapshotVersion: 7,
      courseVersionId,
      decidedAt: instant
    } as const;
    expect(didNotStartResponseSchema.parse(response)).toEqual(response);
    expect(didNotStartResponseSchema.safeParse({ ...response, readoutId: decisionId }).success).toBe(false);
    expect(didNotStartResponseSchema.safeParse({ ...response, status: "MP" }).success).toBe(false);
  });

  it("ger endast stabila fel", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"]) {
      expect(didNotStartAdminErrorResponseSchema.parse({ formatVersion: 1, error }).error).toBe(error);
    }
  });
});
