import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { fixture, correction, at } from "../fixtures/start-checkin-dns";
import { validateStoredStartCheckinDns, validateStoredStartCheckinDnsWithdrawal } from "../../src/start-checkin-dns-source";
import { resolveStoredResultHeadStates, loadActiveManualResultOverrideState } from "../../src/result-revision-state";
import { publicResults } from "../../src/results";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { getReadoutHistoryAsAdmin } from "../../src/readout-result-history";
import { listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin, exportFrozenIofResultListAsAdmin } from "../../src/result-finalization";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function device(row: typeof schema.startCheckinDevices.$inferSelect) {
  await db.insert(schema.pairingAdminAccessCredentials).values({ id: row.actorCredentialId, raceId: row.raceId,
    capability: row.capability, label: "Synthetic operator", secretHash: "a".repeat(64), issuedAt: at,
    expiresAt: new Date("2026-09-05T18:00:00.000Z") });
  await db.insert(schema.startCheckinDevices).values(row);
}
async function setup() {
  const f = fixture(), eventId = randomUUID(), courseId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk DNS-provenans", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: f.decision.raceId, eventId, name: "Test", raceDate: "2026-09-05" });
  await db.insert(schema.courses).values({ id: courseId, raceId: f.decision.raceId, name: "Testbana" });
  await db.insert(schema.courseVersions).values({ id: f.decision.courseVersionId, courseId, version: 1 });
  const controlId = randomUUID();
  await db.insert(schema.controls).values({ id: controlId, raceId: f.decision.raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId: f.decision.courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: f.decision.classId, raceId: f.decision.raceId, courseVersionId: f.decision.courseVersionId, name: "Testklass", startRule: "PUNCH" });
  await db.insert(schema.entries).values({ id: f.decision.entryId, raceId: f.decision.raceId, classId: f.decision.classId,
    givenName: "Test", familyName: "Löpare" });
  await device(f.device);
  return f;
}
async function save(f: ReturnType<typeof fixture>, result: typeof schema.resultRevisions.$inferInsert = f.result,
  decision: typeof schema.startCheckinDnsDecisions.$inferInsert | null = f.decision) {
  return db.transaction(async (tx) => {
    await tx.insert(schema.startCheckinOperations).values(f.operation);
    await tx.insert(schema.startCheckinRevisions).values(f.operationalRevision);
    await tx.insert(schema.resultRevisions).values(result);
    if (decision) await tx.insert(schema.startCheckinDnsDecisions).values(decision);
  });
}

