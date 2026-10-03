import { describe, expect, it } from "vitest";
import {
  didNotFinishAdminLoginRequestSchema,
  didNotFinishCandidateResponseSchema,
  didNotFinishIdempotencyKeySchema,
  didNotFinishRequestSchema,
  didNotFinishResponseSchema
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
  createdAt: "2026-09-01T10:00:00.000Z",
  snapshotVersion: 7
};

describe("didNotFinishAdmin", () => {
  it("separerar capability och lämnar bara minimal targetmetadata", () => {
    expect(didNotFinishAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_did_not_finish_v1.${ids.race}.${"a".repeat(43)}`
    }).success).toBe(true);
    const response = didNotFinishCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "did-not-finish-v1",
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
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|raw|startTime|finishTime|elapsedMs|split/i);
  });

  it("kräver strikt tekniskt OK eller MP-target endast för READY", () => {
    const base = {
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: "did-not-finish-v1",
      entries: [{
        id: ids.entry, displayName: "Ada", organisationName: null, classId: ids.class,
        className: "D21", courseVersionId: ids.course, entryVersion: 2,
        readiness: "READY", targetResultRevision: target
      }]
    } as const;
    expect(didNotFinishCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], targetResultRevision: null }]
    }).success).toBe(false);
    expect(didNotFinishCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], targetResultRevision: { ...target, status: "OK" } }]
    }).success).toBe(false);
    expect(didNotFinishCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], readiness: "ACTIVE_APPROVAL", targetResultRevision: null }]
    }).success).toBe(true);
    expect(didNotFinishCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], readiness: "ACTIVE_OUT_OF_COMPETITION", targetResultRevision: null }]
    }).success).toBe(true);
  });

  it("binder hela intentet och immutable DNF-svar utan resultatfakta", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 2,
      expectedClassId: ids.class,
      expectedCourseVersionId: ids.course,
      expectedSnapshotVersion: 7,
      expectedResultRevision: { id: ids.target, revision: 3, status: "MP" as const },
      policyVersion: "did-not-finish-v1"
    };
    expect(didNotFinishRequestSchema.parse(request)).toEqual(request);
    expect(didNotFinishRequestSchema.safeParse({ ...request, readoutId: ids.target }).success).toBe(false);
    expect(didNotFinishIdempotencyKeySchema.safeParse(`did-not-finish:${ids.request}`).success).toBe(true);
    expect(didNotFinishIdempotencyKeySchema.safeParse(`manual-disqualification:${ids.request}`).success).toBe(false);
    const response = didNotFinishResponseSchema.parse({
      formatVersion: 1,
      replayed: false,
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      didNotFinishDecisionId: ids.decision,
      targetResultRevisionId: ids.target,
      targetResultRevision: 3,
      resultRevisionId: ids.result,
      revision: 4,
      cause: "MANUAL_DID_NOT_FINISH",
      status: "DNF",
      reason: "DID_NOT_FINISH",
      policyVersion: "did-not-finish-v1",
      snapshotVersion: 7,
      courseVersionId: ids.course,
      decidedAt: "2026-09-01T10:01:00.000Z"
    });
    expect(JSON.stringify(response)).not.toMatch(/startTime|finishTime|elapsedMs|split|readoutId/i);
  });
});
