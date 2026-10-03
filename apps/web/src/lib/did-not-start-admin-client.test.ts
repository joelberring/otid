import { describe, expect, it } from "vitest";
import {
  createDidNotStartAttempt,
  didNotStartBody,
  isDefinitiveDidNotStartRejection,
  parseDidNotStartCandidates,
  parseDidNotStartResponse,
  readDidNotStartAdminCsrf
} from "./did-not-start-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const decisionId = "10000000-0000-4000-8000-000000000006";
const resultId = "10000000-0000-4000-8000-000000000007";
const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;
const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  decisionPolicyVersion: "did-not-start-v1" as const,
  entries: [{
    id: entryId, displayName: "Ada Löpare", organisationName: null,
    classId, className: "D21", courseVersionId, entryVersion: 1,
    readiness: "READY" as const, latestResultRevision: null
  }]
};

describe("TASK 006E ej-start-klient", () => {
  it("validerar race och skapar strikt fryst intent", () => {
    const parsed = parseDidNotStartCandidates(candidates, raceId);
    const attempt = createDidNotStartAttempt(parsed.entries[0]!, parsed, cryptoStub);
    expect(didNotStartBody(attempt)).toEqual({
      formatVersion: 1, expectedEntryVersion: 1, expectedClassId: classId,
      expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 4,
      expectedLatestResultRevision: null, policyVersion: "did-not-start-v1"
    });
    expect(() => parseDidNotStartCandidates(candidates, classId)).toThrow();
    expect(() => createDidNotStartAttempt({ ...parsed.entries[0]!, readiness: "HAS_RESULT", latestResultRevision: {
      id: resultId, revision: 1, status: "OK", reason: "COMPLETE", createdAt: "2026-08-31T10:00:00Z", snapshotVersion: 4
    } }, parsed, cryptoStub)).toThrow();
  });

  it("binder DNS-svaret till exakt request, entry, snapshot och policy", () => {
    const attempt = createDidNotStartAttempt(candidates.entries[0]!, candidates, cryptoStub);
    const response = {
      formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
      didNotStartDecisionId: decisionId, resultRevisionId: resultId, revision: 1,
      cause: "MANUAL_DID_NOT_START" as const, status: "DNS" as const,
      reason: "DID_NOT_START" as const, decisionPolicyVersion: "did-not-start-v1" as const,
      snapshotVersion: 4, courseVersionId, decidedAt: "2026-08-31T10:00:00Z"
    };
    expect(parseDidNotStartResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseDidNotStartResponse({ ...response, revision: 2 }, attempt, raceId)).toThrow();
  });

  it("läser bara DNS-cookie och lämnar okänd commit icke-definitiv", () => {
    const csrf = "c".repeat(43);
    expect(readDidNotStartAdminCsrf(`otid_finalization_admin_csrf=${csrf}; otid_did_not_start_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/did-not-start"))).toBe(csrf);
    expect([400, 404, 409].every(isDefinitiveDidNotStartRejection)).toBe(true);
    expect([401, 403, 500, 502].some(isDefinitiveDidNotStartRejection)).toBe(false);
  });
});
