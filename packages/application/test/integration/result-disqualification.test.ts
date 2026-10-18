import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { type ResultDisqualificationWithdrawalListResponse } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import {
  decideDidNotStartAsAdmin, disqualifyResultAsAdmin, listResultDisqualificationCandidatesAsAdmin,
  listResultDisqualificationWithdrawalsAsAdmin, withdrawResultDisqualificationAsAdmin, ingestDeviceBatch,
  exportIofResultListAsAdmin, finalizeResultsAsAdmin, listDidNotStartCandidatesAsAdmin,
  listResultFinalizationCandidatesAsAdmin, publicResults
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006G manuell resultatdiskvalifikation och append-only återtagande PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T10:00:00.000Z");
  const usedAt = new Date("2026-09-01T10:02:00.000Z");

  type Capability =
    | "DISQUALIFY_RESULT"
    | "WITHDRAW_DISQUALIFICATION"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "DECIDE_DID_NOT_START";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T18:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T10:01:00.000Z"),
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

  async function disqualifyAda(raceId: string, marker: number) {
    const resultAdmin = await admin(raceId, "DISQUALIFY_RESULT", marker);
    const resultAuth = auth(raceId, resultAdmin.login);
    const listed = await listResultDisqualificationCandidatesAsAdmin(db, resultAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som diskvalifikationskandidat");
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status
      },
      policyVersion: "manual-disqualification-v1" as const
    };
    return { candidate, request, resultAuth };
  }

  function withdrawalRequest(
    entry: ResultDisqualificationWithdrawalListResponse["entries"][number],
    snapshotVersion: number
  ) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedResultDisqualificationDecisionId: entry.resultDisqualificationDecisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedDisqualifiedResultRevision: entry.disqualifiedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-disqualification-withdrawal-v1" as const
    };
  }

  it("bevarar aktiv DSQ över senare readout och återställer exakt källa med full historik", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await disqualifyAda(fixture.raceId, 31);
    const requestId = crypto.randomUUID();
    const disqualificationInput = {
      ...prepared.resultAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${requestId}`,
      request: prepared.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      disqualifyResultAsAdmin(db, disqualificationInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "disqualified")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "disqualified" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, decisionAudits, afterDecision] = await Promise.all([
      db.select().from(schema.resultDisqualificationDecisions)
        .where(eq(schema.resultDisqualificationDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(afterDecision.map((revision) => [revision.revision, revision.cause, revision.readoutId])).toEqual([
      [1, "CARD_READOUT", expect.any(String)],
      [2, "MANUAL_DISQUALIFICATION", null]
    ]);
    expect(afterDecision[1]).toMatchObject({
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION",
      disqualificationDecisionId: decisions[0]!.id,
      published: true
    });
    expect(afterDecision[1]?.evaluation).toEqual({
      ...afterDecision[0]!.evaluation,
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION"
    });

    const publicDisqualified = await publicResults(db, fixture.raceId);
    expect(publicDisqualified.formatVersion).toBe(7);
    expect(publicDisqualified.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION",
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    expect(publicDisqualified.results.find((result) => result.givenName === "Ada"))
      .not.toHaveProperty("position");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 41);
    const snapshot = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (snapshot.status !== "ok") throw new Error("DSQ-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(snapshot.bytes);
    expect(snapshotXml).toContain("<Status>Disqualified</Status>");
    expect(snapshotXml).not.toContain("<Position>");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const stillDisqualified = await publicResults(db, fixture.raceId);
    expect(stillDisqualified.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DSQ"
    }));

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DISQUALIFICATION", 51);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Diskvalifikationsåtertaganden saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    expect(candidate).toMatchObject({
      state: "WITHDRAWABLE",
      disqualifiedResultRevision: { revision: 2 },
      absoluteResultRevision: { revision: 3 },
      restorationSourceResultRevision: { revision: 3, status: "OK", reason: "COMPLETE" }
    });
    const withdrawalRequestId = crypto.randomUUID();
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification-withdrawal:${withdrawalRequestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const withdrawals = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawResultDisqualificationAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(withdrawals.every((withdrawal) => withdrawal.status === "withdrawn")).toBe(true);
    const withdrawalResponses = withdrawals.flatMap((withdrawal) =>
      withdrawal.status === "withdrawn" ? [withdrawal.response] : []
    );
    expect(new Set(withdrawalResponses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(withdrawalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [storedWithdrawals, withdrawalAudits, history] = await Promise.all([
      db.select().from(schema.resultDisqualificationWithdrawals)
        .where(eq(schema.resultDisqualificationWithdrawals.requestId, withdrawalRequestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, withdrawalRequestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(storedWithdrawals).toHaveLength(1);
    expect(withdrawalAudits).toHaveLength(1);
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DISQUALIFICATION",
      "CARD_READOUT",
      "MANUAL_DISQUALIFICATION_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      revision: 4,
      readoutId: null,
      disqualificationWithdrawalId: storedWithdrawals[0]!.id,
      status: "OK",
      reason: "COMPLETE"
    });
    expect(history[3]?.evaluation).toEqual(history[2]?.evaluation);
    await expect(db.update(schema.resultDisqualificationDecisions).set({ status: "DSQ" })
      .where(eq(schema.resultDisqualificationDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultDisqualificationWithdrawals)
      .where(eq(schema.resultDisqualificationWithdrawals.id, storedWithdrawals[0]!.id))).rejects.toThrow();

    const restoredPublic = await publicResults(db, fixture.raceId);
    expect(restoredPublic.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 4,
      status: "OK"
    }));
  }, 30_000);

  it("fryser DSQ som IOF Complete och lämnar de frysta bytesen oförändrade efter återtagande", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await disqualifyAda(fixture.raceId, 71);
    const disqualified = await disqualifyResultAsAdmin(db, {
      ...prepared.resultAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (disqualified.status !== "disqualified") throw new Error("Ada diskvalificerades inte");

    const dnsAdmin = await admin(fixture.raceId, "DECIDE_DID_NOT_START", 81);
    const dnsAuth = auth(fixture.raceId, dnsAdmin.login);
    const dnsCandidates = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (dnsCandidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const dnsCandidate = dnsCandidates.response.entries.find((entry) => entry.readiness === "READY");
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
        expectedSnapshotVersion: dnsCandidates.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    if (dns.status !== "decided") throw new Error("DNS-beslutet misslyckades");

    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 91);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const result = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(result.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
        expectedBasisHash: raceCandidate.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (raceResult.status !== "finalized") throw new Error("Loppet finaliserades inte");
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.completeXml).toContain("<Status>Disqualified</Status>");
    expect(frozenBefore.completeXml).toContain("<Status>DidNotStart</Status>");
    expect(frozenBefore.completeXml).not.toContain("<Position>");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_DISQUALIFICATION"');

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DISQUALIFICATION", 101);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningskandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate) throw new Error("DSQ-återtagningskandidaten saknas");
    const withdrawn = await withdrawResultDisqualificationAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    const current = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (current.status !== "ok") throw new Error("Aktuell finaliseringsbasis saknas");
    expect(current.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  });
});
