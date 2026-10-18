import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { type ResultApprovalWithdrawalListResponse } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import {
  decideDidNotStartAsAdmin, approveResultAsAdmin, listResultApprovalCandidatesAsAdmin,
  listResultApprovalWithdrawalsAsAdmin, withdrawResultApprovalAsAdmin, ingestDeviceBatch,
  exportIofResultListAsAdmin, finalizeResultsAsAdmin, listDidNotStartCandidatesAsAdmin,
  listResultFinalizationCandidatesAsAdmin, publicResults
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006H manuellt resultatgodkännande och exakt återtagande PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T11:00:00.000Z");
  const usedAt = new Date("2026-09-01T11:02:00.000Z");
  const missingControlPayload = {
    ...okPayload,
    punches: [31, 33].map((code, index) => ({
      code,
      punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
    }))
  };

  type Capability =
    | "APPROVE_RESULT"
    | "WITHDRAW_RESULT_APPROVAL"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "DECIDE_DID_NOT_START";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T19:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T11:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  function withdrawalRequest(
    entry: ResultApprovalWithdrawalListResponse["entries"][number],
    snapshotVersion: number
  ) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedResultApprovalDecisionId: entry.resultApprovalDecisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedApprovedResultRevision: entry.approvedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-result-approval-withdrawal-v1" as const
    };
  }

  async function finalizeAll(raceId: string, marker: number) {
    const finalAdmin = await admin(raceId, "FINALIZE_RESULTS", marker);
    const finalAuth = auth(raceId, finalAdmin.login);
    const classes = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classes.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classes.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classes.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const race = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (race.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalizedRace = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: race.response.snapshotVersion,
        expectedBasisHash: race.response.race.basisHash,
        expectedLatestScopeRevision: race.response.race.latestFinalization?.scopeRevision ?? null
      }
    }, { now: usedAt });
    if (finalizedRace.status !== "finalized") throw new Error("Loppet finaliserades inte");
    return finalizedRace.response.finalization.id;
  }

  it("godkänner tidsatt MP/MISSING_CONTROL exakt en gång, bevarar overlay över ingest och återställer exakt senaste tekniska huvud", async () => {
    const fixture = await importedRace();
    const firstIngest = await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    expect(firstIngest.acknowledgements[0]?.status).toBe("stored");
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 31);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const listed = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`Godkännandekandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som godkännandekandidat");
    expect(candidate.targetResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const approvalInput = {
      ...approvalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-result-approval:${requestId}`,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: candidate.targetResultRevision.id,
          revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status,
          reason: candidate.targetResultRevision.reason
        },
        policyVersion: "manual-result-approval-v1" as const
      }
    };
    const approvals = await Promise.all(Array.from({ length: 100 }, () =>
      approveResultAsAdmin(db, approvalInput, usedAt)
    ));
    expect(approvals.every((approval) => approval.status === "approved")).toBe(true);
    const approvalResponses = approvals.flatMap((approval) => approval.status === "approved" ? [approval.response] : []);
    expect(new Set(approvalResponses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(approvalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, decisionAudits, approvedHistory, rawAfterApproval, readoutsAfterApproval, raceAfterApproval] = await Promise.all([
      db.select().from(schema.resultApprovalDecisions).where(eq(schema.resultApprovalDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(approvedHistory).toHaveLength(2);
    expect(approvedHistory[1]).toMatchObject({
      revision: 2,
      cause: "MANUAL_RESULT_APPROVAL",
      status: "OK",
      reason: "MANUAL_APPROVAL",
      approvalDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(approvedHistory[1]?.evaluation).toEqual({
      ...approvedHistory[0]!.evaluation,
      status: "OK",
      reason: "MANUAL_APPROVAL"
    });
    expect(rawAfterApproval).toEqual(rawBefore);
    expect(readoutsAfterApproval).toEqual(readoutsBefore);
    expect(raceAfterApproval?.snapshotVersion).toBe(raceBefore?.snapshotVersion);

    const afterApproval = await publicResults(db, fixture.raceId);
    expect(afterApproval.formatVersion).toBe(7);
    expect(afterApproval.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "OK",
      reason: "MANUAL_APPROVAL",
      missingControls: [32],
      rankingState: "RANKED",
      position: 1
    }));

    const secondIngest = await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    expect(secondIngest.acknowledgements[0]?.status).toBe("stored");
    const stillApproved = await publicResults(db, fixture.raceId);
    expect(stillApproved.results).toContainEqual(expect.objectContaining({
      givenName: "Ada", revision: 2, status: "OK", reason: "MANUAL_APPROVAL"
    }));

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_RESULT_APPROVAL", 41);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const withdrawalList = await listResultApprovalWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (withdrawalList.status !== "ok") throw new Error("Godkännandeåtertaganden saknas");
    const withdrawalCandidate = withdrawalList.response.entries.find((entry) => entry.id === candidate.id);
    if (!withdrawalCandidate) throw new Error("Ada saknas som återtagningskandidat");
    expect(withdrawalCandidate).toMatchObject({
      state: "WITHDRAWABLE",
      targetResultRevision: { revision: 1, status: "MP", reason: "MISSING_CONTROL" },
      approvedResultRevision: { revision: 2 },
      absoluteResultRevision: { revision: 3 },
      restorationSourceResultRevision: { revision: 3, status: "OK", reason: "COMPLETE" }
    });

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 51);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("IOF-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(snapshotXml).toContain("<Status>OK</Status>");
    expect(snapshotXml).toContain('<SplitTime status="Missing">');
    expect(snapshotXml).not.toContain(decisions[0]!.id);
    expect(snapshotXml).not.toContain(candidate.targetResultRevision.id);
    expect(snapshotXml).not.toContain("MANUAL_APPROVAL");

    const dnsAdmin = await admin(fixture.raceId, "DECIDE_DID_NOT_START", 61);
    const dnsAuth = auth(fixture.raceId, dnsAdmin.login);
    const dnsList = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (dnsList.status !== "ok") throw new Error("DNS-kandidater saknas");
    const dnsCandidate = dnsList.response.entries.find((entry) => entry.readiness === "READY");
    if (!dnsCandidate) throw new Error("Den andra deltagaren saknas");
    const dns = await decideDidNotStartAsAdmin(db, {
      ...dnsAuth,
      entryId: dnsCandidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: dnsCandidate.entryVersion,
        expectedClassId: dnsCandidate.classId,
        expectedCourseVersionId: dnsCandidate.courseVersionId,
        expectedSnapshotVersion: dnsList.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    expect(dns.status).toBe("decided");

    const frozenFinalizationId = await finalizeAll(fixture.raceId, 71);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenFinalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_RESULT_APPROVAL"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(withdrawalCandidate.absoluteResultRevision.id);
    expect(frozenBefore.completeXml).toContain("<Status>OK</Status>");
    expect(frozenBefore.completeXml).toContain('<SplitTime status="Missing">');
    expect(frozenBefore.completeXml).not.toContain(decisions[0]!.id);

    const withdrawalRequestId = crypto.randomUUID();
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: withdrawalCandidate.id,
      idempotencyKey: `manual-result-approval-withdrawal:${withdrawalRequestId}`,
      request: withdrawalRequest(withdrawalCandidate, withdrawalList.response.snapshotVersion)
    };
    const withdrawals = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawResultApprovalAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(withdrawals.every((withdrawal) => withdrawal.status === "withdrawn")).toBe(true);
    const withdrawalResponses = withdrawals.flatMap((withdrawal) => withdrawal.status === "withdrawn" ? [withdrawal.response] : []);
    expect(new Set(withdrawalResponses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(withdrawalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [storedWithdrawals, withdrawalAudits, history, frozenAfter] = await Promise.all([
      db.select().from(schema.resultApprovalWithdrawals).where(eq(schema.resultApprovalWithdrawals.requestId, withdrawalRequestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, withdrawalRequestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, frozenFinalizationId)).then((rows) => rows[0])
    ]);
    expect(storedWithdrawals).toHaveLength(1);
    expect(withdrawalAudits).toHaveLength(1);
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_RESULT_APPROVAL",
      "CARD_READOUT",
      "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      revision: 4,
      readoutId: null,
      approvalWithdrawalId: storedWithdrawals[0]!.id,
      status: "OK",
      reason: "COMPLETE"
    });
    expect(history[3]?.evaluation).toEqual(history[2]?.evaluation);
    await expect(db.update(schema.resultApprovalDecisions).set({ status: "OK" })
      .where(eq(schema.resultApprovalDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultApprovalWithdrawals)
      .where(eq(schema.resultApprovalWithdrawals.id, storedWithdrawals[0]!.id))).rejects.toThrow();
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("fail-closed för ett tekniskt OK som inte är ett godkännandekandidatutfall", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 91);
    const listed = await listResultApprovalCandidatesAsAdmin(db, auth(fixture.raceId, approvalAdmin.login), usedAt);
    if (listed.status !== "ok") throw new Error(`Godkännandekandidater saknas: ${listed.status}`);
    const ada = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    expect(ada).toMatchObject({ readiness: "UNSUPPORTED_RESULT", targetResultRevision: null });
  });
});
