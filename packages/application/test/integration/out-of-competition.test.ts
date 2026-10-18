import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { type OutOfCompetitionWithdrawalListResponse } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import {
  decideOutOfCompetitionAsAdmin, listResultApprovalCandidatesAsAdmin,
  listResultDisqualificationCandidatesAsAdmin, ingestDeviceBatch, exportIofResultListAsAdmin,
  finalizeResultsAsAdmin, listDidNotFinishCandidatesAsAdmin, listOutOfCompetitionCandidatesAsAdmin,
  listOutOfCompetitionWithdrawalsAsAdmin, listResultFinalizationCandidatesAsAdmin, publicResults,
  withdrawOutOfCompetitionAsAdmin
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006K/006L explicit individuellt utom tävlan-livscykel PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T14:00:00.000Z");
  const usedAt = new Date("2026-09-01T14:02:00.000Z");

  type Capability =
    | "DECIDE_OUT_OF_COMPETITION"
    | "WITHDRAW_OUT_OF_COMPETITION"
    | "DECIDE_DID_NOT_FINISH"
    | "APPROVE_RESULT"
    | "DISQUALIFY_RESULT"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS";

  async function admin(raceId: string, capability: Capability, marker: number) {
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
    if (login.status !== "authenticated") throw new Error("OOC-testets arrangörssession saknas");
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

  async function finalizeAll(raceId: string, marker: number) {
    const finalAdmin = await admin(raceId, "FINALIZE_RESULTS", marker);
    const finalAuth = auth(raceId, finalAdmin.login);
    const classes = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classes.status !== "ok") throw new Error("OOC-finaliseringskandidater saknas");
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
    if (race.status !== "ok") throw new Error("OOC-loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalized = await finalizeResultsAsAdmin(db, {
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
    if (finalized.status !== "finalized") throw new Error("OOC-loppet finaliserades inte");
    return finalized.response.finalization.id;
  }

  function personResultBody(xml: string, givenName: string): string {
    const match = xml.match(new RegExp(
      `<PersonResult>[\\s\\S]*?<Given>${givenName}</Given>[\\s\\S]*?<Result>([\\s\\S]*?)</Result>[\\s\\S]*?</PersonResult>`
    ));
    if (!match?.[1]) throw new Error(`${givenName} saknas i OOC-exporten`);
    return match[1];
  }

  async function activeOutOfCompetitionForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(raceId, "DECIDE_OUT_OF_COMPETITION", marker);
    const oocAuth = auth(raceId, oocAdmin.login);
    const oocList = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (oocList.status !== "ok") throw new Error("OOC-kandidater saknas för concurrencytest");
    const oocCandidate = oocList.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!oocCandidate?.targetResultRevision) throw new Error("OOC-target saknas för concurrencytest");
    const decision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: oocCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: oocCandidate.entryVersion,
        expectedClassId: oocCandidate.classId,
        expectedCourseVersionId: oocCandidate.courseVersionId,
        expectedSnapshotVersion: oocList.response.snapshotVersion,
        expectedResultRevision: {
          id: oocCandidate.targetResultRevision.id,
          revision: oocCandidate.targetResultRevision.revision,
          status: oocCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (decision.status !== "out-of-competition") throw new Error("OOC-beslut saknas för concurrencytest");
    const withdrawalAdmin = await admin(raceId, "WITHDRAW_OUT_OF_COMPETITION", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalAdmin.login);
    const list = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (list.status !== "ok") throw new Error("OOC-återtaganden saknas för concurrencytest");
    const candidate = list.response.entries.find((entry) => entry.id === oocCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") {
      throw new Error("Aktiv OOC saknas för concurrencytest");
    }
    return {
      candidate,
      withdrawalAuth,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: list.response.snapshotVersion,
        expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
        policyVersion: "out-of-competition-withdrawal-v1" as const
      }
    };
  }

  it("skriver OOC exakt idempotent, bevarar tekniska fakta och håller permanent overlay genom export och finalisering", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 31);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listed = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`OOC-kandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som OOC-kandidat");
    const target = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, candidate.targetResultRevision.id)))[0]!;
    const requestId = crypto.randomUUID();
    const input = {
      ...oocAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition:${requestId}`,
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
        policyVersion: "out-of-competition-v1" as const
      }
    };
    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const attempts = await Promise.all(Array.from({ length: 50 }, () =>
      decideOutOfCompetitionAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "out-of-competition")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "out-of-competition" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.notCompetingDecisionId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(49);

    const [decisions, audits, history, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.notCompetingDecisions).where(eq(schema.notCompetingDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "OUT_OF_COMPETITION_DECIDED",
      actorKind: "OUT_OF_COMPETITION_ACCESS_CREDENTIAL"
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      revision: target.revision + 1,
      cause: "MANUAL_OUT_OF_COMPETITION",
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      notCompetingDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(history[1]?.evaluation).toEqual({
      ...(target.evaluation as unknown as Record<string, unknown>),
      status: "OOC",
      reason: "OUT_OF_COMPETITION"
    });
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.notCompetingDecisions).set({ status: "OOC" })
      .where(eq(schema.notCompetingDecisions.id, decisions[0]!.id))).rejects.toThrow();

    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 41);
    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.formatVersion).toBe(7);
    const publicAda = publicResponse.results.find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({
      revision: target.revision + 1,
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      elapsedMs: 2_400_000,
      rankingState: "NOT_RANKABLE_STATUS"
    });
    expect(publicAda).not.toHaveProperty("position");
    expect(publicAda).not.toHaveProperty("timeBehindMs");

    const [dnfAdmin, approvalAdmin, disqualificationAdmin] = await Promise.all([
      admin(fixture.raceId, "DECIDE_DID_NOT_FINISH", 51),
      admin(fixture.raceId, "APPROVE_RESULT", 61),
      admin(fixture.raceId, "DISQUALIFY_RESULT", 71)
    ]);
    const [dnfCandidates, approvalCandidates, disqualificationCandidates] = await Promise.all([
      listDidNotFinishCandidatesAsAdmin(db, auth(fixture.raceId, dnfAdmin.login), usedAt),
      listResultApprovalCandidatesAsAdmin(db, auth(fixture.raceId, approvalAdmin.login), usedAt),
      listResultDisqualificationCandidatesAsAdmin(db, auth(fixture.raceId, disqualificationAdmin.login), usedAt)
    ]);
    expect(dnfCandidates.status === "ok"
      ? dnfCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : dnfCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");
    expect(approvalCandidates.status === "ok"
      ? approvalCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : approvalCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");
    expect(disqualificationCandidates.status === "ok"
      ? disqualificationCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : disqualificationCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 81);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("OOC Snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    const snapshotAda = personResultBody(snapshotXml, "Ada");
    expect(snapshotAda).toContain("<Status>NotCompeting</Status>");
    expect(snapshotAda).toContain("<Time>2400</Time>");
    expect(snapshotAda).toContain("<SplitTime");
    expect(snapshotAda).not.toMatch(/<(Position|TimeBehind)(?:\s|>)/);
    expect(snapshotXml).not.toContain(decisions[0]!.id);

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
    const finalizationId = await finalizeAll(fixture.raceId, 101);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst OOC Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_OUT_OF_COMPETITION"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    const completeAda = personResultBody(frozenBefore.completeXml, "Ada");
    expect(completeAda).toContain("<Status>NotCompeting</Status>");
    expect(completeAda).not.toMatch(/<(Position|TimeBehind)(?:\s|>)/);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("avvisar stale OOC efter senare ingest och serialiserar samtidig ingest till exakt ett helt utfall", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 111);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listed = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Stale OOC-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("Stale OOC-target saknas");
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
      policyVersion: "out-of-competition-v1" as const
    };
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const staleRequestId = crypto.randomUUID();
    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition:${staleRequestId}`,
      request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.requestId, staleRequestId))).toHaveLength(0);

    const fresh = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (fresh.status !== "ok") throw new Error("Ny OOC-kandidat saknas");
    const freshCandidate = fresh.response.entries.find((entry) => entry.id === candidate.id);
    if (!freshCandidate?.targetResultRevision) throw new Error("Ny OOC-target saknas");
    const concurrentRequestId = crypto.randomUUID();
    const [decision, ingest] = await Promise.all([
      decideOutOfCompetitionAsAdmin(db, {
        ...oocAuth,
        entryId: freshCandidate.id,
        idempotencyKey: `out-of-competition:${concurrentRequestId}`,
        request: {
          formatVersion: 1,
          expectedEntryVersion: freshCandidate.entryVersion,
          expectedClassId: freshCandidate.classId,
          expectedCourseVersionId: freshCandidate.courseVersionId,
          expectedSnapshotVersion: fresh.response.snapshotVersion,
          expectedResultRevision: {
            id: freshCandidate.targetResultRevision.id,
            revision: freshCandidate.targetResultRevision.revision,
            status: freshCandidate.targetResultRevision.status
          },
          policyVersion: "out-of-competition-v1"
        }
      }, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:42:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["out-of-competition", "conflict"]).toContain(decision.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(Array.from({ length: decision.status === "out-of-competition" ? 4 : 3 }, (_, index) => index + 1));
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.requestId, concurrentRequestId)))
      .toHaveLength(decision.status === "out-of-competition" ? 1 : 0);
  }, 30_000);

  it("återtar aktiv OOC append-only, restaurerar exakt target och projicerar full v7-proveniens", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 131);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listedOoc = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listedOoc.status !== "ok") throw new Error("OOC-kandidater saknas för återtagande");
    const oocCandidate = listedOoc.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!oocCandidate?.targetResultRevision) throw new Error("Ada saknar OOC-target för återtagande");
    const [technicalTarget] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, oocCandidate.targetResultRevision.id));
    if (!technicalTarget?.readoutId) throw new Error("OOC-targetets avläsning saknas");
    const decided = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: oocCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: oocCandidate.entryVersion,
        expectedClassId: oocCandidate.classId,
        expectedCourseVersionId: oocCandidate.courseVersionId,
        expectedSnapshotVersion: listedOoc.response.snapshotVersion,
        expectedResultRevision: {
          id: oocCandidate.targetResultRevision.id,
          revision: oocCandidate.targetResultRevision.revision,
          status: oocCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (decided.status !== "out-of-competition") throw new Error("OOC-beslutet skapades inte");

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 141);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`OOC-återtagandelistan saknas: ${listed.status}`);
    const candidate: OutOfCompetitionWithdrawalListResponse["entries"][number] | undefined =
      listed.response.entries.find((entry) => entry.id === oocCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Aktiv OOC kan inte återtas");
    expect(candidate.absoluteResultRevision).toEqual(candidate.outOfCompetitionResultRevision);
    expect(candidate.restorationSourceResultRevision).toMatchObject({
      id: technicalTarget.id,
      revision: technicalTarget.revision,
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });

    const requestId = crypto.randomUUID();
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    };
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${requestId}`,
      request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawOutOfCompetitionAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);
    expect(new Set(responses.map((response) => response.outOfCompetitionWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);

    const [withdrawals, audits, revisions] = await Promise.all([
      db.select().from(schema.notCompetingWithdrawals).where(eq(schema.notCompetingWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "OUT_OF_COMPETITION_WITHDRAWN",
      actorKind: "OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toMatchObject({
      revision: technicalTarget.revision + 2,
      cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
      status: "OK",
      reason: "COMPLETE",
      readoutId: null,
      notCompetingDecisionId: null,
      notCompetingWithdrawalId: withdrawals[0]!.id,
      published: true
    });
    expect(revisions[2]!.evaluation).toEqual(technicalTarget.evaluation);
    await expect(db.update(schema.notCompetingWithdrawals).set({ reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" })
      .where(eq(schema.notCompetingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...input,
      request: { ...request, expectedEntryVersion: request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 151);
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const listedAfter = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listedAfter.status !== "ok") throw new Error("Återtagen OOC-livscykel saknas");
    expect(listedAfter.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      state: "WITHDRAWN",
      withdrawal: {
        id: withdrawals[0]!.id,
        restorationResultRevision: { id: revisions[2]!.id, revision: revisions[2]!.revision }
      }
    });
    const oocAfter = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (oocAfter.status !== "ok") throw new Error("OOC-kandidatlista efter återtagande saknas");
    expect(oocAfter.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "UNSUPPORTED_RESULT",
      targetResultRevision: null
    });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.formatVersion).toBe(7);
    expect(publicResponse.results.find((result) => result.givenName === "Ada")).toMatchObject({
      revision: revisions[2]!.revision,
      status: "OK",
      reason: "COMPLETE",
      elapsedMs: 2_400_000
    });

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 171);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Restaurerad OOC Snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(personResultBody(snapshotXml, "Ada")).toContain("<Status>OK</Status>");
    expect(snapshotXml).not.toContain(withdrawals[0]!.id);

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
    const finalizationId = await finalizeAll(fixture.raceId, 181);
    const [frozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozen?.completeXml) throw new Error("Restaurerad OOC Complete saknas");
    expect(frozen.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozen.frozenProjection)).toContain('"kind":"MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"');
    expect(JSON.stringify(frozen.frozenProjection)).toContain(withdrawals[0]!.id);
    expect(personResultBody(frozen.completeXml, "Ada")).toContain("<Status>OK</Status>");
    expect(frozen.completeXml).not.toContain(withdrawals[0]!.id);
  }, 30_000);

  it("låser en senare teknisk källa, avvisar stale intent och kräver ny teknik före nästa OOC", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 191);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const initial = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (initial.status !== "ok") throw new Error("Initial OOC-kandidatlista saknas");
    const initialCandidate = initial.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!initialCandidate?.targetResultRevision) throw new Error("Initial OOC-target saknas");
    const firstDecision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: initialCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: initialCandidate.entryVersion,
        expectedClassId: initialCandidate.classId,
        expectedCourseVersionId: initialCandidate.courseVersionId,
        expectedSnapshotVersion: initial.response.snapshotVersion,
        expectedResultRevision: {
          id: initialCandidate.targetResultRevision.id,
          revision: initialCandidate.targetResultRevision.revision,
          status: initialCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (firstDecision.status !== "out-of-competition") throw new Error("Initialt OOC-beslut saknas");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 201);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Sen OOC-återtagandelista saknas");
    const staleCandidate = listed.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!staleCandidate || staleCandidate.state !== "WITHDRAWABLE") {
      throw new Error("Sen OOC-källa är inte återtagbar");
    }
    expect(staleCandidate.absoluteResultRevision).toEqual({
      id: staleCandidate.restorationSourceResultRevision.id,
      revision: staleCandidate.restorationSourceResultRevision.revision
    });
    expect(staleCandidate.restorationSourceResultRevision).toMatchObject({
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });
    expect(staleCandidate.restorationSourceResultRevision.id)
      .not.toBe(staleCandidate.targetResultRevision.id);

    const requestFor = (candidate: NonNullable<typeof staleCandidate>) => ({
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    });
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:42:00Z"
    }));
    const staleRequestId = crypto.randomUUID();
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...withdrawalAuth,
      entryId: staleCandidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${staleRequestId}`,
      request: requestFor(staleCandidate)
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.requestId, staleRequestId))).toHaveLength(0);

    const freshList = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (freshList.status !== "ok") throw new Error("Uppdaterad OOC-återtagandelista saknas");
    const freshCandidate = freshList.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!freshCandidate || freshCandidate.state !== "WITHDRAWABLE") {
      throw new Error("Uppdaterad OOC-källa är inte återtagbar");
    }
    const freshRequest = {
      formatVersion: 1 as const,
      expectedEntryVersion: freshCandidate.entryVersion,
      expectedClassId: freshCandidate.classId,
      expectedCourseVersionId: freshCandidate.courseVersionId,
      expectedSnapshotVersion: freshList.response.snapshotVersion,
      expectedNotCompetingDecisionId: freshCandidate.notCompetingDecisionId,
      expectedTargetResultRevision: freshCandidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: freshCandidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: freshCandidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: freshCandidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    };
    const withdrawn = await withdrawOutOfCompetitionAsAdmin(db, {
      ...withdrawalAuth,
      entryId: freshCandidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: freshRequest
    }, usedAt);
    if (withdrawn.status !== "withdrawn") throw new Error("Sen teknisk OOC-källa restaurerades inte");
    expect(withdrawn.response.restorationSourceResultRevisionId)
      .toBe(freshCandidate.absoluteResultRevision.id);
    const [restored] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, withdrawn.response.restorationResultRevisionId));
    const [source] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, freshCandidate.absoluteResultRevision.id));
    expect(restored?.evaluation).toEqual(source?.evaluation);

    const beforeNewTechnical = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (beforeNewTechnical.status !== "ok") throw new Error("OOC-lista efter sen restaurering saknas");
    expect(beforeNewTechnical.response.entries.find((entry) => entry.id === initialCandidate.id)?.readiness)
      .toBe("UNSUPPORTED_RESULT");
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const afterNewTechnical = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (afterNewTechnical.status !== "ok") throw new Error("OOC-lista efter ny teknik saknas");
    const nextCandidate = afterNewTechnical.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!nextCandidate?.targetResultRevision || nextCandidate.readiness !== "READY") {
      throw new Error("Ny direkt teknisk revision öppnade inte ny OOC-livscykel");
    }
    const secondDecision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: nextCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: nextCandidate.entryVersion,
        expectedClassId: nextCandidate.classId,
        expectedCourseVersionId: nextCandidate.courseVersionId,
        expectedSnapshotVersion: afterNewTechnical.response.snapshotVersion,
        expectedResultRevision: {
          id: nextCandidate.targetResultRevision.id,
          revision: nextCandidate.targetResultRevision.revision,
          status: nextCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    expect(secondDecision.status).toBe("out-of-competition");
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.entryId, initialCandidate.id))).toHaveLength(2);
    expect(await db.select().from(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.entryId, initialCandidate.id))).toHaveLength(1);
  }, 30_000);

  it("ger exakt en vinnare för två samtidiga OOC-återtaganden med olika request-id", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 211);
    const [first, second] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      withdrawOutOfCompetitionAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    const [withdrawals, revisions, audits] = await Promise.all([
      db.select().from(schema.notCompetingWithdrawals)
        .where(eq(schema.notCompetingWithdrawals.entryId, active.candidate.id)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(and(
        eq(schema.auditEvents.raceId, fixture.raceId),
        eq(schema.auditEvents.action, "OUT_OF_COMPETITION_WITHDRAWN")
      ))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_OUT_OF_COMPETITION",
      "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
    ]);
  });

  it("serialiserar samtidig OOC-withdrawal och ingest utan källbyte eller revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 221);
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:43:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, active.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(revisions.map((_revision, index) => index + 1));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? [
            "CARD_READOUT",
            "MANUAL_OUT_OF_COMPETITION",
            "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
            "CARD_READOUT"
          ]
        : ["CARD_READOUT", "MANUAL_OUT_OF_COMPETITION", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      await expect(withdrawOutOfCompetitionAsAdmin(db, input, usedAt)).resolves.toMatchObject({
        status: "withdrawn",
        response: { replayed: true }
      });
    }
    expect(await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "OUT_OF_COMPETITION_WITHDRAWN")
    ))).toHaveLength(withdrawal.status === "withdrawn" ? 1 : 0);
  });

  it("serialiserar samtidig OOC-withdrawal och loppsfinalisering till helt före eller efter", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 231);
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
    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 241);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("OOC-klassfinaliseringskandidater saknas");
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
    if (raceCandidate.status !== "ok") throw new Error("OOC-loppsfinaliseringskandidat saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const withdrawalInput = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, finalization] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, withdrawalInput, usedAt),
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
      const frozenXml = raceFinalizations[0]?.completeXml;
      expect(frozenXml).toContain("<Status>NotCompeting</Status>");
      await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:44:00Z"
      }));
      const [unchanged] = await db.select().from(schema.resultFinalizations)
        .where(eq(schema.resultFinalizations.id, raceFinalizations[0]!.id));
      expect(unchanged?.completeXml).toBe(frozenXml);
      expect(unchanged?.completeXmlHash).toBe(raceFinalizations[0]?.completeXmlHash);
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlaget efter OOC-withdrawal saknas");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  }, 30_000);
});
