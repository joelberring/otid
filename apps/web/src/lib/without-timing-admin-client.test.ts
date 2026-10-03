import { describe, expect, it } from "vitest";
import { createWithoutTimingAttempt, isDefinitiveWithoutTimingRejection, parseWithoutTimingCandidates, readWithoutTimingAdminCsrf } from "./without-timing-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const targetId = "10000000-0000-4000-8000-000000000006";

const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  policyVersion: "without-timing-v1" as const,
  entries: [{
    id: entryId, displayName: "Ada Löpare", organisationName: null, classId, className: "D21",
    courseVersionId, entryVersion: 2, readiness: "READY" as const,
    targetResultRevision: { id: targetId, revision: 3, status: "OK" as const, reason: "COMPLETE" as const,
      cause: "CARD_READOUT" as const, createdAt: "2026-09-01T10:00:00.000Z", snapshotVersion: 4 }
  }]
};

describe("TASK 006M utan-tidtagning-klient", () => {
  it("fryser endast tekniskt OK/COMPLETE-targetmetadata", () => {
    const parsed = parseWithoutTimingCandidates(candidates, raceId);
    const attempt = createWithoutTimingAttempt(parsed.entries[0]!, parsed, { randomUUID: () => requestId } as Crypto);
    expect(attempt.request.expectedResultRevision).toEqual({ id: targetId, revision: 3, status: "OK", reason: "COMPLETE" });
    expect(() => createWithoutTimingAttempt({ ...parsed.entries[0]!, readiness: "ACTIVE_WITHOUT_TIMING", targetResultRevision: null }, parsed, { randomUUID: () => requestId } as Crypto)).toThrow();
  });
  it("läser endast egen CSRF-cookie och skiljer definitivt avslag från okänd commit", () => {
    const csrf = "c".repeat(43);
    expect(readWithoutTimingAdminCsrf(`otid_out_of_competition_admin_csrf=${csrf}; otid_without_timing_admin_csrf=${csrf}`, new URL("http://127.0.0.1:3000/admin/race/without-timing"))).toBe(csrf);
    expect([400, 404, 409, 413].every(isDefinitiveWithoutTimingRejection)).toBe(true);
    expect(isDefinitiveWithoutTimingRejection(500)).toBe(false);
  });
});
