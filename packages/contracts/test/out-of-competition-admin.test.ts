import { describe, expect, it } from "vitest";
import {
  OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
  outOfCompetitionAdminLoginRequestSchema,
  outOfCompetitionCandidateResponseSchema,
  outOfCompetitionIdempotencyKeySchema,
  outOfCompetitionRequestSchema,
  outOfCompetitionResponseSchema
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

describe("outOfCompetitionAdmin", () => {
  it("har separat capability och endast minimal kandidatmetadata", () => {
    expect(outOfCompetitionAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: `otid_org_out_of_competition_v1.${ids.race}.${"a".repeat(43)}`
    }).success).toBe(true);
    const response = outOfCompetitionCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
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
    expect(JSON.stringify(response)).not.toMatch(/cardNumber|punches|evaluation|raw|elapsedMs|splits/i);
  });

  it("binder READY till exakt strikt tekniskt OK eller MP-target", () => {
    const base = {
      formatVersion: 1,
      raceId: ids.race,
      snapshotVersion: 7,
      policyVersion: OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
      entries: [{
        id: ids.entry, displayName: "Ada", organisationName: null, classId: ids.class,
        className: "D21", courseVersionId: ids.course, entryVersion: 2,
        readiness: "READY", targetResultRevision: target
      }]
    } as const;
    expect(outOfCompetitionCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], targetResultRevision: null }]
    }).success).toBe(false);
    expect(outOfCompetitionCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], targetResultRevision: { ...target, status: "OK" } }]
    }).success).toBe(false);
    expect(outOfCompetitionCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], readiness: "ACTIVE_DID_NOT_FINISH", targetResultRevision: null }]
    }).success).toBe(true);
    expect(outOfCompetitionCandidateResponseSchema.safeParse({
      ...base, entries: [{ ...base.entries[0], id: ids.entry } as typeof base.entries[0], {
        ...base.entries[0], targetResultRevision: { ...target, id: ids.target }
      }]
    }).success).toBe(false);
  });

  it("låser intent, idempotens och reciprocal OOC-svar", () => {
    const request = {
      formatVersion: 1,
      expectedEntryVersion: 2,
      expectedClassId: ids.class,
      expectedCourseVersionId: ids.course,
      expectedSnapshotVersion: 7,
      expectedResultRevision: { id: ids.target, revision: 3, status: "MP" as const },
      policyVersion: OUT_OF_COMPETITION_DECISION_POLICY_VERSION
    };
    expect(outOfCompetitionRequestSchema.parse(request)).toEqual(request);
    expect(outOfCompetitionRequestSchema.safeParse({ ...request, readoutId: ids.target }).success).toBe(false);
    expect(outOfCompetitionIdempotencyKeySchema.parse(`out-of-competition:${ids.request}`))
      .toBe(`out-of-competition:${ids.request}`);
    expect(outOfCompetitionIdempotencyKeySchema.safeParse(`did-not-finish:${ids.request}`).success).toBe(false);

    const response = {
      formatVersion: 1,
      replayed: false,
      requestId: ids.request,
      raceId: ids.race,
      entryId: ids.entry,
      notCompetingDecisionId: ids.decision,
      targetResultRevisionId: ids.target,
      targetResultRevision: 3,
      resultRevisionId: ids.result,
      revision: 4,
      cause: "MANUAL_OUT_OF_COMPETITION",
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      policyVersion: OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
      snapshotVersion: 7,
      courseVersionId: ids.course,
      decidedAt: "2026-09-01T10:01:00.000Z"
    } as const;
    expect(outOfCompetitionResponseSchema.parse(response)).toEqual(response);
    expect(outOfCompetitionResponseSchema.safeParse({ ...response, revision: 5 }).success).toBe(false);
    expect(outOfCompetitionResponseSchema.safeParse({
      ...response, resultRevisionId: ids.target
    }).success).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/readoutId|startTime|finishTime|elapsedMs|splits/i);
  });
});
