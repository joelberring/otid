import { describe, expect, it } from "vitest";
import {
  createResultDisqualificationAttempt,
  isDefinitiveResultDisqualificationRejection,
  parseResultDisqualificationCandidates,
  parseResultDisqualificationResponse,
  readResultDisqualificationAdminCsrf
} from "./result-disqualification-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const targetId = "10000000-0000-4000-8000-000000000006";
const decisionId = "10000000-0000-4000-8000-000000000007";
const resultId = "10000000-0000-4000-8000-000000000008";
const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;
const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  policyVersion: "manual-disqualification-v1" as const,
  entries: [{
    id: entryId,
    displayName: "Ada Löpare",
    organisationName: null,
    classId,
    className: "D21",
    courseVersionId,
    entryVersion: 2,
    readiness: "READY" as const,
    targetResultRevision: {
      id: targetId, revision: 3, status: "MP" as const,
      reason: "MISSING_CONTROL" as const, cause: "CARD_READOUT" as const,
      createdAt: "2026-08-31T10:00:00.000Z", snapshotVersion: 4
    }
  }]
};

describe("TASK 006G diskvalifikationsklient", () => {
  it("fryser exakt READY-target först när operatören granskar", () => {
    const parsed = parseResultDisqualificationCandidates(candidates, raceId);
    expect(createResultDisqualificationAttempt(parsed.entries[0]!, parsed, cryptoStub)).toEqual({
      requestId, entryId, displayName: "Ada Löpare", className: "D21",
      request: {
        formatVersion: 1, expectedEntryVersion: 2, expectedClassId: classId,
        expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 4,
        expectedResultRevision: { id: targetId, revision: 3, status: "MP" },
        policyVersion: "manual-disqualification-v1"
      }
    });
    expect(() => parseResultDisqualificationCandidates(candidates, classId)).toThrow();
    expect(() => createResultDisqualificationAttempt({
      ...parsed.entries[0]!, readiness: "STALE_RESULT", targetResultRevision: null
    }, parsed, cryptoStub)).toThrow();
  });

  it("binder 2xx-svaret till request, lopp, entry, target, snapshot, bana och policy", () => {
    const attempt = createResultDisqualificationAttempt(candidates.entries[0]!, candidates, cryptoStub);
    const response = {
      formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
      resultDisqualificationDecisionId: decisionId,
      targetResultRevisionId: targetId, targetResultRevision: 3,
      resultRevisionId: resultId, revision: 4,
      cause: "MANUAL_DISQUALIFICATION" as const,
      status: "DSQ" as const, reason: "MANUAL_DISQUALIFICATION" as const,
      policyVersion: "manual-disqualification-v1" as const,
      snapshotVersion: 4, courseVersionId,
      decidedAt: "2026-08-31T11:00:00.000Z"
    };
    expect(parseResultDisqualificationResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseResultDisqualificationResponse({ ...response, targetResultRevision: 2 }, attempt, raceId)).toThrow();
  });

  it("läser endast egen CSRF-cookie och klassar 5xx som okänd commit", () => {
    const csrf = "c".repeat(43);
    expect(readResultDisqualificationAdminCsrf(
      `otid_result_disqualification_withdrawal_admin_csrf=${csrf}; otid_result_disqualification_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/disqualifications")
    )).toBe(csrf);
    expect([400, 404, 409, 413].every(isDefinitiveResultDisqualificationRejection)).toBe(true);
    expect([401, 403, 500, 502].some(isDefinitiveResultDisqualificationRejection)).toBe(false);
  });
});
