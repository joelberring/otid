import { describe, expect, it, vi } from "vitest";
import { DID_NOT_START_DECISION_POLICY_VERSION, DID_NOT_START_WITHDRAWAL_POLICY_VERSION } from "@o-tid/contracts";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, csrf, token, environment, session, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: resultat och export", () => {
  it("TASK048 binds frozen list and bytes to race and finalization under admin boundary", async () => {
    const metadata = { id: other, raceId: id, scope: "RACE" as const, classId: null, scopeRevision: 1,
      sourceSnapshotVersion: 1, basisHash: "a".repeat(64), frozenProjectionHash: "b".repeat(64),
      completeXmlSha256: "c".repeat(64), entryCount: 1, classCount: 1, finalizedAt: "2026-09-12T12:00:00Z" };
    const frozenResults = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId: id, finalizations: [metadata] } }));
    const frozenResult = vi.fn(async () => ({ status: "ok" as const, finalization: metadata, bytes: new TextEncoder().encode("frozen") }));
    const services = { ...dependencies(), frozenResults, frozenResult };
    const action = { kind: "frozen-result" as const, finalizationId: other };
    const list = await raceAdministratorRoute(db, request("GET"), id, { kind: "frozen-results" }, services, environment);
    expect(list.status).toBe(200); expect(list.headers.get("cache-control")).toContain("no-store");
    const response = await raceAdministratorRoute(db, request("GET"), id, action, services, environment);
    expect(response.status).toBe(200); expect(await response.text()).toBe("frozen");
    expect(response.headers.get("x-otid-finalization-id")).toBe(other);
    expect(response.headers.get("x-otid-content-sha256")).toBe(metadata.completeXmlSha256);
    for (const altered of [{ id }, { raceId: other }]) {
      frozenResult.mockResolvedValueOnce({ status: "ok", finalization: { ...metadata, ...altered }, bytes: new Uint8Array() });
      expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(500);
    }
    frozenResults.mockResolvedValueOnce({ status: "ok", response: { formatVersion: 1, raceId: id, finalizations: [{ ...metadata, raceId: other }] } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "frozen-results" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("GET"), id, { ...action, finalizationId: "bad" }, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    frozenResult.mockClear();
    services.authenticate.mockResolvedValueOnce({ status: "forbidden" });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(403);
    expect(frozenResult).not.toHaveBeenCalled();
  });
  it("TASK047 returns private XML only for the actual scoped administrator", async () => {
    const bytes = new TextEncoder().encode("<ResultList/>"), metadata = { formatVersion: 1 as const, raceId: id,
      snapshotVersion: 1, classCount: 0, resultCount: 0, staleResultCount: 0, omittedEntryCount: 1, sha256: "a".repeat(64) };
    const resultExport = vi.fn(async () => ({ status: "ok" as const, bytes, metadata }));
    const services = { ...dependencies(), resultExport }, action = { kind: "result-export" as const };
    const response = await raceAdministratorRoute(db, request("GET"), id, action, services, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("x-otid-omitted-entry-count")).toBe("1");
    expect(await response.text()).toBe("<ResultList/>");
    expect(resultExport).toHaveBeenCalledWith(db, { raceId: id, sessionToken: token });
    resultExport.mockResolvedValueOnce({ status: "ok", bytes, metadata: { ...metadata, raceId: other } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("GET"), id, action,
      { ...services, resultExport: async () => ({ status: "conflict" }) }, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("GET"), id, action,
      { ...services, resultExport: async () => ({ status: "too-large" }) }, environment)).status).toBe(413);
    resultExport.mockClear();
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: {
      accessCredentialId: id, raceId: id, capability: "EXPORT_IOF_RESULT_LIST", sessionId: id, expiresAt: session.expiresAt } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(403);
    expect(resultExport).not.toHaveBeenCalled();
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
  });
  it("TASK044 binds approval and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", approvalId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "MP", reason: "MISSING_CONTROL" }, policyVersion: "manual-result-approval-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultApprovalDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, targetReason: "MISSING_CONTROL" as const, resultRevisionId: approvalId,
      revision: 2, cause: "MANUAL_RESULT_APPROVAL" as const, status: "OK" as const, reason: "MANUAL_APPROVAL" as const,
      policyVersion: "manual-result-approval-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const approval = vi.fn(async () => ({ status: "approved" as const, response: receipt }));
    const services = { ...dependencies(), approval }, action = { kind: "approval" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `manual-result-approval:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      approval.mockResolvedValueOnce({ status: "approved", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultApprovalDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1, status: "MP", reason: "MISSING_CONTROL" },
      expectedApprovedResultRevision: { id: approvalId, revision: 2 }, expectedAbsoluteResultRevision: { id: approvalId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      policyVersion: "manual-result-approval-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultApprovalWithdrawalId: id, resultApprovalDecisionId: id, approvedResultRevisionId: approvalId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL",
      policyVersion: "manual-result-approval-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const approvalWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), approvalWithdrawal }, withdrawalAction = { kind: "approval-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `manual-result-approval-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ resultApprovalDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      approvalWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK042 binds DSQ and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", dsqId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "OK" }, policyVersion: "manual-disqualification-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultDisqualificationDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, resultRevisionId: dsqId,
      revision: 2, cause: "MANUAL_DISQUALIFICATION" as const, status: "DSQ" as const, reason: "MANUAL_DISQUALIFICATION" as const,
      policyVersion: "manual-disqualification-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dsq = vi.fn(async () => ({ status: "disqualified" as const, response: receipt }));
    const services = { ...dependencies(), dsq }, action = { kind: "disqualification" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `manual-disqualification:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      dsq.mockResolvedValueOnce({ status: "disqualified", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultDisqualificationDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1 },
      expectedDisqualifiedResultRevision: { id: dsqId, revision: 2 }, expectedAbsoluteResultRevision: { id: dsqId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      policyVersion: "manual-disqualification-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultDisqualificationWithdrawalId: id, resultDisqualificationDecisionId: id, disqualifiedResultRevisionId: dsqId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL",
      policyVersion: "manual-disqualification-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const dsqWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), dsqWithdrawal }, withdrawalAction = { kind: "disqualification-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `manual-disqualification-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ resultDisqualificationDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      dsqWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK041 binds DNF and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", dnfId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "OK" }, policyVersion: "did-not-finish-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotFinishDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, resultRevisionId: dnfId,
      revision: 2, cause: "MANUAL_DID_NOT_FINISH" as const, status: "DNF" as const, reason: "DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dnf = vi.fn(async () => ({ status: "did-not-finish" as const, response: receipt }));
    const services = { ...dependencies(), dnf }, action = { kind: "did-not-finish" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `did-not-finish:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      dnf.mockResolvedValueOnce({ status: "did-not-finish", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedDidNotFinishDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1 },
      expectedDidNotFinishResultRevision: { id: dnfId, revision: 2 }, expectedAbsoluteResultRevision: { id: dnfId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH", policyVersion: "did-not-finish-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotFinishWithdrawalId: id, didNotFinishDecisionId: id, didNotFinishResultRevisionId: dnfId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL", withdrawalReason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const dnfWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), dnfWithdrawal }, withdrawalAction = { kind: "did-not-finish-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `did-not-finish-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ didNotFinishDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      dnfWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK040 binds DNS and withdrawal receipts with the shared admin and rejects invalid writes", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedLatestResultRevision: null, policyVersion: DID_NOT_START_DECISION_POLICY_VERSION };
    const dnsReceipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotStartDecisionId: id, resultRevisionId: other, revision: 1 as const, cause: "MANUAL_DID_NOT_START" as const,
      status: "DNS" as const, reason: "DID_NOT_START" as const, decisionPolicyVersion: DID_NOT_START_DECISION_POLICY_VERSION as typeof DID_NOT_START_DECISION_POLICY_VERSION,
      snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dns = vi.fn(async () => ({ status: "decided" as const, response: dnsReceipt }));
    const services = { ...dependencies(), dns };
    const action = { kind: "did-not-start" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `did-not-start:${id}` });
    const result = await raceAdministratorRoute(db, req(), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { courseVersionId: id }, { snapshotVersion: 7 }]) {
      dns.mockResolvedValueOnce({ status: "decided", response: { ...dnsReceipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);

    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedDidNotStartDecisionId: id, expectedResultRevision: { id: other, revision: 1 },
      policyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION };
    const withdrawalReceipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      withdrawalId: id, didNotStartDecisionId: id, withdrawnResultRevisionId: other, withdrawnResultRevision: 1,
      withdrawalPolicyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION as typeof DID_NOT_START_WITHDRAWAL_POLICY_VERSION, reason: "ERRONEOUS_MANUAL_DNS" as const,
      withdrawnAt: "2026-09-12T12:01:00Z" };
    const dnsWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: withdrawalReceipt }));
    const withdrawalServices = { ...dependencies(), dnsWithdrawal }, withdrawalAction = { kind: "did-not-start-withdrawal" as const, entryId: other };
    const withdrawalRequest = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `did-not-start-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawalRequest(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { didNotStartDecisionId: other },
      { withdrawnResultRevisionId: id }, { withdrawnResultRevision: 2 }]) {
      dnsWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...withdrawalReceipt, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawalRequest(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK039 read-only history binds scope/cursor, rejects unknown queries and keeps admin boundary", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: other, entryVersion: 6, snapshotVersion: 8,
      generatedAt: "2026-09-12T12:00:00Z", timeZone: "Europe/Stockholm", items: [], nextBeforeVersion: null };
    const changes = vi.fn(async () => ({ status: "ok" as const, response }));
    const services = { ...dependencies(), changes }, action = { kind: "changes" as const, entryId: other };
    const req = (query = "") => new Request(`https://otid.example/api/admin${query}`, { headers: request("GET").headers });
    const result = await raceAdministratorRoute(db, req("?beforeVersion=6"), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(changes).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: other, beforeVersion: 6 }));
    for (const query of ["?beforeVersion=0", "?beforeVersion=01", "?beforeVersion=2147483648", "?beforeVersion=2&beforeVersion=3", "?name=private"]) {
      expect((await raceAdministratorRoute(db, req(query), id, action, services, environment)).status).toBe(400);
    }
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    for (const altered of [{ raceId: other }, { entryId: id }]) {
      changes.mockResolvedValueOnce({ status: "ok", response: { ...response, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const calls = changes.mock.calls.length;
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(401);
    expect(changes).toHaveBeenCalledTimes(calls);
  });
  it("TASK033 binds single-entry effective result to private race and entry scope", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: id, history: [], entryVersion: 1, currentClassId: id,
      snapshotVersion: 1, generatedAt: "2026-09-12T12:00:00.000Z", timeZone: "Europe/Stockholm",
      state: "NO_PUBLISHED_RESULT" as const, selectedRevision: null };
    const effectiveResult = vi.fn(async () => ({ status: "ok" as const, response }));
    const services = { ...dependencies(), effectiveResult };
    const result = await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(effectiveResult).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: id }));
    for (const change of [{ entryId: other }, { raceId: other }]) {
      effectiveResult.mockResolvedValueOnce({ status: "ok", response: { ...response, ...change } });
      expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("POST"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(401);
  });
  it("TASK091 binds one class manifest and its exact atomic receipt", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, classId: other, className: "D21", snapshotVersion: 2,
      engineVersion: "test-engine", manifestHash: "a".repeat(64), entries: [{ id: other, entryVersion: 1,
        displayName: "Ada Test", readiness: "READY" as const, cardAssignmentId: id, readoutId: id,
        latestResultRevision: { id, revision: 1, snapshotVersion: 1 } }] };
    const body = { formatVersion: 1 as const, classId: other, snapshotVersion: 2, engineVersion: "test-engine",
      manifestHash: candidate.manifestHash, entryIds: [other] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, classId: other,
      manifestHash: candidate.manifestHash, snapshotVersion: 2, engineVersion: "test-engine",
      recalculatedAt: "2026-09-19T12:00:00Z", items: [{ entryId: other, resultRevisionId: id, revision: 2 }] };
    const classResultRecalculationCandidates = vi.fn<typeof import("@o-tid/application").listClassResultRecalculationCandidatesAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const classResultRecalculate = vi.fn<typeof import("@o-tid/application").recalculateClassResultsAsAdministrator>()
      .mockResolvedValue({ status: "recalculated", response: receipt });
    const services = { ...dependencies(), classResultRecalculationCandidates, classResultRecalculate };
    const action = { kind: "class-result-recalculation" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}`
    } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(classResultRecalculationCandidates).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `class-result-recalculation:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(classResultRecalculate).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `class-result-recalculation:${id}`, request: body }));
    classResultRecalculate.mockResolvedValueOnce({ status: "recalculated", response: { ...receipt, items: [] } as never });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `class-result-recalculation:${id}` }), id, action, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("PATCH"), id, action, services, environment)).status).toBe(405);
  });
  it("TASK032 binder omräkningskvittens och privat kandidatscope", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedSnapshotVersion: 3,
      expectedCardAssignmentId: id, expectedReadoutId: id, expectedLatestResultRevision: { id, revision: 4 }, expectedEngineVersion: "test-engine" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      readoutId: id, resultRevisionId: other, revision: 5, cause: "EXPLICIT_RECALCULATION" as const,
      status: "OK" as const, reason: "COMPLETE" as const, engineVersion: "test-engine", snapshotVersion: 3,
      courseVersionId: id, recalculatedAt: "2026-09-12T12:00:00Z" };
    const recalculate = vi.fn(async () => ({ status: "recalculated" as const, response: receipt }));
    const recalculationCandidates = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId: other, snapshotVersion: 3, engineVersion: "test-engine", entries: [] } }));
    const services = { ...dependencies(), recalculate, recalculationCandidates };
    const req = () => request("POST", JSON.stringify(body), { "idempotency-key": `result-recalculation:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(200);
    for (const change of [{ raceId: other }, { entryId: other }, { readoutId: other }, { requestId: other },
      { revision: 6 }, { snapshotVersion: 4 }, { engineVersion: "changed-engine" }]) {
      recalculate.mockResolvedValueOnce({ status: "recalculated", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "recalculation-candidates" }, services, environment)).status).toBe(500);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
});
