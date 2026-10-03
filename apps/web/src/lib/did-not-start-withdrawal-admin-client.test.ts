import { describe, expect, it } from "vitest";
import {
  createDidNotStartWithdrawalAttempt,
  isDefinitiveDidNotStartWithdrawalRejection,
  parseDidNotStartWithdrawalResponse,
  parseDidNotStartWithdrawals,
  readDidNotStartWithdrawalAdminCsrf
} from "./did-not-start-withdrawal-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const decisionId = "10000000-0000-4000-8000-000000000006";
const resultId = "10000000-0000-4000-8000-000000000007";
const withdrawalId = "10000000-0000-4000-8000-000000000008";
const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;
const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  withdrawalPolicyVersion: "did-not-start-withdrawal-v1" as const,
  entries: [{
    id: entryId,
    displayName: "Ada Löpare",
    organisationName: null,
    classId,
    className: "D21",
    courseVersionId,
    entryVersion: 2,
    didNotStartDecisionId: decisionId,
    decidedAt: "2026-08-31T10:00:00.000Z",
    state: "WITHDRAWABLE" as const,
    targetResultRevision: {
      id: resultId,
      revision: 1,
      createdAt: "2026-08-31T10:00:00.000Z",
      snapshotVersion: 4
    },
    latestResultRevision: {
      id: resultId,
      revision: 1,
      cause: "MANUAL_DID_NOT_START" as const,
      status: "DNS" as const,
      reason: "DID_NOT_START" as const,
      createdAt: "2026-08-31T10:00:00.000Z",
      snapshotVersion: 4
    },
    withdrawal: null
  }]
};

describe("TASK 006F DNS-återtagningsklient", () => {
  it("validerar loppet och skapar ett exakt fryst intent först efter ett aktuellt target", () => {
    const parsed = parseDidNotStartWithdrawals(candidates, raceId);
    const attempt = createDidNotStartWithdrawalAttempt(parsed.entries[0]!, parsed, cryptoStub);
    expect(attempt).toEqual({
      requestId,
      entryId,
      displayName: "Ada Löpare",
      className: "D21",
      request: {
        formatVersion: 1,
        expectedEntryVersion: 2,
        expectedClassId: classId,
        expectedCourseVersionId: courseVersionId,
        expectedSnapshotVersion: 4,
        expectedDidNotStartDecisionId: decisionId,
        expectedResultRevision: { id: resultId, revision: 1 },
        policyVersion: "did-not-start-withdrawal-v1"
      }
    });
    expect(() => parseDidNotStartWithdrawals(candidates, classId)).toThrow();
    expect(() => createDidNotStartWithdrawalAttempt({
      ...parsed.entries[0]!,
      state: "WITHDRAWN",
      withdrawal: {
        id: withdrawalId,
        reason: "ERRONEOUS_MANUAL_DNS",
        policyVersion: "did-not-start-withdrawal-v1",
        withdrawnAt: "2026-08-31T11:00:00.000Z"
      }
    }, parsed, cryptoStub)).toThrow();
  });

  it("binder svaret till samma request, lopp, entry, beslut, target och policy", () => {
    const attempt = createDidNotStartWithdrawalAttempt(candidates.entries[0]!, candidates, cryptoStub);
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      raceId,
      entryId,
      withdrawalId,
      didNotStartDecisionId: decisionId,
      withdrawnResultRevisionId: resultId,
      withdrawnResultRevision: 1,
      withdrawalPolicyVersion: "did-not-start-withdrawal-v1" as const,
      reason: "ERRONEOUS_MANUAL_DNS" as const,
      withdrawnAt: "2026-08-31T11:00:00.000Z"
    };
    expect(parseDidNotStartWithdrawalResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseDidNotStartWithdrawalResponse({ ...response, withdrawnResultRevision: 2 }, attempt, raceId))
      .toThrow();
  });

  it("läser endast återtagningscookien och klassar nät/5xx som icke-definitiva", () => {
    const csrf = "c".repeat(43);
    expect(readDidNotStartWithdrawalAdminCsrf(
      `otid_did_not_start_admin_csrf=${csrf}; otid_dns_withdrawal_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/did-not-start-withdrawals")
    )).toBe(csrf);
    expect([400, 404, 409, 413].every(isDefinitiveDidNotStartWithdrawalRejection)).toBe(true);
    expect([401, 403, 500, 502].some(isDefinitiveDidNotStartWithdrawalRejection)).toBe(false);
  });
});
