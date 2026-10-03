import { describe, expect, it } from "vitest";
import { createOutOfCompetitionWithdrawalAttempt, isDefinitiveOutOfCompetitionWithdrawalRejection, parseOutOfCompetitionWithdrawals, readOutOfCompetitionWithdrawalAdminCsrf } from "./out-of-competition-withdrawal-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001"; const entryId = "10000000-0000-4000-8000-000000000002"; const classId = "10000000-0000-4000-8000-000000000003"; const courseVersionId = "10000000-0000-4000-8000-000000000004"; const targetId = "10000000-0000-4000-8000-000000000005"; const oocId = "10000000-0000-4000-8000-000000000006"; const decisionId = "10000000-0000-4000-8000-000000000007"; const requestId = "10000000-0000-4000-8000-000000000008";
const withdrawals = { formatVersion: 1 as const, raceId, snapshotVersion: 4, policyVersion: "out-of-competition-withdrawal-v1" as const, entries: [{ id: entryId, displayName: "Ada Löpare", organisationName: null, classId, className: "D21", courseVersionId, entryVersion: 2, state: "WITHDRAWABLE" as const, notCompetingDecisionId: decisionId, decidedAt: "2026-09-01T10:00:00.000Z", targetResultRevision: { id: targetId, revision: 3 }, outOfCompetitionResultRevision: { id: oocId, revision: 4 }, absoluteResultRevision: { id: oocId, revision: 4 }, restorationSourceResultRevision: { id: targetId, revision: 3, status: "MP" as const, reason: "MISSING_CONTROL" as const, cause: "CARD_READOUT" as const }, withdrawal: null }] };

describe("TASK 006L OOC-återtagningsklient", () => {
  it("fryser hela OOC-kedjan och enda tillåtna withdrawal-orsaken", () => {
    const parsed = parseOutOfCompetitionWithdrawals(withdrawals, raceId);
    const attempt = createOutOfCompetitionWithdrawalAttempt(parsed.entries[0]!, parsed, { randomUUID: () => requestId } as Crypto);
    expect(attempt.request).toMatchObject({ expectedNotCompetingDecisionId: decisionId, expectedTargetResultRevision: { id: targetId, revision: 3 }, expectedOutOfCompetitionResultRevision: { id: oocId, revision: 4 }, reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" });
    expect(() => createOutOfCompetitionWithdrawalAttempt({ ...parsed.entries[0]!, state: "WITHDRAWN", withdrawal: { id: requestId, restorationResultRevision: { id: requestId, revision: 5 }, reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION", policyVersion: "out-of-competition-withdrawal-v1", withdrawnAt: "2026-09-01T11:00:00.000Z" } }, parsed, { randomUUID: () => requestId } as Crypto)).toThrow();
  });
  it("läser endast egen CSRF-cookie och markerar bara definitiva avslag", () => { const csrf = "c".repeat(43); expect(readOutOfCompetitionWithdrawalAdminCsrf(`otid_out_of_competition_withdrawal_admin_csrf=${csrf}; old_csrf=${csrf}`, new URL("http://127.0.0.1:3000/admin/race/out-of-competition-withdrawals"))).toBe(csrf); expect([400, 404, 409, 413].every(isDefinitiveOutOfCompetitionWithdrawalRejection)).toBe(true); expect(isDefinitiveOutOfCompetitionWithdrawalRejection(500)).toBe(false); });
});
