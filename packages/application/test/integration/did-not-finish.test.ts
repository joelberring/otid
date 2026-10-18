import { describe, expect, it } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import { type DidNotFinishWithdrawalListResponse } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import {
  decideDidNotFinishAsAdmin, disqualifyResultAsAdmin, approveResultAsAdmin, listResultApprovalCandidatesAsAdmin,
  listResultDisqualificationCandidatesAsAdmin, ingestDeviceBatch, exportIofResultListAsAdmin,
  finalizeResultsAsAdmin, listDidNotFinishCandidatesAsAdmin, listDidNotFinishWithdrawalsAsAdmin,
  listResultFinalizationCandidatesAsAdmin, publicResults, withdrawDidNotFinishAsAdmin
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006I/006J explicit DNF lifecycle PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T12:00:00.000Z");
  const usedAt = new Date("2026-09-01T12:02:00.000Z");
  const missingControlPayload = {
    ...okPayload,
    punches: [31, 33].map((code, index) => ({
      code,
      punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
    }))
  };

  type Capability =
    | "DECIDE_DID_NOT_FINISH"
    | "WITHDRAW_DID_NOT_FINISH"
    | "APPROVE_RESULT"
    | "DISQUALIFY_RESULT"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T20:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T12:01:00.000Z"),
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

  async function readyDidNotFinish(raceId: string, marker: number) {
    const dnfAdmin = await admin(raceId, "DECIDE_DID_NOT_FINISH", marker);
    const dnfAuth = auth(raceId, dnfAdmin.login);
    const listed = await listDidNotFinishCandidatesAsAdmin(db, dnfAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-kandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som DNF-kandidat");
    return {
      dnfAuth,
      candidate,
      request: {
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
        policyVersion: "did-not-finish-v1" as const
      }
    };
  }

  async function activeDidNotFinishForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(raceId, marker);
    const decided = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (decided.status !== "did-not-finish") throw new Error("DNF-beslutet skapades inte");
    const withdrawalAdmin = await admin(raceId, "WITHDRAW_DID_NOT_FINISH", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalAdmin.login);
    const listed = await listDidNotFinishWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-återtaganden saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Aktivt DNF kan inte återtas");
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedDidNotFinishDecisionId: candidate.didNotFinishDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDidNotFinishResultRevision: candidate.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const
    };
    return { prepared, withdrawalAuth, candidate, request };
  }

  function personResultBody(xml: string, givenName: string): string {
    const match = xml.match(new RegExp(
      `<PersonResult>[\\s\\S]*?<Given>${givenName}</Given>[\\s\\S]*?<Result>([\\s\\S]*?)</Result>[\\s\\S]*?</PersonResult>`
    ));
    if (!match?.[1]) throw new Error(`${givenName} saknas i IOF-exporten`);
    return match[1];
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

  it("skriver DNF exakt en gång, bevarar overlay över ingest och fryser status-only DidNotFinish", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 111);
    expect(prepared.candidate.targetResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const dnfInput = {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${requestId}`,
      request: prepared.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideDidNotFinishAsAdmin(db, dnfInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "did-not-finish")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "did-not-finish" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.didNotFinishDecisionId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [decisions, decisionAudits, history, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotFinishDecisions).where(eq(schema.didNotFinishDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(decisionAudits[0]).toMatchObject({
      action: "DID_NOT_FINISH_DECIDED",
      actorKind: "DID_NOT_FINISH_ACCESS_CREDENTIAL"
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      revision: 2,
      cause: "MANUAL_DID_NOT_FINISH",
      status: "DNF",
      reason: "DID_NOT_FINISH",
      didNotFinishDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(history[1]?.evaluation).toEqual({
      status: "DNF",
      reason: "DID_NOT_FINISH",
      entryId: prepared.candidate.id,
      classId: prepared.candidate.classId,
      courseVersionId: prepared.candidate.courseVersionId
    });
    await expect(db.update(schema.didNotFinishDecisions).set({ status: "DNF" })
      .where(eq(schema.didNotFinishDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotFinishDecisions)
      .where(eq(schema.didNotFinishDecisions.id, decisions[0]!.id))).rejects.toThrow();
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);

    await expect(decideDidNotFinishAsAdmin(db, {
      ...dnfInput,
      request: {
        ...prepared.request,
        expectedResultRevision: { ...prepared.request.expectedResultRevision, status: "OK" as const }
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await decideDidNotFinishAsAdmin(db, dnfInput, usedAt)).toMatchObject({
      status: "did-not-finish",
      response: { replayed: true, didNotFinishDecisionId: decisions[0]!.id }
    });

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicDnf = await publicResults(db, fixture.raceId);
    expect(publicDnf.formatVersion).toBe(7);
    expect(publicDnf.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DNF",
      reason: "DID_NOT_FINISH",
      missingControls: [],
      extraPunches: [],
      splits: [],
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    expect(publicDnf.results.find((result) => result.givenName === "Ada")).not.toHaveProperty("elapsedMs");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 121);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("IOF-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(snapshotXml).toContain('status="Snapshot"');
    const snapshotDnf = personResultBody(snapshotXml, "Ada");
    expect(snapshotDnf).toContain("<Status>DidNotFinish</Status>");
    expect(snapshotDnf).not.toMatch(/<(StartTime|FinishTime|Time|TimeBehind|Position|SplitTime)(?:\s|>)/);

    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 131);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const approvalList = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (approvalList.status !== "ok") throw new Error("Godkännandekandidater saknas");
    expect(approvalList.response.entries.find((entry) => entry.id === prepared.candidate.id)).toMatchObject({
      readiness: "ACTIVE_DID_NOT_FINISH",
      targetResultRevision: null
    });

    const disqualificationAdmin = await admin(fixture.raceId, "DISQUALIFY_RESULT", 141);
    const disqualificationAuth = auth(fixture.raceId, disqualificationAdmin.login);
    const disqualificationList = await listResultDisqualificationCandidatesAsAdmin(db, disqualificationAuth, usedAt);
    if (disqualificationList.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    expect(disqualificationList.response.entries.find((entry) => entry.id === prepared.candidate.id)).toMatchObject({
      readiness: "ACTIVE_DID_NOT_FINISH",
      targetResultRevision: null
    });

    const latestTechnical = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
      .orderBy(desc(schema.resultRevisions.revision)))[0]!;
    expect(latestTechnical).toMatchObject({ revision: 3, status: "MP", reason: "MISSING_CONTROL" });
    const approvalRequestId = crypto.randomUUID();
    await expect(approveResultAsAdmin(db, {
      ...approvalAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-result-approval:${approvalRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: prepared.candidate.entryVersion,
        expectedClassId: prepared.candidate.classId,
        expectedCourseVersionId: prepared.candidate.courseVersionId,
        expectedSnapshotVersion: prepared.request.expectedSnapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "MP",
          reason: "MISSING_CONTROL"
        },
        policyVersion: "manual-result-approval-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const disqualificationRequestId = crypto.randomUUID();
    await expect(disqualifyResultAsAdmin(db, {
      ...disqualificationAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${disqualificationRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: prepared.candidate.entryVersion,
        expectedClassId: prepared.candidate.classId,
        expectedCourseVersionId: prepared.candidate.courseVersionId,
        expectedSnapshotVersion: prepared.request.expectedSnapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "MP"
        },
        policyVersion: "manual-disqualification-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.resultApprovalDecisions)
      .where(eq(schema.resultApprovalDecisions.requestId, approvalRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.requestId, disqualificationRequestId))).toHaveLength(0);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalizationId = await finalizeAll(fixture.raceId, 151);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_DID_NOT_FINISH"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    expect(frozenBefore.completeXml).toContain('status="Complete"');
    const completeDnf = personResultBody(frozenBefore.completeXml, "Ada");
    expect(completeDnf).toContain("<Status>DidNotFinish</Status>");
    expect(completeDnf).not.toMatch(/<(StartTime|FinishTime|Time|TimeBehind|Position|SplitTime)(?:\s|>)/);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:42:00Z"
    }));
    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("återtar DNF exakt append-only, restaurerar senaste tekniska källa och tillåter nytt DNF först efter ny teknik", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 191);
    const decided = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (decided.status !== "did-not-finish") throw new Error("DNF-beslutet skapades inte");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const frozenId = await finalizeAll(fixture.raceId, 201);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenId));
    if (!frozenBefore?.completeXml || !frozenBefore.completeXmlHash) {
      throw new Error("Fryst DNF-Complete saknas");
    }
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(personResultBody(frozenBefore.completeXml, "Ada")).toContain("<Status>DidNotFinish</Status>");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_FINISH", 211);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotFinishWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-återtaganden saknas: ${listed.status}`);
    const candidate: DidNotFinishWithdrawalListResponse["entries"][number] | undefined =
      listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Ada kan inte återtas från DNF");
    expect(candidate.restorationSourceResultRevision).toMatchObject(candidate.absoluteResultRevision);
    expect(candidate.restorationSourceResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const withdrawalRequest = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedDidNotFinishDecisionId: candidate.didNotFinishDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDidNotFinishResultRevision: candidate.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const
    };
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${requestId}`,
      request: withdrawalRequest
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawDidNotFinishAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.didNotFinishWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [withdrawals, audits, history, rawAfter, readoutsAfter, raceAfter, frozenAfter] = await Promise.all([
      db.select().from(schema.didNotFinishWithdrawals).where(eq(schema.didNotFinishWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0]),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, frozenId)).then((rows) => rows[0])
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "DID_NOT_FINISH_WITHDRAWN",
      actorKind: "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH",
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      status: "MP",
      reason: "MISSING_CONTROL",
      readoutId: null,
      didNotFinishDecisionId: null,
      didNotFinishWithdrawalId: withdrawals[0]!.id,
      published: true
    });
    expect(history[3]!.evaluation).toEqual(history[2]!.evaluation);
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    await expect(db.update(schema.didNotFinishWithdrawals).set({ reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" })
      .where(eq(schema.didNotFinishWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotFinishWithdrawals)
      .where(eq(schema.didNotFinishWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(withdrawDidNotFinishAsAdmin(db, {
      ...withdrawalInput,
      request: { ...withdrawalRequest, expectedEntryVersion: withdrawalRequest.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicRestored = await publicResults(db, fixture.raceId);
    expect(publicRestored.formatVersion).toBe(7);
    expect(publicRestored.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 4,
      status: "MP",
      reason: "MISSING_CONTROL",
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 221);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Restaurerad IOF Snapshot saknas");
    const restoredXml = new TextDecoder().decode(exported.bytes);
    expect(personResultBody(restoredXml, "Ada")).toContain("<Status>MissingPunch</Status>");
    expect(restoredXml).not.toContain(withdrawals[0]!.id);

    const restoredFinalizationId = await finalizeAll(fixture.raceId, 241);
    const [restoredFinalization] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, restoredFinalizationId));
    if (!restoredFinalization?.completeXml) throw new Error("Restaurerad Complete saknas");
    expect(restoredFinalization.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(restoredFinalization.frozenProjection))
      .toContain('"kind":"MANUAL_DID_NOT_FINISH_WITHDRAWAL"');
    expect(personResultBody(restoredFinalization.completeXml, "Ada"))
      .toContain("<Status>MissingPunch</Status>");
    const [frozenStillStable] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenId));
    expect(frozenStillStable?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenStillStable?.completeXmlHash).toBe(frozenBefore.completeXmlHash);

    const immediateCandidates = await listDidNotFinishCandidatesAsAdmin(db, prepared.dnfAuth, usedAt);
    if (immediateCandidates.status !== "ok") throw new Error("DNF-kandidater saknas efter återtagande");
    expect(immediateCandidates.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "UNSUPPORTED_RESULT",
      targetResultRevision: null
    });
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const laterCandidates = await listDidNotFinishCandidatesAsAdmin(db, prepared.dnfAuth, usedAt);
    if (laterCandidates.status !== "ok") throw new Error("Nya tekniska DNF-kandidater saknas");
    const later = laterCandidates.response.entries.find((entry) => entry.id === candidate.id);
    if (!later?.targetResultRevision) throw new Error("Ny direkt teknisk DNF-källa saknas");
    expect(later).toMatchObject({ readiness: "READY", targetResultRevision: { revision: 5 } });
    const secondDnf = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: later.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: later.entryVersion,
        expectedClassId: later.classId,
        expectedCourseVersionId: later.courseVersionId,
        expectedSnapshotVersion: laterCandidates.response.snapshotVersion,
        expectedResultRevision: {
          id: later.targetResultRevision.id,
          revision: later.targetResultRevision.revision,
          status: later.targetResultRevision.status
        },
        policyVersion: "did-not-finish-v1"
      }
    }, usedAt);
    expect(secondDnf.status).toBe("did-not-finish");
    expect(await db.select().from(schema.didNotFinishDecisions)
      .where(eq(schema.didNotFinishDecisions.entryId, candidate.id))).toHaveLength(2);
  }, 30_000);

  it("ger exakt en vinnare för två samtidiga DNF-återtaganden med olika request-id", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 41);
    const [first, second] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      withdrawDidNotFinishAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    const [withdrawals, revisions, audits] = await Promise.all([
      db.select().from(schema.didNotFinishWithdrawals)
        .where(eq(schema.didNotFinishWithdrawals.entryId, active.candidate.id)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(and(
        eq(schema.auditEvents.raceId, fixture.raceId),
        eq(schema.auditEvents.action, "DID_NOT_FINISH_WITHDRAWN")
      ))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH",
      "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
    ]);
  });

  it("serialiserar samtidig DNF-withdrawal och ingest utan källbyte eller revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 51);
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...missingControlPayload,
        finishPunchedAt: "2026-08-30T10:43:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, active.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision)).toEqual(
      revisions.map((_revision, index) => index + 1)
    );
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? [
            "CARD_READOUT",
            "MANUAL_DID_NOT_FINISH",
            "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
            "CARD_READOUT"
          ]
        : ["CARD_READOUT", "MANUAL_DID_NOT_FINISH", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      await expect(withdrawDidNotFinishAsAdmin(db, input, usedAt)).resolves.toMatchObject({
        status: "withdrawn",
        response: { replayed: true }
      });
    }
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "DID_NOT_FINISH_WITHDRAWN")
    ));
    expect(audits).toHaveLength(withdrawal.status === "withdrawn" ? 1 : 0);
  });

  it("serialiserar samtidig DNF-withdrawal och loppsfinalisering till ett helt före- eller efterläge", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 61);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 67);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("Klassfinaliseringskandidater saknas");
    for (const candidate of classCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      const finalized = await finalizeResultsAsAdmin(db, {
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
      expect(finalized.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const withdrawalInput = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, finalization] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, withdrawalInput, usedAt),
      finalizeResultsAsAdmin(db, {
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
      }, { now: usedAt })
    ]);
    expect(withdrawal.status).toBe("withdrawn");
    expect(["finalized", "conflict"]).toContain(finalization.status);
    const raceFinalizations = await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "RACE")
    ));
    expect(raceFinalizations).toHaveLength(finalization.status === "finalized" ? 1 : 0);
    if (finalization.status === "finalized") {
      expect(raceFinalizations[0]?.completeXml).toContain("<Status>DidNotFinish</Status>");
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlaget efter withdrawal saknas");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  });

  it("avvisar stale DNF efter senare ingest utan beslut, audit eller resultatrevision", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 161);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const requestId = crypto.randomUUID();
    const [historyBefore, raceBefore] = await Promise.all([
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    await expect(decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${requestId}`,
      request: prepared.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const [decisions, audits, historyAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotFinishDecisions).where(eq(schema.didNotFinishDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(historyAfter).toEqual(historyBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
  });

  it("låter inte en senare teknisk revision kringgå ett aktivt approval vid DSQ", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 171);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const listed = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Godkännandekandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som godkännandekandidat");
    const approval = await approveResultAsAdmin(db, {
      ...approvalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-result-approval:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
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
        policyVersion: "manual-result-approval-v1"
      }
    }, usedAt);
    expect(approval.status).toBe("approved");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const disqualificationAdmin = await admin(fixture.raceId, "DISQUALIFY_RESULT", 181);
    const disqualificationAuth = auth(fixture.raceId, disqualificationAdmin.login);
    const listedDisqualification = await listResultDisqualificationCandidatesAsAdmin(db, disqualificationAuth, usedAt);
    if (listedDisqualification.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    expect(listedDisqualification.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "ACTIVE_APPROVAL",
      targetResultRevision: null
    });
    const latestTechnical = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(desc(schema.resultRevisions.revision)))[0]!;
    expect(latestTechnical).toMatchObject({ revision: 3, status: "OK", reason: "COMPLETE" });
    const disqualificationRequestId = crypto.randomUUID();
    await expect(disqualifyResultAsAdmin(db, {
      ...disqualificationAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification:${disqualificationRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "OK"
        },
        policyVersion: "manual-disqualification-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.requestId, disqualificationRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.requestId, disqualificationRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))).toHaveLength(3);
  });
});
