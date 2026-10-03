import { describe, expect, it } from "vitest";
import {
  resultDisqualificationAdminLoginRequestSchema,
  resultDisqualificationCandidateResponseSchema,
  resultDisqualificationIdempotencyKeySchema,
  resultDisqualificationRequestSchema,
  resultDisqualificationResponseSchema
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
  createdAt: "2026-08-31T20:00:00.000Z",
  snapshotVersion: 7
};

describe("resultDisqualificationAdmin", () => {
  it("validerar separat credential och exakt kandidat utan känsliga resultatfakta", () => {
    expect(resultDisqualificationAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_result_disqualification_v1.${ids.race}.${"a".repeat(43)}`
    }).success).toBe(true);
    const response = resultDisqualificationCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "manual-disqualification-v1",
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

  it("kräver target endast för READY och matchande status/reason", () => {
    const base = {
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "manual-disqualification-v1",
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
    expect(resultDisqualificationCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], targetResultRevision: null }]
    }).success).toBe(false);
    expect(resultDisqualificationCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], targetResultRevision: { ...target, status: "OK" } }]
    }).success).toBe(false);
    expect(resultDisqualificationCandidateResponseSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], readiness: "ACTIVE_OUT_OF_COMPETITION", targetResultRevision: null }]
    }).success).toBe(true);
  });

  it("binder hela muterbara intentet och strikt idempotensnyckel", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 2,
      expectedClassId: ids.class,
      expectedCourseVersionId: ids.course,
      expectedSnapshotVersion: 7,
      expectedResultRevision: { id: ids.target, revision: 3, status: "MP" },
      policyVersion: "manual-disqualification-v1"
    };
    expect(resultDisqualificationRequestSchema.parse(request)).toEqual(request);
    expect(resultDisqualificationRequestSchema.safeParse({ ...request, readoutId: ids.target }).success)
      .toBe(false);
    expect(resultDisqualificationIdempotencyKeySchema.safeParse(`manual-disqualification:${ids.request}`).success)
      .toBe(true);
    expect(resultDisqualificationIdempotencyKeySchema.safeParse(`did-not-start:${ids.request}`).success)
      .toBe(false);
  });

  it("validerar immutable decision- och DSQ-revisionssvar", () => {
    expect(resultDisqualificationResponseSchema.safeParse({
      formatVersion: 1,
      replayed: false,
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      resultDisqualificationDecisionId: ids.decision,
      targetResultRevisionId: ids.target,
      targetResultRevision: 3,
      resultRevisionId: ids.result,
      revision: 4,
      cause: "MANUAL_DISQUALIFICATION",
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION",
      policyVersion: "manual-disqualification-v1",
      snapshotVersion: 7,
      courseVersionId: ids.course,
      decidedAt: "2026-08-31T20:01:00.000Z"
    }).success).toBe(true);
  });
});
