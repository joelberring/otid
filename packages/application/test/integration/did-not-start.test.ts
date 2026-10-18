import { describe, expect, it } from "vitest";
import { asc, count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  decideDidNotStartAsAdmin, listDidNotStartWithdrawalsAsAdmin, withdrawDidNotStartAsAdmin, ingestDeviceBatch,
  exportIofResultListAsAdmin, finalizeResultsAsAdmin, listDidNotStartCandidatesAsAdmin,
  listResultFinalizationCandidatesAsAdmin, publicResults
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006E explicit individuellt ej-startbeslut PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T08:00:00.000Z");
  const usedAt = new Date("2026-09-01T08:02:00.000Z");

  async function dnsAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "DECIDE_DID_NOT_START",
      label: `Ej start ${marker}`,
      expiresAt: new Date("2026-09-01T16:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "DECIDE_DID_NOT_START",
      now: new Date("2026-09-01T08:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("DNS-session kunde inte skapas");
    return { installation, login };
  }

  function dnsAuth(raceId: string, login: Awaited<ReturnType<typeof dnsAdmin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  function dnsRequest(candidate: {
    entryVersion: number;
    classId: string;
    courseVersionId: string;
  }, snapshotVersion: number, policyVersion = "did-not-start-v1" as const) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedLatestResultRevision: null,
      policyVersion
    };
  }

  async function decideFirstReady(raceId: string, marker: number) {
    const admin = await dnsAdmin(raceId, marker);
    const auth = dnsAuth(raceId, admin.login);
    const candidates = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = candidates.response.entries.find((entry) => entry.readiness === "READY");
    if (!candidate) throw new Error("Ingen DNS-kandidat är redo");
    const requestId = crypto.randomUUID();
    const result = await decideDidNotStartAsAdmin(db, {
      ...auth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${requestId}`,
      request: dnsRequest(candidate, candidates.response.snapshotVersion)
    }, usedAt);
    if (result.status !== "decided") throw new Error("DNS-beslutet misslyckades");
    return { admin, auth, candidate, candidates: candidates.response, requestId, result };
  }

  it("skapar ett immutable DNS-beslut exakt idempotent utan rawdata eller readout", async () => {
    const fixture = await importedRace();
    const admin = await dnsAdmin(fixture.raceId, 51);
    const auth = dnsAuth(fixture.raceId, admin.login);
    const listed = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (listed.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = listed.response.entries[0];
    if (!candidate || candidate.readiness !== "READY") throw new Error("DNS-kandidat saknas");
    const requestId = crypto.randomUUID();
    const input = {
      ...auth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${requestId}`,
      request: dnsRequest(candidate, listed.response.snapshotVersion)
    };
    const before = await Promise.all([
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideDidNotStartAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "decided")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "decided" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, revisions, audits, afterRaw, afterReadouts] = await Promise.all([
      db.select().from(schema.didNotStartDecisions).where(eq(schema.didNotStartDecisions.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    expect(decisions).toHaveLength(1);
    expect(revisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revision: 1,
      cause: "MANUAL_DID_NOT_START",
      status: "DNS",
      reason: "DID_NOT_START",
      readoutId: null,
      didNotStartDecisionId: decisions[0]!.id,
      published: true
    });
    expect(revisions[0]?.evaluation).toEqual({
      status: "DNS",
      reason: "DID_NOT_START",
      entryId: candidate.id,
      classId: candidate.classId,
      courseVersionId: candidate.courseVersionId
    });
    expect(afterRaw[0]?.value).toBe(before[0][0]?.value);
    expect(afterReadouts[0]?.value).toBe(before[1][0]?.value);
    await expect(db.update(schema.didNotStartDecisions).set({ status: "DNS" })
      .where(eq(schema.didNotStartDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultRevisions).where(eq(schema.resultRevisions.id, revisions[0]!.id)))
      .rejects.toThrow();

    await expect(decideDidNotStartAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await dnsAdmin(fixture.raceId, 57);
    await expect(decideDidNotStartAsAdmin(db, {
      ...dnsAuth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toContainEqual(expect.objectContaining({
      status: "DNS",
      reason: "DID_NOT_START",
      rankingState: "NOT_RANKABLE_STATUS",
      splits: []
    }));
    expect(publicResponse.results[0]).not.toHaveProperty("position");
  });

  it("serialiserar samtidig ingest och DNS till ett helt före- eller efterläge", async () => {
    const fixture = await importedRace();
    const admin = await dnsAdmin(fixture.raceId, 61);
    const auth = dnsAuth(fixture.raceId, admin.login);
    const listed = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (listed.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas");
    const [decision, ingest] = await Promise.all([
      decideDidNotStartAsAdmin(db, {
        ...auth,
        entryId: candidate.id,
        idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
        request: dnsRequest(candidate, listed.response.snapshotVersion)
      }, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["decided", "conflict"]).toContain(decision.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(decision.status === "decided" ? [1, 2] : [1]);
    if (decision.status === "decided") {
      expect(revisions.map((revision) => revision.cause))
        .toEqual(["MANUAL_DID_NOT_START", "CARD_READOUT"]);
    } else {
      expect(revisions[0]?.cause).toBe("CARD_READOUT");
    }
  });

  it("låter OK och explicit DNS bli ett fryst status-only Complete", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const dns = await decideFirstReady(fixture.raceId, 71);
    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "DNS-finalisering",
      expiresAt: new Date("2026-09-01T16:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 73) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T08:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 74),
      csrfSecretBytes: Buffer.alloc(32, 75)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalAuth = {
      sessionToken: finalLogin.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: finalLogin.csrfToken,
      csrfHeader: finalLogin.csrfToken
    };
    const candidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (candidate.status !== "ok") throw new Error("Finaliseringskandidat saknas");
    const raceClass = candidate.response.classes.find(({ entryCount }) => entryCount > 0);
    if (!raceClass) throw new Error("Finaliseringsklass med deltagare saknas");
    expect(raceClass.blockerCodes).toEqual([]);
    const classResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: raceClass.classId,
        expectedSnapshotVersion: candidate.response.snapshotVersion,
        expectedBasisHash: raceClass.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidat saknas");
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
    const [stored] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(stored?.completeXml).toContain('<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid" status="Complete">');
    expect(stored?.completeXml).toContain("<Status>DidNotStart</Status>");
    expect(stored?.completeXml?.match(/<SplitTime /g)).toHaveLength(3);
    expect(dns.result.response.status).toBe("DNS");
  });
});

describe("TASK 006F explicit återtagande av manuellt ej-startbeslut PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T09:00:00.000Z");
  const usedAt = new Date("2026-09-01T09:02:00.000Z");

  async function admin(raceId: string, capability: "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START", marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T09:01:00.000Z"),
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

  async function manualDns(raceId: string, marker: number, name?: string) {
    const dns = await admin(raceId, "DECIDE_DID_NOT_START", marker);
    const dnsAuth = auth(raceId, dns.login);
    const candidates = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = name === undefined
      ? candidates.response.entries.find((entry) => entry.readiness === "READY")
      : candidates.response.entries.find((entry) => entry.readiness === "READY" && entry.displayName.includes(name));
    if (!candidate) throw new Error("DNS-kandidat saknas");
    const result = await decideDidNotStartAsAdmin(db, {
      ...dnsAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: candidates.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    if (result.status !== "decided") throw new Error("DNS-beslutet misslyckades");
    return { candidate, result };
  }

  function withdrawalRequest(entry: {
    entryVersion: number;
    classId: string;
    courseVersionId: string;
    didNotStartDecisionId: string;
    targetResultRevision: { id: string; revision: number };
  }, snapshotVersion: number) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedDidNotStartDecisionId: entry.didNotStartDecisionId,
      expectedResultRevision: {
        id: entry.targetResultRevision.id,
        revision: entry.targetResultRevision.revision
      },
      policyVersion: "did-not-start-withdrawal-v1" as const
    };
  }

  it("appendar exakt ett immutable återtagande utan resultatrevision och döljer DNS utan fallback", async () => {
    const fixture = await importedRace();
    const dns = await manualDns(fixture.raceId, 101);
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 111);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    expect(candidate.state).toBe("WITHDRAWABLE");

    const requestId = crypto.randomUUID();
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${requestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const before = await Promise.all([
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawDidNotStartAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.withdrawalId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [withdrawals, audits, revisionsAfter, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotStartWithdrawals).where(eq(schema.didNotStartWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorKind: "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL",
      action: "DID_NOT_START_WITHDRAWN"
    });
    expect(revisionsAfter[0]?.value).toBe(before[0][0]?.value);
    expect(rawAfter[0]?.value).toBe(before[1][0]?.value);
    expect(readoutsAfter[0]?.value).toBe(before[2][0]?.value);
    expect(raceAfter[0]?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.didNotStartWithdrawals).set({ reason: "ERRONEOUS_MANUAL_DNS" })
      .where(eq(schema.didNotStartWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotStartWithdrawals)
      .where(eq(schema.didNotStartWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();

    const afterList = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (afterList.status !== "ok") throw new Error("Återtagningslistan efter commit saknas");
    expect(afterList.response.entries.find((entry) => entry.id === candidate.id)?.state).toBe("WITHDRAWN");
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results.some((result) =>
      result.givenName === dns.candidate.displayName.split(" ")[0] && result.status === "DNS"
    )).toBe(false);

    const exportAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: "Snapshot efter återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 181) });
    const exportLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: exportAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 182),
      csrfSecretBytes: Buffer.alloc(32, 183)
    });
    if (exportLogin.status !== "authenticated") throw new Error("Exportsession saknas");
    const snapshot = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (snapshot.status !== "ok") throw new Error("Snapshotexport efter återtagande misslyckades");
    expect(new TextDecoder().decode(snapshot.bytes)).not.toContain("DidNotStart");
    expect(snapshot.metadata).toMatchObject({ resultCount: 0, omittedEntryCount: 2 });

    await expect(withdrawDidNotStartAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 121);
    await expect(withdrawDidNotStartAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    await expect(withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
  });

  it("serialiserar återtagande mot ingest och visar senare kortrevision utan att ändra exact replay", async () => {
    const fixture = await importedRace();
    await manualDns(fixture.raceId, 131, "Ada");
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 141);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.state === "WITHDRAWABLE" && entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas som återtagningskandidat");
    const requestId = crypto.randomUUID();
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${requestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawDidNotStartAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? ["MANUAL_DID_NOT_START", "CARD_READOUT"]
        : ["MANUAL_DID_NOT_START", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      const replay = await withdrawDidNotStartAsAdmin(db, input, usedAt);
      expect(replay).toMatchObject({ status: "withdrawn", response: { replayed: true } });
    }
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      status: "OK",
      revision: 2
    }));
  });

  it("gör aktuell klassgrund ofinaliserbar med en explicit blocker", async () => {
    const fixture = await importedRace();
    const dns = await manualDns(fixture.raceId, 151);
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 161);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    const withdrawn = await withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "Efter återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 171) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 172),
      csrfSecretBytes: Buffer.alloc(32, 173)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(db, auth(fixture.raceId, finalLogin), usedAt);
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    expect(finalCandidates.response.classes.find((raceClass) =>
      raceClass.classId === dns.candidate.classId
    )?.blockerCodes).toContain("WITHDRAWN_DID_NOT_START");
  });

  it("bevarar äldre fryst Complete byte-exakt men gör aktuell finaliseringsbasis inaktuell", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const dns = await manualDns(fixture.raceId, 191);
    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "Frys före återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 201) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 202),
      csrfSecretBytes: Buffer.alloc(32, 203)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalAuth = auth(fixture.raceId, finalLogin);
    const beforeClass = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (beforeClass.status !== "ok") throw new Error("Klassunderlaget saknas");
    const raceClass = beforeClass.response.classes.find((item) => item.classId === dns.candidate.classId);
    if (!raceClass || raceClass.blockerCodes.length > 0) throw new Error("Klassunderlaget kan inte frysas");
    const classResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: raceClass.classId,
        expectedSnapshotVersion: beforeClass.response.snapshotVersion,
        expectedBasisHash: raceClass.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const beforeRace = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (beforeRace.status !== "ok") throw new Error("Loppsunderlaget saknas");
    expect(beforeRace.response.race.blockerCodes).toEqual([]);
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: beforeRace.response.snapshotVersion,
        expectedBasisHash: beforeRace.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (raceResult.status !== "finalized") throw new Error("Loppet kunde inte frysas");
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    if (!frozenBefore?.completeXml || !frozenBefore.completeXmlHash) throw new Error("Complete-bytes saknas");

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 211);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    const withdrawn = await withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Aktuellt finaliseringsunderlag saknas");
    expect(after.response.classes.find((item) => item.classId === dns.candidate.classId)?.blockerCodes)
      .toContain("WITHDRAWN_DID_NOT_START");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
    expect(after.response.race.basisHash).not.toBe(beforeRace.response.race.basisHash);
  });
});