describe("TASK 006W DNS PostgreSQL provenance (no sync writer enabled)", () => {
  it("uses one validated active head for public results and the manual-write guard, then hides an exact withdrawal", async () => {
    const f = await setup(); await save(f);
    const resolve = () => db.transaction(async (tx) => ({
      states: await resolveStoredResultHeadStates(tx, f.result.raceId, [f.result]),
      guard: await loadActiveManualResultOverrideState(tx, f.result.raceId, f.result)
    }));
    const active = await resolve();
    expect(active.states[0]?.state).toBe("ACTIVE_RESULT");
    expect(active.states[0]?.startCheckinDns?.source.decision.id).toBe(f.decision.id);
    expect(active.guard).toBe("ACTIVE_DID_NOT_START");
    expect((await publicResults(db, f.result.raceId)).results).toEqual([
      expect.objectContaining({ status: "DNS", reason: "DID_NOT_START", revision: 1 })
    ]);
    const credential = await issuePairingAdminAccessCredential(db, {
      raceId: f.result.raceId, capability: "EXPORT_IOF_RESULT_LIST", label: "Synthetic export",
      expiresAt: new Date("2026-09-05T18:00:00.000Z")
    }, { now: at });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, {
      expectedRaceId: f.result.raceId, expectedCapability: "EXPORT_IOF_RESULT_LIST", now: at
    });
    if (login.status !== "authenticated") throw new Error("Synthetic export login failed");
    const exportSnapshot = () => exportIofResultListAsAdmin(db, { raceId: f.result.raceId, sessionToken: login.sessionToken }, at);
    const snapshot = await exportSnapshot();
    expect(snapshot.status).toBe("ok");
    if (snapshot.status !== "ok") throw new Error("Missing Snapshot");
    const xml = new TextDecoder().decode(snapshot.bytes);
    expect(xml).toContain('status="Snapshot"');
    expect(xml).toContain("<Status>DidNotStart</Status>");
    expect(xml).not.toContain("<Position>");
    expect(xml).not.toContain(f.decision.id);
    expect(xml).not.toContain(f.operation.requestId);
    const finalCredential = await issuePairingAdminAccessCredential(db, {
      raceId: f.result.raceId, capability: "FINALIZE_RESULTS", label: "Synthetic finalization",
      expiresAt: new Date("2026-09-05T18:00:00.000Z")
    }, { now: at });
    const finalLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: finalCredential.accessCredential }, {
      expectedRaceId: f.result.raceId, expectedCapability: "FINALIZE_RESULTS", now: at
    });
    if (finalLogin.status !== "authenticated") throw new Error("Synthetic finalization login failed");
    const finalAuth = { raceId: f.result.raceId, sessionToken: finalLogin.sessionToken,
      csrfCookie: finalLogin.csrfToken, csrfHeader: finalLogin.csrfToken };
    const candidates = () => listResultFinalizationCandidatesAsAdmin(db, finalAuth, at);
    const ready = await candidates();
    if (ready.status !== "ok" || !ready.response.classes[0]) throw new Error("Missing class candidate");
    expect(ready.response.classes[0].blockerCodes).toEqual([]);
    const classResult = await finalizeResultsAsAdmin(db, { ...finalAuth,
      idempotencyKey: `result-finalization:${randomUUID()}`, request: {
        formatVersion: 1, scope: "CLASS", classId: f.decision.classId,
        expectedSnapshotVersion: 1, expectedBasisHash: ready.response.classes[0].basisHash,
        expectedLatestScopeRevision: null
      } }, { now: at });
    expect(classResult.status).toBe("finalized");
    const raceReady = await candidates();
    if (raceReady.status !== "ok") throw new Error("Missing race candidate");
    expect(raceReady.response.race.blockerCodes).toEqual([]);
    const finalizationId = randomUUID();
    const finalRequest = { ...finalAuth, idempotencyKey: `result-finalization:${randomUUID()}`, request: {
      formatVersion: 1, scope: "RACE", classId: null, expectedSnapshotVersion: 1,
      expectedBasisHash: raceReady.response.race.basisHash, expectedLatestScopeRevision: null
    } };
    const finalized = await finalizeResultsAsAdmin(db, finalRequest, { now: at, finalizationId });
    expect(finalized.status).toBe("finalized");
    const replayed = await finalizeResultsAsAdmin(db, finalRequest, { now: at });
    expect(replayed).toMatchObject({ status: "finalized", response: { replayed: true } });
    const exportComplete = () => exportFrozenIofResultListAsAdmin(db, {
      raceId: f.result.raceId, sessionToken: login.sessionToken, finalizationId
    }, at);
    const complete = await exportComplete();
    expect(complete.status).toBe("ok");
    if (complete.status !== "ok") throw new Error("Missing Complete");
    const completeXml = new TextDecoder().decode(complete.bytes);
    expect(completeXml).toContain('status="Complete"');
    expect(completeXml).toContain("<Status>DidNotStart</Status>");
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(frozen?.frozenProjection).toMatchObject({ formatVersion: 9, classes: [{ class: { results: [{ source: {
      kind: "START_CHECKIN_DID_NOT_START", startCheckinDnsDecisionId: f.decision.id,
      operationRequestId: f.operation.requestId, withdrawal: null
    } }] } }] });
    const c = correction(f); await device(c.device);
    await db.transaction(async (tx) => {
      await tx.insert(schema.startCheckinOperations).values(c.operation);
      await tx.insert(schema.startCheckinRevisions).values(c.operationalRevision);
      await tx.insert(schema.startCheckinDnsWithdrawals).values(c.withdrawal);
    });
    const withdrawn = await resolve();
    expect(withdrawn.states[0]?.state).toBe("NO_ACTIVE_RESULT");
    expect(withdrawn.guard).toBe("NONE");
    expect((await publicResults(db, f.result.raceId)).results).toEqual([]);
    const correctedSnapshot = await exportSnapshot();
    expect(correctedSnapshot.status).toBe("ok");
    if (correctedSnapshot.status !== "ok") throw new Error("Missing corrected Snapshot");
    const correctedXml = new TextDecoder().decode(correctedSnapshot.bytes);
    expect(correctedXml).toContain('status="Snapshot"');
    expect(correctedXml).not.toContain("<PersonResult>");
    expect(correctedXml).not.toContain("DidNotStart");
    const withdrawnCandidates = await candidates();
    expect(withdrawnCandidates.status).toBe("ok");
    if (withdrawnCandidates.status !== "ok") throw new Error("Missing withdrawn candidates");
    expect(withdrawnCandidates.response.classes[0]?.blockerCodes).toContain("WITHDRAWN_DID_NOT_START");
    expect(await exportComplete()).toEqual(complete);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.result.entryId))).toHaveLength(1);
    await db.insert(schema.cardAssignments).values({ raceId: f.result.raceId, entryId: f.result.entryId, cardNumber: "12345" });
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-05T10:00:00Z",
      finishPunchedAt: "2026-09-05T10:30:00Z", punches: [{ code: 31, punchedAt: "2026-09-05T10:15:00Z" }] };
    await ingestDeviceBatch(db, f.result.raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-05T10:31:00Z",
        transport: "simulator", payload, contentHash: contentHash(payload) }] });
    const [readout] = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.result.raceId));
    if (!readout) throw new Error("Synthetic ingest produced no readout");
    expect((await publicResults(db, f.result.raceId)).results).toEqual([
      expect.objectContaining({ status: "OK", revision: 2 })
    ]);
    const historyCredential = await issuePairingAdminAccessCredential(db, {
      raceId: f.result.raceId, capability: "VIEW_READOUT_RESULT_HISTORY", label: "Synthetic history",
      expiresAt: new Date("2026-09-05T18:00:00.000Z")
    }, { now: at });
    const historyLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: historyCredential.accessCredential }, {
      expectedRaceId: f.result.raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY", now: at
    });
    if (historyLogin.status !== "authenticated") throw new Error("Synthetic history login failed");
    const history = await getReadoutHistoryAsAdmin(db, {
      raceId: f.result.raceId, sessionToken: historyLogin.sessionToken, readoutId: readout.id, limit: 50
    }, at);
    expect(history.status).toBe("ok");
    if (history.status !== "ok") throw new Error("Missing readout history");
    expect(history.response.formatVersion).toBe(15);
    expect(history.response.history.items).toEqual([
      expect.objectContaining({ revision: 1, source: {
        kind: "START_CHECKIN_DID_NOT_START", startCheckinDnsDecisionId: f.decision.id,
        operationRequestId: f.operation.requestId, startCheckinRevisionId: f.operationalRevision.id,
        operationalRevision: 1, withdrawal: { id: c.withdrawal.id, operationRequestId: c.operation.requestId,
          startCheckinRevisionId: c.operationalRevision.id, operationalRevision: 2 }
      } }),
      expect.objectContaining({ revision: 2, cause: "CARD_READOUT" })
    ]);
    expect(JSON.stringify(history.response)).not.toContain(f.device.actorCredentialId);
    expect(JSON.stringify(history.response)).not.toContain(f.operation.contentHash);
    expect(await exportComplete()).toEqual(complete);
  });

  it("commits the full reciprocal source and validates stored rows without a fake readout", async () => {
    const f = await setup(); await save(f);
    const [result] = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, f.result.id));
    const [decision] = await db.select().from(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.id, f.decision.id));
    if (!result || !decision) throw new Error("Missing source");
    expect(validateStoredStartCheckinDns({ ...f, result, decision })).toEqual(f.result.evaluation);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.decision.raceId))).toHaveLength(0);
    expect(await db.select().from(schema.didNotStartDecisions).where(eq(schema.didNotStartDecisions.raceId, f.decision.raceId))).toHaveLength(0);
  });

  it("rejects orphaned and mismatched result links at commit without partial journal writes", async () => {
    for (const mismatch of ["missing", "id", "revision", "operation"] as const) {
      const f = await setup();
      const d = mismatch === "missing" ? null : { ...f.decision,
        ...(mismatch === "id" ? { createdResultRevisionId: randomUUID() } : {}),
        ...(mismatch === "revision" ? { expectedLatestResultRevision: 1, createdResultRevision: 2 } : {}),
        ...(mismatch === "operation" ? { operationRequestId: randomUUID() } : {}) };
      await expect(save(f, f.result, d)).rejects.toThrow();
      expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, f.result.id))).toHaveLength(0);
      expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, f.operation.requestId))).toHaveLength(0);
    }
  });

  it("does not allow the new source to masquerade as manual/technical or carry non-DNS status", async () => {
    const changes: Partial<typeof schema.resultRevisions.$inferInsert>[] = [
      { cause: "MANUAL_DID_NOT_START" }, { cause: "CARD_READOUT" }, { startCheckinDnsDecisionId: null },
      { status: "MP", reason: "MISSING_START" }, { didNotStartDecisionId: randomUUID() }, { reason: "COMPLETE" }
    ];
    for (const change of changes) {
      const f = await setup();
      await expect(save(f, { ...f.result, ...change })).rejects.toThrow();
    }
  });

  it("rejects a real class id belonging to another race", async () => {
    const f = await setup(), other = await setup();
    await expect(save(f, f.result, { ...f.decision, classId: other.decision.classId })).rejects.toThrow();
  });

  it("stores an exact later withdrawal and rejects an unrelated target", async () => {
    const f = await setup(); await save(f);
    const c = correction(f); await device(c.device);
    const write = (withdrawal: typeof schema.startCheckinDnsWithdrawals.$inferInsert) => db.transaction(async (tx) => {
      await tx.insert(schema.startCheckinOperations).values(c.operation);
      await tx.insert(schema.startCheckinRevisions).values(c.operationalRevision);
      await tx.insert(schema.startCheckinDnsWithdrawals).values(withdrawal);
    });
    await expect(write({ ...c.withdrawal, withdrawnResultRevisionId: randomUUID() })).rejects.toThrow();
    await write(c.withdrawal);
    const [withdrawal] = await db.select().from(schema.startCheckinDnsWithdrawals).where(eq(schema.startCheckinDnsWithdrawals.id, c.withdrawal.id));
    if (!withdrawal) throw new Error("Missing withdrawal");
    expect(validateStoredStartCheckinDnsWithdrawal(f, { ...c, withdrawal })).toEqual(c.withdrawal);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.result.entryId))).toHaveLength(1);
    await expect(db.insert(schema.startCheckinDnsWithdrawals).values({ ...c.withdrawal, id: randomUUID() })).rejects.toThrow();
    await expect(db.update(schema.startCheckinDnsWithdrawals).set({ withdrawnAt: new Date() }).where(eq(schema.startCheckinDnsWithdrawals.id, c.withdrawal.id))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinDnsWithdrawals).where(eq(schema.startCheckinDnsWithdrawals.id, c.withdrawal.id))).rejects.toThrow();
  });

  it("keeps the DNS decision and result immutable", async () => {
    const f = await setup(); await save(f);
    await expect(db.update(schema.startCheckinDnsDecisions).set({ decidedAt: new Date() }).where(eq(schema.startCheckinDnsDecisions.id, f.decision.id))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinDnsDecisions).where(eq(schema.startCheckinDnsDecisions.id, f.decision.id))).rejects.toThrow();
    await expect(db.update(schema.resultRevisions).set({ startCheckinDnsDecisionId: null }).where(eq(schema.resultRevisions.id, f.result.id))).rejects.toThrow();
  });
});
