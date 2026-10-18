import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  contentHash, ingestDeviceBatch, exportIofResultListAsAdmin, exportFrozenIofResultListAsAdmin,
  finalizeResultsAsAdmin, listFrozenRaceFinalizationsAsAdmin, listResultFinalizationCandidatesAsAdmin
} from "../../src";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 006D immutable individuell resultatfinalisering PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T23:00:00.000Z");
  const usedAt = new Date("2026-08-31T23:02:00.000Z");

  async function finalizationAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "FINALIZE_RESULTS",
      label: `Finalisering ${marker}`,
      expiresAt: new Date("2026-09-01T07:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-08-31T23:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Finaliseringssession kunde inte skapas");
    return { installation, login };
  }

  async function finalExportAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: `Slutexport ${marker}`,
      expiresAt: new Date("2026-09-01T07:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST",
      now: new Date("2026-08-31T23:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Slutexportsession kunde inte skapas");
    return { installation, login };
  }

  async function fullyReadRace() {
    const fixture = await importedRace();
    const boPayload = {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(db, fixture.raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 2,
      events: [okPayload, boPayload].map((payload, index) => ({
        localSequence: index + 1,
        stationReceivedAt: `2026-08-30T10:4${index + 1}:00Z`,
        transport: "simulator" as const,
        payload,
        contentHash: contentHash(payload)
      }))
    });
    return fixture;
  }

  it("fryser klass och lopp exakt idempotent och behåller gamla Complete-bytes efter senare ändring", async () => {
    const fixture = await fullyReadRace();
    const admin = await finalizationAdmin(fixture.raceId, 31);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    const initial = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (initial.status !== "ok") throw new Error("Finaliseringskandidaten saknas");
    const readyClass = initial.response.classes.find((candidate) => candidate.entryCount > 0);
    const emptyClass = initial.response.classes.find((candidate) => candidate.entryCount === 0);
    if (!readyClass) throw new Error("Icke-tom klass saknas");
    expect(readyClass.blockerCodes).toEqual([]);
    expect(emptyClass?.blockerCodes).toEqual(["EMPTY_CLASS"]);
    expect(JSON.stringify(initial.response)).not.toMatch(/\b(?:Ada|Bo|12345|67890|punch|evaluation)\b/i);

    const classRequestId = crypto.randomUUID();
    const classFinalizationId = crypto.randomUUID();
    const classRequest = {
      formatVersion: 1 as const,
      scope: "CLASS" as const,
      classId: readyClass.classId,
      expectedSnapshotVersion: initial.response.snapshotVersion,
      expectedBasisHash: readyClass.basisHash,
      expectedLatestScopeRevision: null
    };
    const classResults = await Promise.all(Array.from({ length: 100 }, () => finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: usedAt, finalizationId: classFinalizationId })));
    expect(classResults.every((result) => result.status === "finalized")).toBe(true);
    expect(classResults.filter((result) => result.status === "finalized" && !result.response.replayed)).toHaveLength(1);
    expect(classResults.filter((result) => result.status === "finalized" && result.response.replayed)).toHaveLength(99);

    expect(await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: { ...classRequest, expectedBasisHash: "f".repeat(64) }
    }, { now: usedAt })).toEqual({ status: "conflict" });
    const otherActor = await finalizationAdmin(fixture.raceId, 61);
    expect(await finalizeResultsAsAdmin(db, {
      sessionToken: otherActor.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: otherActor.login.csrfToken,
      csrfHeader: otherActor.login.csrfToken,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: usedAt })).toEqual({ status: "conflict" });

    const afterFirstClass = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (afterFirstClass.status !== "ok") throw new Error("Andra klasskandidaten saknas");
    expect(afterFirstClass.response.race.blockerCodes).toEqual([]);
    const currentClass = afterFirstClass.response.classes.find((candidate) => candidate.classId === readyClass.classId);
    if (!currentClass) throw new Error("Aktuell klasskandidat saknas");
    const secondClass = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        ...classRequest,
        expectedBasisHash: currentClass.basisHash,
        expectedLatestScopeRevision: 1
      }
    }, { now: new Date(usedAt.getTime() + 1) });
    expect(secondClass.status === "finalized" && secondClass.response.finalization.scopeRevision).toBe(2);

    const afterClass = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (afterClass.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(afterClass.response.race.blockerCodes).toEqual([]);
    const raceRequestId = crypto.randomUUID();
    const raceFinalizationId = crypto.randomUUID();
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${raceRequestId}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: afterClass.response.snapshotVersion,
        expectedBasisHash: afterClass.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt, finalizationId: raceFinalizationId });
    if (raceResult.status !== "finalized" || raceResult.response.finalization.scope !== "RACE") {
      throw new Error("Loppsfinaliseringen saknas");
    }
    expect(raceResult.response.finalization).toMatchObject({
      id: raceFinalizationId,
      entryCount: 2,
      classCount: 1,
      scopeRevision: 1
    });

    const exporter = await finalExportAdmin(fixture.raceId, 41);
    const exportAuth = { sessionToken: exporter.login.sessionToken, raceId: fixture.raceId };
    const listed = await listFrozenRaceFinalizationsAsAdmin(db, exportAuth, usedAt);
    expect(listed.status === "ok" && listed.response.finalizations).toHaveLength(1);
    const frozenExports = await Promise.all(Array.from({ length: 100 }, () =>
      exportFrozenIofResultListAsAdmin(db, {
        ...exportAuth,
        finalizationId: raceFinalizationId
      }, usedAt)
    ));
    expect(frozenExports.every((result) => result.status === "ok")).toBe(true);
    const first = frozenExports[0];
    if (!first || first.status !== "ok") throw new Error("Fryst export saknas");
    const originalBytes = Buffer.from(first.bytes);
    const originalXml = originalBytes.toString("utf8");
    expect(originalXml).toContain('status="Complete"');
    expect(originalXml.match(/<PersonResult>/g)).toHaveLength(2);
    expect(first.finalization.completeXmlSha256).toBe(createHash("sha256").update(originalBytes).digest("hex"));
    expect(new Set(frozenExports.map((result) => result.status === "ok"
      ? createHash("sha256").update(result.bytes).digest("hex") : "fel"))).toEqual(
      new Set([first.finalization.completeXmlSha256])
    );

    const live = await exportIofResultListAsAdmin(db, exportAuth, usedAt);
    if (live.status !== "ok") throw new Error("Liveexport saknas");
    expect(new TextDecoder().decode(live.bytes)).toContain('status="Snapshot"');

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.raceId, fixture.raceId)).limit(1);
    const [control] = await db.select().from(schema.controls).where(eq(schema.controls.raceId, fixture.raceId)).limit(1);
    if (!entry || !control) throw new Error("Display- eller kontrolldata saknas");
    await db.update(schema.entries).set({ givenName: "Ändrat namn" }).where(eq(schema.entries.id, entry.id));
    await db.update(schema.controls).set({ code: control.code + 1000 }).where(eq(schema.controls.id, control.id));
    const afterMutation = await exportFrozenIofResultListAsAdmin(db, {
      ...exportAuth,
      finalizationId: raceFinalizationId
    }, usedAt);
    expect(afterMutation.status === "ok" && Buffer.from(afterMutation.bytes)).toEqual(originalBytes);

    const staleCandidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (staleCandidate.status !== "ok") throw new Error("Stale kandidat saknas");
    expect(staleCandidate.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");

    const historicalReplay = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: new Date(usedAt.getTime() + 10_000) });
    expect(historicalReplay.status === "finalized" && historicalReplay.response).toMatchObject({
      replayed: true,
      finalization: { id: classFinalizationId, scopeRevision: 1, basisHash: classRequest.expectedBasisHash }
    });

    const rows = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.raceId, fixture.raceId));
    expect(rows).toHaveLength(3);
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      sql`${schema.auditEvents.action} in ('RESULT_CLASS_FINALIZED', 'RESULT_RACE_FINALIZED')`
    ));
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toMatch(/\b(?:Ada|Bo|12345|67890)\b/);
    await expect(db.update(schema.resultFinalizations).set({ sourceHash: "f".repeat(64) })
      .where(eq(schema.resultFinalizations.id, classFinalizationId))).rejects.toThrow();
    await expect(db.delete(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, classFinalizationId))).rejects.toThrow();
  }, 45_000);

  it("blockerar ofullständig, opublicerad och olöst okänd grund utan finaliseringswrite", async () => {
    const fixture = await importedRace();
    const admin = await finalizationAdmin(fixture.raceId, 51);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "999999",
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }));
    const [latest] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId)).orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!latest) throw new Error("Resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId: latest.raceId,
      entryId: latest.entryId,
      readoutId: latest.readoutId,
      revision: latest.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: latest.status,
      reason: latest.reason,
      evaluation: latest.evaluation,
      engineVersion: latest.engineVersion,
      snapshotVersion: latest.snapshotVersion,
      courseVersionId: latest.courseVersionId,
      published: false
    });

    const candidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (candidate.status !== "ok") throw new Error("Blockerad kandidat saknas");
    const nonEmpty = candidate.response.classes.find((item) => item.entryCount > 0);
    if (!nonEmpty) throw new Error("Icke-tom klass saknas");
    expect(nonEmpty.blockerCodes).toEqual(expect.arrayContaining([
      "MISSING_RESULT_REVISION",
      "LATEST_RESULT_UNPUBLISHED"
    ]));
    expect(candidate.response.race.blockerCodes).toEqual(expect.arrayContaining([
      "UNKNOWN_CARD_UNRESOLVED",
      "MISSING_CLASS_FINALIZATION"
    ]));

    const result = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: nonEmpty.classId,
        expectedSnapshotVersion: candidate.response.snapshotVersion,
        expectedBasisHash: nonEmpty.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(result).toEqual({ status: "conflict" });
    const stored = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.raceId, fixture.raceId));
    expect(stored).toHaveLength(0);
  });

  it("serialiserar samtidig loppsfinalisering och sen okänd ingest till ett helt före- eller efterläge", async () => {
    const fixture = await fullyReadRace();
    const admin = await finalizationAdmin(fixture.raceId, 71);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    const initial = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (initial.status !== "ok") throw new Error("Finaliseringskandidaten saknas");
    const classCandidate = initial.response.classes.find((candidate) => candidate.entryCount > 0);
    if (!classCandidate) throw new Error("Klasskandidaten saknas");
    const classResult = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: classCandidate.classId,
        expectedSnapshotVersion: initial.response.snapshotVersion,
        expectedBasisHash: classCandidate.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));

    const unknownPayload = {
      ...okPayload,
      cardNumber: "999998",
      finishPunchedAt: "2026-08-30T10:55:00Z"
    };
    const [finalization, ingest] = await Promise.all([
      finalizeResultsAsAdmin(db, {
        ...auth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "RACE",
          classId: null,
          expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
          expectedBasisHash: raceCandidate.response.race.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt }),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), unknownPayload))
    ]);
    const unknownAcknowledgement = ingest.acknowledgements[0];
    if (!unknownAcknowledgement || unknownAcknowledgement.status !== "stored") {
      throw new Error("Samtidig okänd avläsning lagrades inte");
    }
    expect(unknownAcknowledgement.serverResult).toMatchObject({ status: "UNKNOWN_CARD" });
    expect(["finalized", "conflict"]).toContain(finalization.status);

    const finalRows = await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "RACE")
    ));
    expect(finalRows).toHaveLength(finalization.status === "finalized" ? 1 : 0);
    if (finalization.status === "finalized") {
      expect(finalRows[0]?.completeXml).toContain('status="Complete"');
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (after.status !== "ok") throw new Error("Kandidaten efter ingest saknas");
    expect(after.response.race.blockerCodes).toContain("UNKNOWN_CARD_UNRESOLVED");
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
  });
});
