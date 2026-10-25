import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  changeEntryStartTimeAsAdmin, listEntryStartTimesAsAdmin, changeEntryCardAsAdmin, changeEntryIdentityAsAdmin,
  listEntryIdentitiesAsAdmin, listEntryCardsAsAdmin, listEntryRegistrationClassesAsAdmin, registerEntryAsAdmin,
  importIofXml, importIofXmlAsAdmin, ingestDeviceBatch, finalizeResultsAsAdmin,
  listResultFinalizationCandidatesAsAdmin,
  listResultRecalculationCandidatesAsAdmin, publicResults, recalculateEntryAsAdmin
} from "../../src";
import {
  decideStartListPublicationAsAdmin, getStartListPublicationPreviewAsAdmin, getPublishedStartListXml
} from "../../src/start-list-publication";
import { statusFlow } from "./entry-status-helpers";
import { db, entryXml, startListXml, readoutPackage, importedRace, trustedRaceFixtureOverview, batch, okPayload, useRaceDatabase } from "./race-fixtures";
import { raceLogin } from "./accounts";

useRaceDatabase();

describe("TASK 006Q direktanmälan PostgreSQL", () => {
  const now = new Date("2026-09-04T10:00:00Z");
  async function auth(raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN") {
    const login = await raceLogin(db, raceId, role, now);
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function input(authentication: Awaited<ReturnType<typeof auth>>) {
    const list = await listEntryRegistrationClassesAsAdmin(db, authentication, now);
    if (list.status !== "ok") throw new Error("Klassunderlag saknas");
    const raceClass = list.response.classes.find((row) => row.name === "H21")!;
    return { ...authentication, packageVersion: list.response.snapshotVersion, idempotencyKey: `entry-registration:${crypto.randomUUID()}`,
      request: { formatVersion: 1, classId: raceClass.id, expectedCourseVersionId: raceClass.courseVersionId,
        expectedStartRule: raceClass.startRule, givenName: " Anna ", familyName: " Andersson ", organisationName: "Test OK", cardNumber: "54321",
        fixedStartTime: raceClass.startRule === "FIXED" ? "2026-08-30T12:00:00+02:00" : null } };
  }
  it("skapar atomiskt utan resultat, återger exakt retry och deltar i paket och vanlig ingest", async () => {
    const { raceId } = await importedRace();
    const request = await input(await auth(raceId));
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const original = await publicResults(db, raceId);
    const result = await registerEntryAsAdmin(db, request, now);
    if (result.status !== "registered") throw new Error("Registrering misslyckades");
    expect(result.response).toMatchObject({ givenName: "Anna", familyName: "Andersson", entryVersion: 1 });
    expect(await publicResults(db, raceId)).toEqual(original);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, result.response.entryId))).toHaveLength(0);
    const packet = await readoutPackage(raceId);
    expect(packet.packageVersion).toBe(request.packageVersion + 1);
    expect(packet.raceSnapshot.entries.find((row) => row.id === result.response.entryId)).toBeDefined();
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "54321")).toMatchObject({ entryId: result.response.entryId, active: true });
    const ack = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" }));
    expect(ack.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "OK" } });
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, result.response.entryId));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.evaluation).toMatchObject({ elapsedMs: 40 * 60_000 });
    await db.update(schema.entries).set({ givenName: "Senare namn", version: 2 }).where(eq(schema.entries.id, result.response.entryId));
    expect(await registerEntryAsAdmin(db, request, now)).toEqual({ status: "registered", response: { ...result.response, replayed: true } });
    const journals = await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, raceId));
    expect(journals).toHaveLength(1);
    await expect(db.delete(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.id, journals[0]!.id))).rejects.toThrow();
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_REGISTERED_BY_ADMIN")))).toHaveLength(1);
  });
  it("avvisar stale/auth/ägd bricka utan orphan-entry och serialiserar samtidiga registreringar", async () => {
    const { raceId } = await importedRace();
    const request = await input(await auth(raceId));
    const before = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    expect((await registerEntryAsAdmin(db, { ...request, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await listEntryRegistrationClassesAsAdmin(db, await auth(raceId, "FUNCTIONARY"), now)).status).toBe("forbidden");
    await db.update(schema.cardAssignments).set({ active: false }).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, "67890")));
    for (const change of [{ classId: crypto.randomUUID() },
      { expectedCourseVersionId: crypto.randomUUID() }, { cardNumber: "12345" }, { cardNumber: "67890" }]) {
      expect((await registerEntryAsAdmin(db, { ...request, request: { ...request.request, ...change } }, now)).status).toBe("conflict");
    }
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toEqual(before);
    const other = { ...request, idempotencyKey: `entry-registration:${crypto.randomUUID()}` };
    const results = await Promise.all([request, other].map((r) => registerEntryAsAdmin(db, r, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["conflict", "registered"]);
    const winner = results[0]?.status === "registered" ? request : other;
    expect((await registerEntryAsAdmin(db, { ...winner, request: { ...winner.request, givenName: "Ändrad" } }, now)).status).toBe("conflict");
    expect((await registerEntryAsAdmin(db, { ...winner, ...await auth(raceId) }, now)).status).toBe("conflict");
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toHaveLength(before.length + 1);
    expect(await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, raceId))).toHaveLength(1);
  });
  it("kräver FIXED-tid, tillåter utan bricka och löser tidigare okänd avläsning endast genom separat omräkning", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const initial = await input(authentication);
    const unknownBatch = batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" });
    const unknown = await ingestDeviceBatch(db, raceId, unknownBatch);
    expect(unknown.acknowledgements[0]).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const registration = await registerEntryAsAdmin(db, initial, now);
    if (registration.status !== "registered") throw new Error("Registrering misslyckades");
    const recalcAuth = await auth(raceId, "ADMIN");
    const list = await listResultRecalculationCandidatesAsAdmin(db, recalcAuth, now);
    if (list.status !== "ok") throw new Error("Omräkningslista saknas");
    const candidate = list.response.entries.find((row) => row.id === registration.response.entryId)!;
    expect(candidate.latestResultRevision).toBeNull();
    expect((await recalculateEntryAsAdmin(db, { ...recalcAuth, entryId: candidate.id,
      idempotencyKey: `result-recalculation:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCardAssignmentId: candidate.cardAssignmentId,
        expectedReadoutId: candidate.latestReadout!.id, expectedLatestResultRevision: null,
        expectedEngineVersion: list.response.engineVersion } }, now)).status).toBe("recalculated");
    expect((await ingestDeviceBatch(db, raceId, unknownBatch)).acknowledgements[0]).toEqual({ ...unknown.acknowledgements[0], status: "duplicate" });
    await db.update(schema.classes).set({ startRule: "FIXED" }).where(eq(schema.classes.id, initial.request.classId));
    const fixed = await input(authentication);
    expect((await registerEntryAsAdmin(db, { ...fixed, request: { ...fixed.request, fixedStartTime: null } }, now)).status).toBe("conflict");
    const noCard = await registerEntryAsAdmin(db, { ...fixed, request: { ...fixed.request, cardNumber: null } }, now);
    expect(noCard).toMatchObject({ status: "registered", response: { cardNumber: null, assignmentId: null, fixedStartTime: "2026-08-30T10:00:00.000Z" } });
  });
});

describe("TASK 006P individuellt brickbyte PostgreSQL", () => {
  const now = new Date("2026-09-04T10:00:00Z");
  async function auth(raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN") {
    const login = await raceLogin(db, raceId, role, now);
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function input(authentication: Awaited<ReturnType<typeof auth>>, cardNumber = "54321") {
    const listed = await listEntryCardsAsAdmin(db, authentication, now);
    if (listed.status !== "ok") throw new Error("Brickbyteslista saknas");
    const entry = listed.response.entries.find((row) => row.displayName.startsWith("Ada"));
    if (!entry) throw new Error("Ada saknas");
    return { ...authentication, packageVersion: listed.response.snapshotVersion, entryId: entry.id,
      idempotencyKey: `entry-card-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedAssignment: entry.activeAssignment, cardNumber } };
  }
  it("byter idempotent, bevarar gamla data, ger nytt paket och räknar om tidigare okänd ny bricka explicit", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    const oldBatch = batch(crypto.randomUUID(), okPayload);
    const originalAck = await ingestDeviceBatch(db, raceId, oldBatch);
    const unknownBatch = batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321", finishPunchedAt: "2026-08-30T10:45:00Z" });
    const unknownAck = await ingestDeviceBatch(db, raceId, unknownBatch);
    expect(unknownAck.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    const oldResults = await publicResults(db, raceId);
    const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id));
    const result = await changeEntryCardAsAdmin(db, request, now);
    expect(result.status).toBe("changed");
    if (result.status !== "changed") throw new Error("Byte misslyckades");
    expect(await changeEntryCardAsAdmin(db, request, now)).toEqual({ status: "changed", response: { ...result.response, replayed: true } });
    expect(await publicResults(db, raceId)).toEqual(oldResults);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id))).toEqual(raw);
    const packet = await readoutPackage(raceId);
    expect(packet.packageVersion).toBe(request.packageVersion + 1);
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "12345")?.active).toBe(false);
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "54321")?.active).toBe(true);
    const late = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    expect(late).toMatchObject({ packageVersionStatus: "stale" });
    expect(late.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    expect((await ingestDeviceBatch(db, raceId, oldBatch)).acknowledgements[0]).toEqual({ ...originalAck.acknowledgements[0], status: "duplicate" });
    expect((await ingestDeviceBatch(db, raceId, unknownBatch)).acknowledgements[0]).toEqual({ ...unknownAck.acknowledgements[0], status: "duplicate" });
    const recalcAuth = await auth(raceId, "ADMIN");
    const list = await listResultRecalculationCandidatesAsAdmin(db, recalcAuth, now);
    if (list.status !== "ok") throw new Error("Omräkning saknas");
    const candidate = list.response.entries.find((row) => row.id === request.entryId)!;
    expect(candidate.latestReadout?.id).not.toBeUndefined();
    expect((await recalculateEntryAsAdmin(db, { ...recalcAuth, entryId: request.entryId,
      idempotencyKey: `result-recalculation:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCardAssignmentId: candidate.cardAssignmentId,
        expectedReadoutId: candidate.latestReadout!.id, expectedLatestResultRevision: {
          id: candidate.latestResultRevision!.id, revision: candidate.latestResultRevision!.revision }, expectedEngineVersion: list.response.engineVersion } }, now)).status).toBe("recalculated");
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, request.entryId)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(revisions[1]?.evaluation).toMatchObject({ elapsedMs: 45 * 60_000 });
    const back = await changeEntryCardAsAdmin(db, await input(authentication, "12345"), now);
    expect(back).toMatchObject({ status: "changed", response: { activeAssignment: request.request.expectedAssignment } });
    expect((await changeEntryCardAsAdmin(db, request, now))).toEqual({ status: "changed", response: { ...result.response, replayed: true } });
    const journals = await db.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.raceId, raceId));
    expect(journals).toHaveLength(2);
    await expect(db.delete(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.id, journals[0]!.id))).rejects.toThrow();
    await expect(db.update(schema.cardAssignments).set({ cardNumber: "99999" }).where(eq(schema.cardAssignments.id, result.response.activeAssignment.id))).rejects.toThrow();
    await expect(db.delete(schema.cardAssignments).where(eq(schema.cardAssignments.id, result.response.activeAssignment.id))).rejects.toThrow();
  });
  it("avvisar fel auth/stale/no-op och annans historiska bricka; två writers får en vinnare", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    expect((await changeEntryCardAsAdmin(db, { ...request, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await listEntryCardsAsAdmin(db, await auth(raceId, "FUNCTIONARY"), now)).status).toBe("forbidden");
    for (const changed of [{ expectedEntryVersion: 99 }, { expectedClassId: crypto.randomUUID() },
      { expectedAssignment: null }, { cardNumber: "12345" }, { cardNumber: "67890" }]) {
      expect((await changeEntryCardAsAdmin(db, { ...request, request: { ...request.request, ...changed } }, now)).status).toBe("conflict");
    }
    await db.update(schema.cardAssignments).set({ active: false }).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, "67890")));
    expect((await changeEntryCardAsAdmin(db, { ...request, request: { ...request.request, cardNumber: "67890" } }, now)).status).toBe("conflict");
    const other = { ...request, idempotencyKey: `entry-card-change:${crypto.randomUUID()}` };
    const results = await Promise.all([request, other].map((r) => changeEntryCardAsAdmin(db, r, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["changed", "conflict"]);
    const winner = results[0]?.status === "changed" ? request : other;
    expect((await changeEntryCardAsAdmin(db, { ...winner, request: { ...winner.request, cardNumber: "33333" } }, now)).status).toBe("conflict");
    expect((await changeEntryCardAsAdmin(db, { ...winner, ...await auth(raceId) }, now)).status).toBe("conflict");
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_CARD_CHANGED_BY_ADMIN")))).toHaveLength(1);
    const recalc = await listResultRecalculationCandidatesAsAdmin(db, await auth(raceId, "ADMIN"), now);
    if (recalc.status !== "ok") throw new Error("Omräkningslista saknas");
    expect(recalc.response.entries.find((row) => row.id === request.entryId)).toMatchObject({ readiness: "NO_READOUT", latestReadout: null });
    await db.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.entryId, request.entryId));
    expect((await changeEntryCardAsAdmin(db, await input(authentication, "33333"), now)).status).toBe("changed");
    await db.insert(schema.cardAssignments).values({ raceId, entryId: request.entryId, cardNumber: "44444" });
    const multiple = await listEntryCardsAsAdmin(db, authentication, now);
    if (multiple.status !== "ok") throw new Error("Brickbyteslista saknas");
    expect(multiple.response.entries.find((row) => row.id === request.entryId)).toMatchObject({ multipleActiveAssignments: true, activeAssignment: null });
    expect((await changeEntryCardAsAdmin(db, await input(authentication, "55555"), now)).status).toBe("conflict");
  });
  it("EntryList kan varken återställa byte eller flytta ägare och rullar tillbaka övriga filändringar", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    await changeEntryCardAsAdmin(db, await input(authentication), now);
    const before = await trustedRaceFixtureOverview(raceId);
    await expect(importIofXml(db, raceId, entryXml.replace("Ada", "Ändrat namn"))).rejects.toThrow(/brickbyte/);
    expect(await trustedRaceFixtureOverview(raceId)).toEqual(before);
    await expect(importIofXml(db, raceId, entryXml.replace("12345", "67890"))).rejects.toThrow();
    expect(await trustedRaceFixtureOverview(raceId)).toEqual(before);
    await importIofXml(db, raceId, entryXml.replace("12345", "54321"));
    const current = await listEntryCardsAsAdmin(db, authentication, now);
    if (current.status !== "ok") throw new Error("Brickbyteslista saknas");
    expect(current.response.entries.find((row) => row.displayName.startsWith("Ada")))
      .toMatchObject({ activeAssignment: { cardNumber: "54321" }, multipleActiveAssignments: false });
    await importIofXml(db, raceId, entryXml);
    expect(await listEntryCardsAsAdmin(db, authentication, now)).toEqual(current);
  });
  it("behåller manuellt NT när ny bricka anländer samtidigt med brickbyte", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ntAuth = await auth(raceId, "ADMIN");
    expect((await statusFlow(db).decide(ntAuth, request.entryId, { kind: "WITHOUT_TIMING" }, { now })).status).toBe("decided");
    const before = await publicResults(db, raceId);
    expect(before.results[0]?.status).toBe("NT");
    const [changed, ingested] = await Promise.all([changeEntryCardAsAdmin(db, request, now),
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" }))]);
    expect(changed.status).toBe("changed");
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    expect(await publicResults(db, raceId)).toEqual(before);
  });
});

describe("TASK 006O individuell fast starttid PostgreSQL", () => {
  const now = new Date("2026-09-04T10:02:00Z");
  async function access(raceId: string, role: "ADMIN" | "FUNCTIONARY") {
    const login = await raceLogin(db, raceId, role, now);
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function fixture() {
    const { raceId } = await importedRace();
    await importIofXml(db, raceId, startListXml);
    const auth = await access(raceId, "ADMIN");
    const listed = await listEntryStartTimesAsAdmin(db, auth, now);
    if (listed.status !== "ok" || !listed.response.entries[0]) throw new Error("Starttidslista saknas");
    expect(listed.response.timeZone).toBe("Europe/Stockholm");
    const entry = listed.response.entries.find((row) => row.displayName.startsWith("Ada"));
    if (!entry) throw new Error("Ada saknas");
    const input = { ...auth, packageVersion: listed.response.snapshotVersion, entryId: entry.id,
      idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedFixedStartTime: entry.fixedStartTime,
        fixedStartTime: "2026-08-31T10:05:00+02:00" } };
    return { raceId, auth, entry, input };
  }
  const payload = { ...okPayload, startPunchedAt: "2026-08-31T08:00:00Z", finishPunchedAt: "2026-08-31T08:40:00Z",
    punches: [31, 32, 33].map((code, i) => ({ code, punchedAt: `2026-08-31T08:${10 + i * 10}:00Z` })) };

  it("räknar om avläst resultat direkt, bevarar råa avläsningar och Complete, ger nytt paket samt stale ingest", async () => {
    const f = await fixture();
    for (const cardNumber of ["12345", "67890"]) {
      await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), { ...payload, cardNumber },
        { packageVersion: f.input.packageVersion, stationReceivedAt: "2026-08-31T08:41:00Z" }));
    }
    const finalAuth = await access(f.raceId, "ADMIN");
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (candidates.status !== "ok") throw new Error("Finaliseringslista saknas");
    for (const candidate of candidates.response.classes.filter((row) => row.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: { formatVersion: 1, scope: "CLASS", classId: candidate.classId,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    }
    const ready = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (ready.status !== "ok") throw new Error("Finaliseringsgrund saknas");
    const finalized = await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: { formatVersion: 1, scope: "RACE", classId: null, expectedBasisHash: ready.response.race.basisHash, expectedLatestScopeRevision: null } }, { now });
    expect(finalized.status).toBe("finalized");
    const frozen = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, f.raceId));
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId)).orderBy(asc(schema.resultRevisions.id));
    const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId));
    const readouts = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId));
    const publicBefore = await publicResults(db, f.raceId);
    const oldPackage = await readoutPackage(f.raceId);
    const saved = await changeEntryStartTimeAsAdmin(db, f.input, now);
    expect(saved.status).toBe("changed");
    expect(await publicResults(db, f.raceId)).not.toEqual(publicBefore);
    const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId)).orderBy(asc(schema.resultRevisions.id));
    expect(after.filter((row) => revisions.some((old) => old.id === row.id))).toEqual(revisions);
    expect(after.filter((row) => !revisions.some((old) => old.id === row.id)).map((row) => row.entryId)).toEqual([f.entry.id]);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId))).toEqual(raw);
    expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId))).toEqual(readouts);
    const current = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (current.status !== "ok") throw new Error("Finaliseringslista saknas");
    expect(current.response.classes.find((row) => row.classId === f.entry.classId)?.blockerCodes).not.toContain("STALE_RESULT_SNAPSHOT");
    const nextPackage = await readoutPackage(f.raceId);
    expect(nextPackage.packageVersion).toBe(f.input.packageVersion + 1);
    expect(nextPackage.raceSnapshot.entries.find((row) => row.id === f.entry.id)?.fixedStartTime).toBe("2026-08-31T08:05:00.000Z");
    expect(oldPackage.raceSnapshot.entries.find((row) => row.id === f.entry.id)?.fixedStartTime).toBe("2026-08-31T08:00:00.000Z");
    const updated = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.entry.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({ cause: "EXPLICIT_RECALCULATION", evaluation: { elapsedMs: 35 * 60_000, startTime: "2026-08-31T08:05:00.000Z" } });
    const ack = await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload,
      { packageVersion: f.input.packageVersion, stationReceivedAt: "2026-08-31T08:45:00Z" }));
    expect(ack).toMatchObject({ packageVersionStatus: "stale", packageUpdateRequired: true });
    expect(await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, f.raceId))).toEqual(frozen);
    if (saved.status !== "changed") throw new Error("Sparat svar saknas");
    expect(await changeEntryStartTimeAsAdmin(db, f.input, now)).toEqual({ status: "changed", response: { ...saved.response, replayed: true } });
  });

  it("avvisar fel behörighet och stale/no-op/PUNCH; en samtidig vinnare med immutable auditjournal", async () => {
    const f = await fixture();
    expect(await listEntryStartTimesAsAdmin(db, { ...f.auth, sessionToken: null }, now)).toEqual({ status: "unauthorized" });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, csrfHeader: "x".repeat(43) }, now)).status).toBe("forbidden");
    const otherAuth = await access(f.raceId, "FUNCTIONARY");
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...otherAuth }, now)).status).toBe("forbidden");
    for (const request of [{ ...f.input.request, fixedStartTime: f.entry.fixedStartTime },
      { ...f.input.request, expectedEntryVersion: 99 }, { ...f.input.request, expectedClassId: crypto.randomUUID() },
      { ...f.input.request, expectedFixedStartTime: null }]) {
      expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, request }, now)).status).toBe("conflict");
    }
    await db.update(schema.classes).set({ startRule: "PUNCH" }).where(eq(schema.classes.id, f.entry.classId));
    expect((await listEntryStartTimesAsAdmin(db, f.auth, now))).toMatchObject({ status: "ok", response: { entries: [] } });
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("conflict");
    await db.update(schema.classes).set({ startRule: "FIXED" }).where(eq(schema.classes.id, f.entry.classId));
    const inputs = [f.input, { ...f.input, idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}` }];
    const results = await Promise.all(inputs.map((input) => changeEntryStartTimeAsAdmin(db, input, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["changed", "conflict"]);
    const winner = inputs[results.findIndex((row) => row.status === "changed")]!;
    const journal = await db.select().from(schema.entryStartTimeChangeRequests).where(eq(schema.entryStartTimeChangeRequests.raceId, f.raceId));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ entryVersionBefore: f.entry.version, entryVersionAfter: f.entry.version + 1,
      snapshotVersionBefore: f.input.packageVersion, snapshotVersionAfter: f.input.packageVersion + 1 });
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, f.raceId), eq(schema.auditEvents.action, "ENTRY_START_TIME_CHANGED_BY_ADMIN")))).toHaveLength(1);
    await expect(db.update(schema.entryStartTimeChangeRequests).set({ changedAt: now }).where(eq(schema.entryStartTimeChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.entryStartTimeChangeRequests).where(eq(schema.entryStartTimeChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    expect((await changeEntryStartTimeAsAdmin(db, { ...winner, request: { ...winner.request, fixedStartTime: "2026-08-31T09:00:00Z" } }, now)).status).toBe("conflict");
    expect((await changeEntryStartTimeAsAdmin(db, { ...winner, ...await access(f.raceId, "ADMIN") }, now)).status).toBe("conflict");
    await db.update(schema.entries).set({ fixedStartTime: null }).where(eq(schema.entries.id, f.entry.id));
    const fromMissing = await changeEntryStartTimeAsAdmin(db, { ...f.input,
      idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}`, request: { ...f.input.request,
        expectedEntryVersion: f.entry.version + 1, expectedFixedStartTime: null } }, now);
    expect(fromMissing).toMatchObject({ status: "changed", response: { previousFixedStartTime: null } });
  });

  it("bevarar aktivt manuellt NT vid starttidsändring och samtidig ingest", async () => {
    const f = await fixture();
    await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload));
    const ntAuth = await access(f.raceId, "ADMIN");
    expect((await statusFlow(db).decide(ntAuth, f.entry.id, { kind: "WITHOUT_TIMING" }, { now })).status).toBe("decided");
    const before = await publicResults(db, f.raceId);
    expect(before.results).toHaveLength(1);
    expect(before.results[0]?.status).toBe("NT");
    const [changed, ingested] = await Promise.all([
      changeEntryStartTimeAsAdmin(db, f.input, now),
      ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload, { packageVersion: f.input.packageVersion }))
    ]);
    expect(changed.status).toBe("changed");
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    // Steg 44: NT följer med till omräkningen (tas bort och läggs på nytt) och står kvar; sträcktiderna räknas från den
    // nya starttiden (fem minuter senare).
    const after = await publicResults(db, f.raceId);
    expect(after.results).toHaveLength(1);
    expect(after.results[0]).toMatchObject({ status: "NT", rankingState: "NOT_RANKABLE_STATUS" });
    expect((after.results[0] as { splits?: { elapsedMs: number }[] }).splits?.map((split) => split.elapsedMs))
      .toEqual([5 * 60_000, 15 * 60_000, 25 * 60_000]);
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.entry.id)).orderBy(asc(schema.resultRevisions.revision));
    // Oavsett ordning: ingest och omräkningen efter starttidsändringen ger var sin revision, och den sista tekniska bygger på
    // den nya starttiden. Beslutet ligger kvar på det nya underlaget.
    expect(revisions.map((row) => row.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    const last = revisions.filter((row) => row.readoutId !== null).at(-1)!;
    expect(last.snapshotVersion).toBe(f.input.packageVersion + 1);
    expect(last.evaluation).toMatchObject({ elapsedMs: 35 * 60_000 });
    expect(revisions.filter((row) => row.cause === "MANUAL_WITHOUT_TIMING").at(-1)?.snapshotVersion).toBe(f.input.packageVersion + 1);
  });
});

describe("TASK026 versionsbunden namn- och klubbrättning PostgreSQL", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  async function auth(raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN") {
    const login = await raceLogin(db, raceId, role, now);
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function inputFor(authentication: Awaited<ReturnType<typeof auth>>, entryId: string) {
    const list = await listEntryIdentitiesAsAdmin(db, authentication, now);
    if (list.status !== "ok") throw new Error("Namnunderlag saknas");
    const entry = list.response.entries.find((row) => row.id === entryId)!;
    return { ...authentication, packageVersion: list.response.snapshotVersion, entryId,
      idempotencyKey: `entry-identity-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1 as const, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedIdentity: entry.identity,
        identity: { givenName: "Alva", familyName: "Rättad", organisationName: "Ny OK" } } };
  }
  async function state(raceId: string) {
    return Promise.all([
      db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id)),
      db.select().from(schema.races).where(eq(schema.races.id, raceId)),
      db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId)).orderBy(asc(schema.importFiles.id)),
      db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId)).orderBy(asc(schema.entryIdentityChangeRequests.id)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)).orderBy(asc(schema.auditEvents.id)),
      db.select().from(schema.iofImportRequests).where(eq(schema.iofImportRequests.raceId, raceId)).orderBy(asc(schema.iofImportRequests.requestId))
    ]);
  }

  it("rättar endast identitet/version, bevarar resultat och publicerade bytes samt återger första kvittot efter senare rättning", async () => {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((row) => row.cardNumber === "12345")!;
    for (const cardNumber of ["12345", "67890"]) await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber }));
    const finalAuth = await auth(raceId, "ADMIN");
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (candidates.status !== "ok") throw new Error("Finaliseringsunderlag saknas");
    for (const candidate of candidates.response.classes.filter((row) => row.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: { formatVersion: 1, scope: "CLASS", classId: candidate.classId,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    }
    const ready = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (ready.status !== "ok") throw new Error("Loppunderlag saknas");
    expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: { formatVersion: 1, scope: "RACE", classId: null, expectedBasisHash: ready.response.race.basisHash, expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    const startAuth = await auth(raceId, "ADMIN");
    const preview = await getStartListPublicationPreviewAsAdmin(db, startAuth, now);
    if (preview.status !== "ok" || !preview.response.sourceHash) throw new Error("Startlisteunderlag saknas");
    await decideStartListPublicationAsAdmin(db, { ...startAuth, idempotencyKey: `start-list-publication:${crypto.randomUUID()}`,
      request: { formatVersion: 1, action: "PUBLISH", expectedSourceHash: preview.response.sourceHash, expectedRevision: 0 } }, now);
    const frozenStart = await getPublishedStartListXml(db, raceId);
    expect(frozenStart.status).toBe("exported");
    const unchanged = () => Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)).orderBy(asc(schema.cardReadouts.id)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)).orderBy(asc(schema.resultRevisions.id)),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, raceId)).orderBy(asc(schema.resultFinalizations.id)),
      db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.raceId, raceId)).orderBy(asc(schema.cardAssignments.id)),
      db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.id))
    ]);
    const preserved = await unchanged();
    const beforeEntries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const oldPackage = await readoutPackage(raceId);
    const authentication = await auth(raceId);
    const input = await inputFor(authentication, ada.id);
    input.request.identity.organisationName = "K".repeat(200);
    const first = await changeEntryIdentityAsAdmin(db, input, now);
    if (first.status !== "changed") throw new Error("Rättning misslyckades");
    expect(first.response).toMatchObject({ replayed: false, previousIdentity: input.request.expectedIdentity,
      identity: input.request.identity, entryVersionAfter: input.request.expectedEntryVersion + 1,
      snapshotVersionAfter: input.packageVersion + 1 });
    const afterEntries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    expect(afterEntries).toEqual(beforeEntries.map((entry) => entry.id === ada.id
      ? { ...entry, ...input.request.identity, version: entry.version + 1 } : entry));
    const nextPackage = await readoutPackage(raceId);
    expect(nextPackage.packageVersion).toBe(input.packageVersion + 1);
    expect(nextPackage.raceSnapshot.entries.find((row) => row.id === ada.id)).toMatchObject(input.request.identity);
    expect(oldPackage.raceSnapshot.entries.find((row) => row.id === ada.id))
      .toMatchObject({ givenName: ada.givenName, familyName: ada.familyName });
    const next = await inputFor(authentication, ada.id);
    next.request.identity.givenName = "Alice";
    expect((await changeEntryIdentityAsAdmin(db, next, now)).status).toBe("changed");
    const beforeRetry = await state(raceId);
    expect(await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, givenName: " Alva " } } }, now))
      .toEqual({ ...first, response: { ...first.response, replayed: true } });
    expect(await state(raceId)).toEqual(beforeRetry);
    expect(await unchanged()).toEqual(preserved);
    expect(await getPublishedStartListXml(db, raceId)).toEqual(frozenStart);
    const journal = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.entryId, ada.id));
    expect(journal).toHaveLength(2);
    expect(journal.find((row) => row.requestId === first.response.requestId)).toMatchObject({
      previousIdentity: input.request.expectedIdentity, identity: input.request.identity });
    await expect(db.update(schema.entryIdentityChangeRequests).set({ identity: input.request.expectedIdentity })
      .where(eq(schema.entryIdentityChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    expect(await state(raceId)).toEqual(beforeRetry);
  });

  it("avvisar stale, no-op, fel actor/target/intent och fel capability utan writes", async () => {
    const { raceId, overview } = await importedRace();
    const authentication = await auth(raceId);
    const otherActor = await auth(raceId);
    const wrongCapability = await auth(raceId, "FUNCTIONARY");
    const entryId = overview.entries[0]!.id;
    const input = await inputFor(authentication, entryId);
    const baseline = await state(raceId);
    expect((await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, organisationName: "K".repeat(201) } } }, now)).status).toBe("invalid-request");
    for (const request of [
      { ...input.request, identity: input.request.expectedIdentity },
      { ...input.request, expectedEntryVersion: input.request.expectedEntryVersion + 1 },
      { ...input.request, expectedIdentity: { ...input.request.expectedIdentity, givenName: "Fel" } }
    ]) expect((await changeEntryIdentityAsAdmin(db, { ...input, request }, now)).status).toBe("conflict");
    expect((await listEntryIdentitiesAsAdmin(db, wrongCapability, now)).status).toBe("forbidden");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, ...wrongCapability }, now)).status).toBe("forbidden");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, csrfHeader: "wrong" }, now)).status).toBe("forbidden");
    expect(await state(raceId)).toEqual(baseline);
    expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("changed");
    const after = await state(raceId);
    for (const attempt of [
      { ...input, ...otherActor },
      { ...input, entryId: overview.entries[1]!.id },
      { ...input, request: { ...input.request, identity: { ...input.request.identity, familyName: "Annan" } } }
    ]) expect((await changeEntryIdentityAsAdmin(db, attempt, now)).status).toBe("conflict");
    expect(await state(raceId)).toEqual(after);
  });

  it("låter exakt en av två aktörer rätta samma versionsgrund", async () => {
    const { raceId, overview } = await importedRace();
    const entryId = overview.entries[0]!.id;
    const firstAuth = await auth(raceId);
    const secondAuth = await auth(raceId);
    const first = await inputFor(firstAuth, entryId);
    const second = await inputFor(secondAuth, entryId);
    second.request.identity.givenName = "Annat val";
    const results = await Promise.all([changeEntryIdentityAsAdmin(db, first, now), changeEntryIdentityAsAdmin(db, second, now)]);
    expect(results.map((result) => result.status).sort()).toEqual(["changed", "conflict"]);
    const journal = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId));
    expect(journal).toHaveLength(1);
    const winner = results.find((result) => result.status === "changed");
    if (!winner || winner.status !== "changed") throw new Error("Vinnande rättning saknas");
    expect(journal[0]).toMatchObject({ identity: winner.response.identity,
      entryVersionAfter: first.request.expectedEntryVersion + 1, snapshotVersionAfter: first.packageVersion + 1 });
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, entryId));
    expect(entry).toMatchObject({ ...winner.response.identity, version: first.request.expectedEntryVersion + 1 });
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(race?.snapshotVersion).toBe(first.packageVersion + 1);
  });

  it("avvisar versionsoverflow utan entry-, journal- eller auditändring", async () => {
    for (const target of ["entry", "race"]) {
      const { raceId, overview } = await importedRace();
      const entryId = overview.entries[0]!.id;
      const authentication = await auth(raceId);
      if (target === "entry") await db.update(schema.entries).set({ version: 2_147_483_647 }).where(eq(schema.entries.id, entryId));
      else await db.update(schema.races).set({ snapshotVersion: 2_147_483_647 }).where(eq(schema.races.id, raceId));
      const input = await inputFor(authentication, entryId);
      const before = await state(raceId);
      expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("conflict");
      expect(await state(raceId)).toEqual(before);
    }
  });

  it("serialiserar samtidig import och rättning till ett helt före- eller efterläge", async () => {
    const { raceId, overview } = await importedRace();
    const bo = overview.entries.find(entry => entry.givenName === "Bo")!;
    const ada = overview.entries.find(entry => entry.givenName === "Ada")!;
    const authentication = await auth(raceId);
    const importer = await auth(raceId, "ADMIN");
    const input = await inputFor(authentication, bo.id);
    const xml = entryXml.replace("<Given>Ada</Given>", "<Given>Importerad Ada</Given>");
    const [correction, imported] = await Promise.all([
      changeEntryIdentityAsAdmin(db, input, now),
      importIofXmlAsAdmin(db, { ...importer, idempotencyKey: `iof-import:${crypto.randomUUID()}`,
        xmlBytes: Buffer.from(xml, "utf8") }, now)
    ]);
    const correctionWon = correction.status === "changed";
    expect([correction.status, imported.status]).toEqual(correctionWon ? ["changed", "conflict"] : ["conflict", "stored"]);
    const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    expect(entries.find(entry => entry.id === bo.id)?.givenName).toBe(correctionWon ? "Alva" : "Bo");
    expect(entries.find(entry => entry.id === ada.id)?.givenName).toBe(correctionWon ? "Ada" : "Importerad Ada");
    const journals = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId));
    expect(journals).toHaveLength(correctionWon ? 1 : 0);
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(race?.snapshotVersion).toBe(input.packageVersion + 1);
  });

  it("skyddar rättade fält mot ny import med hel rollback men behåller identisk content-retry", async () => {
    const { raceId, overview } = await importedRace();
    // Bo comes last in the fixture, so Ada's earlier update must roll back on Bo's conflict.
    const bo = overview.entries.find((row) => row.givenName === "Bo")!;
    const authentication = await auth(raceId);
    const importAuth = await auth(raceId, "ADMIN");
    const input = await inputFor(authentication, bo.id);
    expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("changed");
    const before = await state(raceId);
    const conflictingXml = entryXml.replace("<Given>Ada</Given>", "<Given>Felaktig Ada</Given>");
    expect((await importIofXmlAsAdmin(db, { ...importAuth, idempotencyKey: `iof-import:${crypto.randomUUID()}`,
      xmlBytes: Buffer.from(conflictingXml, "utf8") }, now)).status).toBe("conflict");
    expect(await state(raceId)).toEqual(before);
    await expect(importIofXml(db, raceId, conflictingXml)).rejects.toThrow();
    expect(await state(raceId)).toEqual(before);
    await importIofXml(db, raceId, entryXml);
    expect(await state(raceId)).toEqual(before);
    const matching = entryXml.replace("<Given>Bo</Given>", "<Given>Alva</Given>").replace("<Family>Skog</Family>", "<Family>Rättad</Family>")
      .replace(/(<PersonEntry>\s*<Id>entry-bo<\/Id>[\s\S]*?<Organisation><Name>)Centrum OK/, "$1Ny OK");
    await expect(importIofXml(db, raceId, matching.replace("<Organisation><Name>Ny OK</Name></Organisation>", ""))).rejects.toThrow();
    expect(await state(raceId)).toEqual(before);
    await importIofXml(db, raceId, matching);
    const listed = await listEntryIdentitiesAsAdmin(db, authentication, now);
    if (listed.status !== "ok") throw new Error("Namnunderlag saknas efter import");
    expect(listed.response.entries.find((entry) => entry.id === bo.id)?.identity).toEqual(input.request.identity);
  });
});
