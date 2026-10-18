import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  decideWithoutTimingAsAdmin, ingestDeviceBatch, exportIofResultListAsAdmin, finalizeResultsAsAdmin,
  listOutOfCompetitionCandidatesAsAdmin, listWithoutTimingCandidatesAsAdmin, listWithoutTimingWithdrawalsAsAdmin,
  listResultFinalizationCandidatesAsAdmin, publicResults, withdrawWithoutTimingAsAdmin
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006M/006N explicit individuellt utan-tidtagning-livscykel PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T14:00:00.000Z");
  const usedAt = new Date("2026-09-01T14:02:00.000Z");

  async function admin(
    raceId: string,
    capability: "DECIDE_WITHOUT_TIMING" | "DECIDE_OUT_OF_COMPETITION" |
      "WITHDRAW_WITHOUT_TIMING" | "EXPORT_IOF_RESULT_LIST" | "FINALIZE_RESULTS",
    marker: number
  ) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T22:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T14:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("NT-testets arrangörssession saknas");
    return login;
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function activeWithoutTimingForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ntLogin = await admin(raceId, "DECIDE_WITHOUT_TIMING", marker);
    const ntAuth = auth(raceId, ntLogin);
    const ntList = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (ntList.status !== "ok") throw new Error("NT-kandidater saknas för återtagande");
    const ntCandidate = ntList.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!ntCandidate?.targetResultRevision) throw new Error("Aktivt NT-target saknas för återtagande");
    const decided = await decideWithoutTimingAsAdmin(db, {
      ...ntAuth,
      entryId: ntCandidate.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: ntCandidate.entryVersion,
        expectedClassId: ntCandidate.classId,
        expectedCourseVersionId: ntCandidate.courseVersionId,
        expectedSnapshotVersion: ntList.response.snapshotVersion,
        expectedResultRevision: {
          id: ntCandidate.targetResultRevision.id,
          revision: ntCandidate.targetResultRevision.revision,
          status: "OK",
          reason: "COMPLETE"
        },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    if (decided.status !== "without-timing") throw new Error("NT-beslut saknas för återtagande");

    const withdrawalLogin = await admin(raceId, "WITHDRAW_WITHOUT_TIMING", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalLogin);
    const listed = await listWithoutTimingWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-återtagandekandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === ntCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") {
      throw new Error("Aktivt NT saknas i återtagandelistan");
    }
    return {
      candidate,
      withdrawalAuth,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedWithoutTimingDecisionId: candidate.withoutTimingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedWithoutTimingResultRevision: candidate.withoutTimingResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING" as const,
        policyVersion: "without-timing-withdrawal-v1" as const
      }
    };
  }

  it("skapar exakt ett permanent status-only NT, bevarar senare teknik och blockerar IOF/finalisering", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ntLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 11);
    const ntAuth = auth(fixture.raceId, ntLogin);
    const listed = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-kandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknar NT-target");
    expect(candidate.targetResultRevision).toMatchObject({ status: "OK", reason: "COMPLETE" });
    const [technicalTarget] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, candidate.targetResultRevision.id));
    if (!technicalTarget?.readoutId) throw new Error("NT-targetets readout saknas");

    const requestId = crypto.randomUUID();
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: "OK" as const,
        reason: "COMPLETE" as const
      },
      policyVersion: "without-timing-v1" as const
    };
    const input = {
      ...ntAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing:${requestId}`,
      request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideWithoutTimingAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "without-timing")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "without-timing" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [decisions, revisions, audits] = await Promise.all([
      db.select().from(schema.withoutTimingDecisions).where(eq(schema.withoutTimingDecisions.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId))
    ]);
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "WITHOUT_TIMING_DECIDED",
      actorKind: "WITHOUT_TIMING_ACCESS_CREDENTIAL"
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      revision: technicalTarget.revision + 1,
      cause: "MANUAL_WITHOUT_TIMING",
      status: "NT",
      reason: "WITHOUT_TIMING",
      readoutId: null,
      withoutTimingDecisionId: decisions[0]!.id,
      published: true,
      evaluation: {
        status: "NT",
        reason: "WITHOUT_TIMING",
        entryId: candidate.id,
        classId: candidate.classId,
        courseVersionId: candidate.courseVersionId
      }
    });
    expect(revisions[1]!.evaluation).not.toHaveProperty("elapsedMs");
    await expect(db.update(schema.withoutTimingDecisions).set({ policyVersion: "without-timing-v1" })
      .where(eq(schema.withoutTimingDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(decideWithoutTimingAsAdmin(db, {
      ...input,
      request: { ...request, expectedEntryVersion: request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicBefore = await publicResults(db, fixture.raceId);
    expect(publicBefore.formatVersion).toBe(7);
    const publicAda = publicBefore.results.find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({ status: "NT", reason: "WITHOUT_TIMING", rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("elapsedMs");
    expect(publicAda).not.toHaveProperty("position");
    expect(publicAda).not.toHaveProperty("splits");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicAfter = await publicResults(db, fixture.raceId);
    expect(publicAfter.results.find((result) => result.givenName === "Ada")).toMatchObject({
      revision: technicalTarget.revision + 1,
      status: "NT",
      reason: "WITHOUT_TIMING"
    });
    await expect(decideWithoutTimingAsAdmin(db, input, usedAt)).resolves.toMatchObject({
      status: "without-timing",
      response: { replayed: true, withoutTimingDecisionId: decisions[0]!.id }
    });

    const oocLogin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 21);
    const oocCandidates = await listOutOfCompetitionCandidatesAsAdmin(
      db,
      auth(fixture.raceId, oocLogin),
      usedAt
    );
    if (oocCandidates.status !== "ok") throw new Error("OOC-kandidatlista efter NT saknas");
    expect(oocCandidates.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "ACTIVE_WITHOUT_TIMING",
      targetResultRevision: null
    });

    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 31);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 41);
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(
      db,
      auth(fixture.raceId, finalLogin),
      usedAt
    );
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringsunderlag efter NT saknas");
    expect(finalCandidates.response.classes.find((item) => item.classId === candidate.classId)?.blockerCodes)
      .toContain("INVALID_RESULT_REVISION");
  }, 30_000);

  it("avvisar MP som NT-target utan beslut, revision eller audit", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      punches: [31, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
      }))
    }));
    const ntLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 61);
    const ntAuth = auth(fixture.raceId, ntLogin);
    const listed = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (listed.status !== "ok") throw new Error("MP/NT-kandidatlista saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas i MP/NT-kandidatlistan");
    expect(candidate).toMatchObject({ readiness: "UNSUPPORTED_RESULT", targetResultRevision: null });
    const [mp] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id));
    if (!mp) throw new Error("MP-revisionen saknas");
    const requestId = crypto.randomUUID();
    const result = await decideWithoutTimingAsAdmin(db, {
      ...ntAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: mp.id, revision: mp.revision, status: "OK", reason: "COMPLETE" },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    expect(result).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.withoutTimingDecisions)
      .where(eq(schema.withoutTimingDecisions.requestId, requestId))).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))).toHaveLength(1);
  });

  it("återtar aktivt NT exakt idempotent till originaltarget och öppnar publik, IOF och finalisering", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 71);
    expect(active.candidate.restorationSourceResultRevision).toMatchObject({
      ...active.candidate.targetResultRevision,
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });
    const [source] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, active.candidate.restorationSourceResultRevision.id));
    if (!source?.readoutId) throw new Error("NT-återtagandets tekniska källa saknar readout");
    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: active.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawWithoutTimingAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);
    expect(new Set(responses.map((response) => response.withoutTimingWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);

    const [withdrawals, revisions, audits, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.withoutTimingWithdrawals)
        .where(eq(schema.withoutTimingWithdrawals.requestId, requestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "WITHOUT_TIMING_WITHDRAWN",
      actorKind: "WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_WITHOUT_TIMING",
      "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
    ]);
    expect(revisions[2]).toMatchObject({
      readoutId: null,
      withoutTimingDecisionId: null,
      withoutTimingWithdrawalId: withdrawals[0]!.id,
      status: source.status,
      reason: source.reason,
      evaluation: source.evaluation,
      published: true
    });
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.withoutTimingWithdrawals)
      .set({ policyVersion: "without-timing-withdrawal-v1" })
      .where(eq(schema.withoutTimingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();

    const listedAfter = await listWithoutTimingWithdrawalsAsAdmin(db, active.withdrawalAuth, usedAt);
    if (listedAfter.status !== "ok") throw new Error("NT-återtagandelistan saknas efter commit");
    expect(listedAfter.response.entries.find((entry) => entry.id === active.candidate.id)).toMatchObject({
      state: "WITHDRAWN",
      withdrawal: { id: withdrawals[0]!.id, reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING" }
    });
    const publicList = await publicResults(db, fixture.raceId);
    expect(publicList.formatVersion).toBe(7);
    expect(publicList.results.find((result) => result.givenName === "Ada")).toMatchObject({
      status: "OK",
      reason: "COMPLETE",
      rankingState: "RANKED"
    });
    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 81);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(exported.status).toBe("ok");
    if (exported.status === "ok") {
      const xml = new TextDecoder().decode(exported.bytes);
      expect(xml).toContain("<Status>OK</Status>");
      expect(xml).not.toContain("WITHOUT_TIMING");
    }
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
    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 91);
    const finalAuth = auth(fixture.raceId, finalLogin);
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(
      db,
      finalAuth,
      usedAt
    );
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringsunderlag efter NT-återtagande saknas");
    for (const candidate of finalCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalizedClass = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: finalCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(finalizedClass.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppsfinalisering efter NT-återtagande saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const finalizedRace = await finalizeResultsAsAdmin(db, {
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
    if (finalizedRace.status !== "finalized") throw new Error("Loppet finaliserades inte efter NT-återtagande");
    const [frozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizedRace.response.finalization.id));
    expect(frozen?.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozen?.frozenProjection)).toContain("MANUAL_WITHOUT_TIMING_WITHDRAWAL");
    const frozenXml = frozen?.completeXml;
    const frozenHash = frozen?.completeXmlHash;

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }));
    const [unchangedFrozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizedRace.response.finalization.id));
    expect(unchangedFrozen?.completeXml).toBe(frozenXml);
    expect(unchangedFrozen?.completeXmlHash).toBe(frozenHash);
    await expect(withdrawWithoutTimingAsAdmin(db, input, usedAt)).resolves.toMatchObject({
      status: "withdrawn",
      response: {
        replayed: true,
        withoutTimingWithdrawalId: withdrawals[0]!.id,
        restorationResultRevisionId: revisions[2]!.id
      }
    });
    await expect(withdrawWithoutTimingAsAdmin(db, {
      ...input,
      request: { ...active.request, expectedEntryVersion: active.request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const nextNtLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 104);
    const nextNtAuth = auth(fixture.raceId, nextNtLogin);
    const nextNtList = await listWithoutTimingCandidatesAsAdmin(db, nextNtAuth, usedAt);
    if (nextNtList.status !== "ok") throw new Error("Ny NT-kandidatlista efter ny teknik saknas");
    const nextCandidate = nextNtList.response.entries.find((entry) => entry.id === active.candidate.id);
    if (nextCandidate?.readiness !== "READY" || !nextCandidate.targetResultRevision) {
      throw new Error("Ny direkt teknik öppnade inte en ny NT-livscykel");
    }
    expect(nextCandidate.targetResultRevision.id).not.toBe(revisions[2]!.id);
    const secondDecision = await decideWithoutTimingAsAdmin(db, {
      ...nextNtAuth,
      entryId: nextCandidate.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: nextCandidate.entryVersion,
        expectedClassId: nextCandidate.classId,
        expectedCourseVersionId: nextCandidate.courseVersionId,
        expectedSnapshotVersion: nextNtList.response.snapshotVersion,
        expectedResultRevision: {
          id: nextCandidate.targetResultRevision.id,
          revision: nextCandidate.targetResultRevision.revision,
          status: "OK",
          reason: "COMPLETE"
        },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    expect(secondDecision.status).toBe("without-timing");
    expect(await db.select().from(schema.withoutTimingDecisions)
      .where(eq(schema.withoutTimingDecisions.entryId, active.candidate.id))).toHaveLength(2);
  }, 30_000);

  it("återställer exakt ett senare direkt tekniskt MP-huvud utan ranking", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 111);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z",
      punches: [31, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
      }))
    }));
    const listed = await listWithoutTimingWithdrawalsAsAdmin(db, active.withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-återtagandelista med senare MP saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === active.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Senare MP är inte återtagbar");
    expect(candidate.absoluteResultRevision).toEqual({
      id: candidate.restorationSourceResultRevision.id,
      revision: candidate.restorationSourceResultRevision.revision
    });
    expect(candidate.restorationSourceResultRevision).toMatchObject({
      status: "MP",
      reason: "MISSING_CONTROL",
      cause: "CARD_READOUT"
    });
    const requestId = crypto.randomUUID();
    const withdrawn = await withdrawWithoutTimingAsAdmin(db, {
      ...active.withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedWithoutTimingDecisionId: candidate.withoutTimingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedWithoutTimingResultRevision: candidate.withoutTimingResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING",
        policyVersion: "without-timing-withdrawal-v1"
      }
    }, usedAt);
    expect(withdrawn).toMatchObject({ status: "withdrawn", response: { status: "MP", reason: "MISSING_CONTROL" } });
    const publicAda = (await publicResults(db, fixture.raceId)).results
      .find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("position");
    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 121);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(exported.status).toBe("ok");
    if (exported.status === "ok") {
      expect(new TextDecoder().decode(exported.bytes)).toContain("<Status>MissingPunch</Status>");
    }
  }, 30_000);

  it("ger en vinnare för två request-id:n och serialiserar samtidig ingest utan revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 131);
    const requestFor = (requestId: string) => ({
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: active.request
    });
    const [first, second] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, requestFor(crypto.randomUUID()), usedAt),
      withdrawWithoutTimingAsAdmin(db, requestFor(crypto.randomUUID()), usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    expect(await db.select().from(schema.withoutTimingWithdrawals)
      .where(eq(schema.withoutTimingWithdrawals.entryId, active.candidate.id))).toHaveLength(1);

    const next = await importedRace();
    const concurrent = await activeWithoutTimingForWithdrawal(next.raceId, 141);
    const concurrentInput = {
      ...concurrent.withdrawalAuth,
      entryId: concurrent.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${crypto.randomUUID()}`,
      request: concurrent.request
    };
    const [withdrawalResult, ingest] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, concurrentInput, usedAt),
      ingestDeviceBatch(db, next.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:46:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawalResult.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, concurrent.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(revisions.map((_revision, index) => index + 1));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawalResult.status === "withdrawn"
        ? ["CARD_READOUT", "MANUAL_WITHOUT_TIMING", "MANUAL_WITHOUT_TIMING_WITHDRAWAL", "CARD_READOUT"]
        : ["CARD_READOUT", "MANUAL_WITHOUT_TIMING", "CARD_READOUT"]
    );
  }, 30_000);

  it("serialiserar samtidig NT-withdrawal och finaliseringsförsök till ett helt efterläge", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 151);
    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 161);
    const finalAuth = auth(fixture.raceId, finalLogin);
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (candidates.status !== "ok") throw new Error("Finaliseringsunderlag under aktiv NT saknas");
    const classCandidate = candidates.response.classes.find((item) => item.classId === active.candidate.classId);
    if (!classCandidate) throw new Error("NT-klassen saknas i finaliseringsunderlaget");
    expect(classCandidate.blockerCodes).toContain("INVALID_RESULT_REVISION");
    const [withdrawal, finalization] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `without-timing-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: classCandidate.classId,
          expectedSnapshotVersion: candidates.response.snapshotVersion,
          expectedBasisHash: classCandidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt })
    ]);
    expect(withdrawal.status).toBe("withdrawn");
    expect(finalization.status).toBe("conflict");
    expect(await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "CLASS")
    ))).toHaveLength(0);
    expect(await db.select().from(schema.withoutTimingWithdrawals)
      .where(eq(schema.withoutTimingWithdrawals.entryId, active.candidate.id))).toHaveLength(1);
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlag efter NT-withdrawal saknas");
    expect(after.response.classes.find((item) => item.classId === classCandidate.classId)?.basisHash)
      .not.toBe(classCandidate.basisHash);
  }, 30_000);
});
