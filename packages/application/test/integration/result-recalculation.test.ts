import { describe, expect, it } from "vitest";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  changeEntryClass, importIofXml, ingestDeviceBatch, listResultRecalculationCandidatesAsAdmin,
  recalculateEntryAsAdmin
} from "../../src";
import {
  authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin,
  logoutPairingAdminSession, revokePairingAdminAccessCredential
} from "../../src/pairing-admin";
import { db, courseXml, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 005I autentiserad explicit resultatomräkning PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T20:00:00.000Z");
  const usedAt = new Date("2026-08-31T20:02:00.000Z");

  async function recalculationAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "RECALCULATE_RESULT",
      label: `Resultatomräknare ${marker}`,
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000)
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "RECALCULATE_RESULT",
      now: new Date("2026-08-31T20:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Omräkningssession kunde inte skapas");
    return { installation, login };
  }

  async function readyFixture(marker: number) {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await recalculationAdmin(raceId, marker);
    const listed = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId
    }, usedAt);
    if (listed.status !== "ok") throw new Error("Omräkningskandidater kunde inte läsas");
    const candidate = listed.response.entries.find((entry) => entry.displayName === "Ada Löpare");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!candidate || candidate.readiness !== "READY" || !candidate.cardAssignmentId ||
      !candidate.latestReadout || !candidate.latestResultRevision || !d21) {
      throw new Error("Fixture saknar en komplett omräkningskandidat");
    }
    const readyCandidate = {
      ...candidate,
      cardAssignmentId: candidate.cardAssignmentId,
      latestReadout: candidate.latestReadout,
      latestResultRevision: candidate.latestResultRevision
    };
    return { raceId, overview, admin, candidate: readyCandidate, d21, response: listed.response };
  }

  function recalculationInput(
    fixture: Awaited<ReturnType<typeof readyFixture>>,
    requestId = crypto.randomUUID(),
    admin = fixture.admin
  ) {
    return {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken,
      entryId: fixture.candidate.id,
      idempotencyKey: `result-recalculation:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: fixture.candidate.entryVersion,
        expectedClassId: fixture.candidate.classId,
        expectedSnapshotVersion: fixture.response.snapshotVersion,
        expectedCardAssignmentId: fixture.candidate.cardAssignmentId,
        expectedReadoutId: fixture.candidate.latestReadout.id,
        expectedLatestResultRevision: {
          id: fixture.candidate.latestResultRevision.id,
          revision: fixture.candidate.latestResultRevision.revision
        },
        expectedEngineVersion: fixture.response.engineVersion
      }
    };
  }

  it("separerar capability/prefix/livslängd och lämnar endast säkra readiness-kandidater", async () => {
    const fixture = await readyFixture(291);
    expect(fixture.admin.installation.accessCredential).toMatch(/^otid_org_result_recalc_v1\./);
    expect(fixture.admin.login.response).toEqual({
      formatVersion: 1,
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      expiresAt: "2026-08-31T21:01:00.000Z"
    });
    const issueAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, fixture.admin.installation.credentialId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATION_ACCESS_CREDENTIAL_ISSUED")
    ));
    expect(issueAudits).toHaveLength(1);
    expect(issueAudits[0]?.entityType).toBe("result_recalculation_access_credential");
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      label: "För lång",
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000 + 1)
    }, { now: issuedAt })).rejects.toThrow(/högst 8 timmar/);

    expect(fixture.candidate.readiness).toBe("READY");
    expect(typeof fixture.candidate.latestReadout.id).toBe("string");
    expect(typeof fixture.candidate.latestReadout.readAt).toBe("string");
    expect(fixture.candidate.latestResultRevision).toMatchObject({
      revision: 1,
      cause: "CARD_READOUT"
    });
    const bo = fixture.response.entries.find((entry) => entry.displayName === "Bo Skog");
    expect(bo?.readiness).toBe("NO_READOUT");
    expect(typeof bo?.cardAssignmentId).toBe("string");
    expect(bo?.latestReadout).toBeNull();
    expect(bo?.latestResultRevision).toBeNull();
    const candidateJson = JSON.stringify(fixture.response);
    for (const forbidden of ["cardNumber", "punches", "evaluation", "rawPayload", "accessCredential"]) {
      expect(candidateJson).not.toContain(forbidden);
    }

    await db.update(schema.cardAssignments).set({ active: false })
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const noAssignment = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (noAssignment.status !== "ok") throw new Error("Kandidatlistning misslyckades");
    expect(noAssignment.response.entries.find((entry) => entry.id === fixture.candidate.id)).toMatchObject({
      readiness: "NO_ACTIVE_ASSIGNMENT",
      cardAssignmentId: null,
      latestReadout: null
    });
    await db.update(schema.cardAssignments).set({ active: true })
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    await db.insert(schema.cardAssignments).values({
      raceId: fixture.raceId,
      entryId: fixture.candidate.id,
      cardNumber: `extra-${crypto.randomUUID()}`,
      active: true
    });
    const multipleAssignments = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (multipleAssignments.status !== "ok") throw new Error("Kandidatlistning misslyckades");
    expect(multipleAssignments.response.entries.find((entry) => entry.id === fixture.candidate.id)).toMatchObject({
      readiness: "MULTIPLE_ACTIVE_ASSIGNMENTS",
      cardAssignmentId: null,
      latestReadout: null
    });
  });

  it("committar 100 samtidiga exact retries en gång utan att mutera inputstate", async () => {
    const fixture = await readyFixture(301);
    const requestId = crypto.randomUUID();
    const input = recalculationInput(fixture, requestId);
    const [entryBefore] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.candidate.id));
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const [assignmentBefore] = await db.select().from(schema.cardAssignments)
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const [readoutBefore] = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.id, fixture.candidate.latestReadout.id));
    const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId));
    const results = await Promise.all(Array.from(
      { length: 100 },
      () => recalculateEntryAsAdmin(db, input, usedAt)
    ));
    expect(results.filter((result) => result.status === "recalculated")).toHaveLength(100);
    expect(results.filter((result) => result.status === "recalculated" && !result.response.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.status === "recalculated" && result.response.replayed)).toHaveLength(99);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id)).orderBy(desc(schema.resultRevisions.revision));
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATED_BY_ADMIN")
    ));
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      revision: 2,
      cause: "EXPLICIT_RECALCULATION",
      published: true,
      readoutId: fixture.candidate.latestReadout.id,
      snapshotVersion: fixture.response.snapshotVersion
    });
    expect(requests).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "result_revision",
      entityId: revisions[0]?.id,
      actorKind: "RESULT_RECALCULATION_ACCESS_CREDENTIAL",
      actorId: fixture.admin.installation.credentialId,
      requestId
    });
    const [entryAfter] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.candidate.id));
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const [assignmentAfter] = await db.select().from(schema.cardAssignments)
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const [readoutAfter] = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.id, fixture.candidate.latestReadout.id));
    const rawAfter = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId));
    expect(entryAfter).toEqual(entryBefore);
    expect(raceAfter).toEqual(raceBefore);
    expect(assignmentAfter).toEqual(assignmentBefore);
    expect(readoutAfter).toEqual(readoutBefore);
    expect(rawAfter).toEqual(rawBefore);
    const auditJson = JSON.stringify(audits);
    for (const forbidden of [
      "Ada", "Löpare", "Centrum OK", "12345", "punches", "evaluation",
      fixture.admin.installation.accessCredential, fixture.admin.login.sessionToken, fixture.admin.login.csrfToken
    ]) expect(auditJson).not.toContain(forbidden);
    await expect(db.update(schema.resultRecalculationRequests).set({ expectedEntryVersion: 999 })
      .where(eq(schema.resultRecalculationRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.delete(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.update(schema.resultRevisions).set({ published: false })
      .where(eq(schema.resultRevisions.id, revisions[0]?.id ?? crypto.randomUUID()))).rejects.toThrow();
  });

  it("avvisar stale värde för vart och ett av de frysta intentfälten utan write", async () => {
    const fixture = await readyFixture(311);
    const base = recalculationInput(fixture);
    const current = base.request;
    const staleRequests = [
      { ...current, expectedEntryVersion: current.expectedEntryVersion + 1 },
      { ...current, expectedClassId: fixture.d21.id },
      { ...current, expectedSnapshotVersion: current.expectedSnapshotVersion + 1 },
      { ...current, expectedCardAssignmentId: crypto.randomUUID() },
      { ...current, expectedReadoutId: crypto.randomUUID() },
      { ...current, expectedLatestResultRevision: null },
      { ...current, expectedLatestResultRevision: {
        id: crypto.randomUUID(), revision: current.expectedLatestResultRevision.revision
      } },
      { ...current, expectedLatestResultRevision: {
        id: current.expectedLatestResultRevision.id,
        revision: current.expectedLatestResultRevision.revision + 1
      } },
      { ...current, expectedEngineVersion: `${current.expectedEngineVersion}-stale` }
    ];
    const [beforeRevisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    for (const request of staleRequests) {
      await expect(recalculateEntryAsAdmin(db, {
        ...base,
        idempotencyKey: `result-recalculation:${crypto.randomUUID()}`,
        request
      }, usedAt)).resolves.toEqual({ status: "conflict" });
    }
    const [afterRevisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATED_BY_ADMIN")
    ));
    expect(afterRevisionCount?.value).toBe(beforeRevisionCount?.value);
    expect(requests).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("ger en vinnare för två request-id och replayar originalet efter senare domänhändelser", async () => {
    const fixture = await readyFixture(321);
    const firstInput = recalculationInput(fixture, crypto.randomUUID());
    const secondInput = recalculationInput(fixture, crypto.randomUUID());
    const initialResults = await Promise.all([
      recalculateEntryAsAdmin(db, firstInput, usedAt),
      recalculateEntryAsAdmin(db, secondInput, usedAt)
    ]);
    expect(initialResults.filter((result) => result.status === "recalculated")).toHaveLength(1);
    expect(initialResults.filter((result) => result.status === "conflict")).toHaveLength(1);
    const winningIndex = initialResults.findIndex((result) => result.status === "recalculated");
    const winningResult = initialResults[winningIndex];
    const winningInput = winningIndex === 0 ? firstInput : secondInput;
    if (!winningResult || winningResult.status !== "recalculated") throw new Error("Omräkningsvinnare saknas");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }, { stationReceivedAt: "2026-08-30T11:00:00Z" }));
    await changeEntryClass(db, fixture.raceId, fixture.candidate.id, fixture.d21.id);
    const replay = await recalculateEntryAsAdmin(db, winningInput, new Date(usedAt.getTime() + 1));
    expect(replay).toEqual({
      status: "recalculated",
      response: { ...winningResult.response, replayed: true }
    });
    const winningRequest = winningInput.request;
    const changedReplayRequests = [
      { ...winningRequest, expectedEntryVersion: winningRequest.expectedEntryVersion + 1 },
      { ...winningRequest, expectedClassId: crypto.randomUUID() },
      { ...winningRequest, expectedSnapshotVersion: winningRequest.expectedSnapshotVersion + 1 },
      { ...winningRequest, expectedCardAssignmentId: crypto.randomUUID() },
      { ...winningRequest, expectedReadoutId: crypto.randomUUID() },
      { ...winningRequest, expectedLatestResultRevision: null },
      { ...winningRequest, expectedLatestResultRevision: {
        id: crypto.randomUUID(), revision: winningRequest.expectedLatestResultRevision.revision
      } },
      { ...winningRequest, expectedLatestResultRevision: {
        id: winningRequest.expectedLatestResultRevision.id,
        revision: winningRequest.expectedLatestResultRevision.revision + 1
      } },
      { ...winningRequest, expectedEngineVersion: `${winningRequest.expectedEngineVersion}-changed` }
    ];
    for (const request of changedReplayRequests) {
      await expect(recalculateEntryAsAdmin(db, {
        ...winningInput,
        request
      }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });
    }
    await expect(recalculateEntryAsAdmin(db, {
      ...winningInput,
      entryId: crypto.randomUUID()
    }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });

    const otherActor = await recalculationAdmin(fixture.raceId, 331);
    await expect(recalculateEntryAsAdmin(db, {
      ...winningInput,
      sessionToken: otherActor.login.sessionToken,
      csrfCookie: otherActor.login.csrfToken,
      csrfHeader: otherActor.login.csrfToken
    }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["ingen aktiv assignment", 332, "none"],
    ["flera aktiva assignments", 333, "multiple"],
    ["saknad readout", 334, "missing-readout"]
  ] as const)("avvisar %s utan resultatskrivning", async (_label, marker, condition) => {
    const fixture = await readyFixture(marker);
    const input = recalculationInput(fixture);
    if (condition === "none") {
      await db.update(schema.cardAssignments).set({ active: false })
        .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    } else if (condition === "multiple") {
      await db.insert(schema.cardAssignments).values({
        raceId: fixture.raceId,
        entryId: fixture.candidate.id,
        cardNumber: `extra-${crypto.randomUUID()}`,
        active: true
      });
    } else {
      await db.update(schema.cardAssignments).set({ active: false })
        .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
      const [assignment] = await db.insert(schema.cardAssignments).values({
        raceId: fixture.raceId,
        entryId: fixture.candidate.id,
        cardNumber: `missing-${crypto.randomUUID()}`,
        active: true
      }).returning({ id: schema.cardAssignments.id });
      if (!assignment) throw new Error("Testassignment kunde inte skapas");
      input.request = {
        ...input.request,
        expectedCardAssignmentId: assignment.id,
        expectedReadoutId: crypto.randomUUID()
      };
    }
    const [before] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    await expect(recalculateEntryAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "conflict" });
    const [after] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    expect(after?.value).toBe(before?.value);
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(0);
  });

  it("stoppar omräkning efter capability-säker logout och revocation", async () => {
    const fixture = await readyFixture(341);
    const input = recalculationInput(fixture);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      csrfCookie: fixture.admin.login.csrfToken,
      csrfHeader: fixture.admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      csrfCookie: fixture.admin.login.csrfToken,
      csrfHeader: fixture.admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(recalculateEntryAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revokedFixture = await readyFixture(351);
    const revokedInput = recalculationInput(revokedFixture);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revokedFixture.admin.installation.credentialId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revokedFixture.admin.installation.credentialId,
      capability: "RECALCULATE_RESULT"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(recalculateEntryAsAdmin(db, revokedInput, usedAt)).resolves.toEqual({ status: "unauthorized" });
    const revokeAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, revokedFixture.admin.installation.credentialId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATION_ACCESS_CREDENTIAL_REVOKED")
    ));
    expect(revokeAudits).toHaveLength(1);
    expect(revokeAudits[0]?.entityType).toBe("result_recalculation_access_credential");
  });

  it("serialiserar samtidig ingest till obrutna revisioner eller stale konflikt", async () => {
    const fixture = await readyFixture(361);
    const input = recalculationInput(fixture);
    const [recalculation, ingest] = await Promise.all([
      recalculateEntryAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:46:00Z"
      }, { stationReceivedAt: "2026-08-30T11:01:00Z" }))
    ]);
    expect(["recalculated", "conflict"]).toContain(recalculation.status);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(Array.from({ length: revisions.length }, (_, index) => index + 1));
    expect(revisions).toHaveLength(recalculation.status === "recalculated" ? 3 : 2);
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(recalculation.status === "recalculated" ? 1 : 0);
  });

  it.each(["class", "import"] as const)(
    "serialiserar samtidig %s-mutation till hel snapshot eller stale konflikt",
    async (mutation) => {
      const fixture = await readyFixture(mutation === "class" ? 371 : 381);
      const input = recalculationInput(fixture);
      const mutate = mutation === "class"
        ? () => changeEntryClass(db, fixture.raceId, fixture.candidate.id, fixture.d21.id)
        : () => importIofXml(db, fixture.raceId, courseXml.replace(
          "</CourseData>",
          `<!-- concurrency-${crypto.randomUUID()} --></CourseData>`
        ));
      const [recalculation] = await Promise.all([
        recalculateEntryAsAdmin(db, input, usedAt),
        mutate()
      ]);
      expect(["recalculated", "conflict"]).toContain(recalculation.status);
      const requests = await db.select().from(schema.resultRecalculationRequests)
        .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
      expect(requests).toHaveLength(recalculation.status === "recalculated" ? 1 : 0);
      if (recalculation.status === "recalculated") {
        expect(recalculation.response.snapshotVersion).toBe(fixture.response.snapshotVersion);
      }
    }
  );
});
