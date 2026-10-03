import { describe, expect, it } from "vitest";
import {
  createResultDisqualificationWithdrawalAttempt,
  isDefinitiveResultDisqualificationWithdrawalRejection,
  parseResultDisqualificationWithdrawalResponse,
  parseResultDisqualificationWithdrawals,
  readResultDisqualificationWithdrawalAdminCsrf
} from "./result-disqualification-withdrawal-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const decisionId = "10000000-0000-4000-8000-000000000006";
const targetId = "10000000-0000-4000-8000-000000000007";
const dsqId = "10000000-0000-4000-8000-000000000008";
const absoluteId = "10000000-0000-4000-8000-000000000009";
const sourceId = "10000000-0000-4000-8000-00000000000a";
const withdrawalId = "10000000-0000-4000-8000-00000000000b";
const restorationId = "10000000-0000-4000-8000-00000000000c";
const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;
const list = {
  formatVersion: 1 as const, raceId, snapshotVersion: 5,
  policyVersion: "manual-disqualification-withdrawal-v1" as const,
  entries: [{
    id: entryId, displayName: "Ada Löpare", organisationName: "Centrum OK",
    classId, className: "D21", courseVersionId, entryVersion: 2,
    state: "WITHDRAWABLE" as const,
    resultDisqualificationDecisionId: decisionId,
    decidedAt: "2026-08-31T10:00:00.000Z",
    targetResultRevision: { id: targetId, revision: 1 },
    disqualifiedResultRevision: { id: dsqId, revision: 2 },
    absoluteResultRevision: { id: absoluteId, revision: 3 },
    restorationSourceResultRevision: {
      id: sourceId, revision: 3, status: "OK" as const, reason: "COMPLETE" as const
    },
    withdrawal: null
  }]
};

describe("TASK 006G DSQ-återtagningsklient", () => {
  it("fryser beslut, target, DSQ, absolut huvud och exakt restaureringskälla", () => {
    const parsed = parseResultDisqualificationWithdrawals(list, raceId);
    const attempt = createResultDisqualificationWithdrawalAttempt(parsed.entries[0]!, parsed, cryptoStub);
    expect(attempt.request).toEqual({
      formatVersion: 1, expectedEntryVersion: 2, expectedClassId: classId,
      expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 5,
      expectedResultDisqualificationDecisionId: decisionId,
      expectedTargetResultRevision: { id: targetId, revision: 1 },
      expectedDisqualifiedResultRevision: { id: dsqId, revision: 2 },
      expectedAbsoluteResultRevision: { id: absoluteId, revision: 3 },
      expectedRestorationSourceResultRevision: { id: sourceId, revision: 3, status: "OK", reason: "COMPLETE" },
      policyVersion: "manual-disqualification-withdrawal-v1"
    });
    expect(() => createResultDisqualificationWithdrawalAttempt({
      ...parsed.entries[0]!, state: "WITHDRAWN",
      withdrawal: {
        id: withdrawalId, restorationResultRevision: { id: restorationId, revision: 4 },
        policyVersion: "manual-disqualification-withdrawal-v1", withdrawnAt: "2026-08-31T11:00:00.000Z"
      }
    }, parsed, cryptoStub)).toThrow();
  });

  it("binder svaret till samma beslut, DSQ, källa, snapshot, bana och policy", () => {
    const attempt = createResultDisqualificationWithdrawalAttempt(list.entries[0]!, list, cryptoStub);
    const response = {
      formatVersion: 1 as const, replayed: false, requestId, raceId, entryId,
      resultDisqualificationWithdrawalId: withdrawalId,
      resultDisqualificationDecisionId: decisionId,
      disqualifiedResultRevisionId: dsqId,
      restorationSourceResultRevisionId: sourceId,
      restorationResultRevisionId: restorationId,
      revision: 4, cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const,
      status: "OK" as const, reason: "COMPLETE" as const,
      policyVersion: "manual-disqualification-withdrawal-v1" as const,
      snapshotVersion: 5, courseVersionId,
      withdrawnAt: "2026-08-31T11:00:00.000Z"
    };
    expect(parseResultDisqualificationWithdrawalResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseResultDisqualificationWithdrawalResponse({
      ...response, restorationSourceResultRevisionId: targetId
    }, attempt, raceId)).toThrow();
  });

  it("läser endast egen CSRF-cookie och auto-retryar inte 5xx", () => {
    const csrf = "c".repeat(43);
    expect(readResultDisqualificationWithdrawalAdminCsrf(
      `otid_result_disqualification_admin_csrf=${csrf}; otid_result_disqualification_withdrawal_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/disqualification-withdrawals")
    )).toBe(csrf);
    expect([400, 404, 409, 413].every(isDefinitiveResultDisqualificationWithdrawalRejection)).toBe(true);
    expect([401, 403, 500].some(isDefinitiveResultDisqualificationWithdrawalRejection)).toBe(false);
  });
});
