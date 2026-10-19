import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { count, desc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  changeEntryClass, contentHash, ingestDeviceBatch, exportIofResultListAsAdmin, publicResults, recalculateEntry
} from "../../src";
import { db, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";
import { raceLogin, revokeRaceGrants } from "./accounts";

useRaceDatabase();

describe("TASK 006B capability-skyddad IOF ResultList-export PostgreSQL", () => {
  const usedAt = new Date("2026-08-31T22:02:00.000Z");

  async function exportAdmin(raceId: string) {
    const login = await raceLogin(db, raceId, "ADMIN", new Date("2026-08-31T22:01:00.000Z"));
    return { login };
  }

  async function exportFootprint(raceId: string) {
    const [audits, raw, readouts, outcomes, revisions, imports] = await Promise.all([
      db.select({ value: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)),
      db.select({ value: count() }).from(schema.deviceIngestOutcomes)
        .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
        .where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)),
      db.select({ value: count() }).from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId))
    ]);
    return [audits[0]?.value, raw[0]?.value, readouts[0]?.value, outcomes[0]?.value,
      revisions[0]?.value, imports[0]?.value];
  }

  it("exporterar senaste publicerade historiska projektion deterministiskt utan writes", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber);
    const h21 = fixture.overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = fixture.overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada eller klasser");

    await changeEntryClass(db, fixture.raceId, ada.id, d21.id);
    const historical = await recalculateEntry(db, fixture.raceId, ada.id);
    if (!historical) throw new Error("Historisk resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId: historical.raceId,
      entryId: historical.entryId,
      readoutId: historical.readoutId,
      revision: historical.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: historical.status,
      reason: historical.reason,
      evaluation: historical.evaluation,
      engineVersion: historical.engineVersion,
      snapshotVersion: historical.snapshotVersion,
      courseVersionId: historical.courseVersionId,
      published: false
    });
    await changeEntryClass(db, fixture.raceId, ada.id, h21.id);
    const [currentRace] = await db.select({ snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, fixture.raceId));
    if (!currentRace) throw new Error("Loppet saknas");
    const admin = await exportAdmin(fixture.raceId);

    const before = await exportFootprint(fixture.raceId);
    const exports = await Promise.all(Array.from({ length: 100 }, () => exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)));
    expect(exports.every((result) => result.status === "ok")).toBe(true);
    expect(await exportFootprint(fixture.raceId)).toEqual(before);
    const first = exports[0];
    if (!first || first.status !== "ok") throw new Error("Resultatexporten saknas");
    expect(first.metadata).toMatchObject({
      formatVersion: 1,
      raceId: fixture.raceId,
      snapshotVersion: currentRace.snapshotVersion,
      classCount: 1,
      resultCount: 1,
      staleResultCount: 1,
      omittedEntryCount: 1
    });
    expect(first.metadata.sha256).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    expect(new Set(exports.map((result) => result.status === "ok" ? result.metadata.sha256 : "fel"))).toEqual(
      new Set([first.metadata.sha256])
    );
    const xml = new TextDecoder().decode(first.bytes);
    expect(xml).toContain("class-d21");
    expect(xml).toContain("entry-ada");
    expect(xml).toContain("Ada");
    expect(xml).not.toContain("class-h21");
    // PLAN.md steg 25: arbetsytans export bär brickan (ControlCard), men aldrig interna id:n eller sessionen.
    expect(xml).toContain(`<ControlCard punchingSystem="SI">${okPayload.cardNumber}</ControlCard>`);
    for (const secret of [fixture.raceId, ada.id, d21.id, historical.id,
      admin.login.sessionToken]) {
      expect(xml).not.toContain(secret);
    }
  }, 30_000);

  it("visar endast helt före- eller efterläge när en tvåresultatsingest pågår samtidigt", async () => {
    const fixture = await importedRace();
    const admin = await exportAdmin(fixture.raceId);
    const exportOnce = () => exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    const before = await exportOnce();
    expect(before.status === "ok" && before.metadata).toMatchObject({
      resultCount: 0,
      omittedEntryCount: 2
    });

    const boPayload = {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:41:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    const firstWave = Array.from({ length: 50 }, exportOnce);
    const ingest = ingestDeviceBatch(db, fixture.raceId, {
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
    const secondWave = Array.from({ length: 50 }, exportOnce);
    const [firstResults, , secondResults] = await Promise.all([
      Promise.all(firstWave),
      ingest,
      Promise.all(secondWave)
    ]);
    const concurrentExports = [...firstResults, ...secondResults];
    expect(concurrentExports.every((result) => result.status === "ok")).toBe(true);
    for (const result of concurrentExports) {
      if (result.status !== "ok") continue;
      expect([0, 2]).toContain(result.metadata.resultCount);
      expect(result.metadata.omittedEntryCount).toBe(2 - result.metadata.resultCount);
    }
    const after = await exportOnce();
    expect(after.status === "ok" && after.metadata).toMatchObject({
      resultCount: 2,
      omittedEntryCount: 0
    });
    if (after.status !== "ok") throw new Error("Resultatexporten saknas");
    const xml = new TextDecoder().decode(after.bytes);
    expect(xml.match(/<Position>1<\/Position>/g)).toHaveLength(2);
    expect(xml.match(/<TimeBehind>0<\/TimeBehind>/g)).toHaveLength(2);
    expect(xml.indexOf("<TimeBehind>0</TimeBehind>")).toBeLessThan(xml.indexOf("<Position>1</Position>"));
    expect(xml.indexOf("<Position>1</Position>")).toBeLessThan(xml.indexOf("<Status>OK</Status>"));
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toHaveLength(2);
    expect(publicResponse.results.map((result) => ({
      position: "position" in result ? result.position : undefined,
      timeBehindMs: "timeBehindMs" in result ? result.timeBehindMs : undefined,
      rankingState: result.rankingState
    }))).toEqual([
      { position: 1, timeBehindMs: 0, rankingState: "RANKED" },
      { position: 1, timeBehindMs: 0, rankingState: "RANKED" }
    ]);
    expect(JSON.stringify(publicResponse)).not.toMatch(/entryId|courseVersionId|evaluation|resultRevisionId/);
  }, 30_000);

  it("undertrycker ranking i publik DTO och IOF när OK-resultat använder blandade historiska banversioner", async () => {
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
    const h21 = fixture.overview.classes.find((raceClass) => raceClass.name === "H21");
    const bo = fixture.overview.entries.find((entry) => entry.cardNumber === "67890");
    if (!h21 || !bo) throw new Error("Fixture saknar H21 eller Bo");
    const [currentVersion] = await db.select().from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, h21.courseVersionId));
    const [latestBo] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, bo.id))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!currentVersion || !latestBo || latestBo.evaluation.status !== "OK") {
      throw new Error("Historiskt OK-resultat eller banversion saknas");
    }
    const [secondVersion] = await db.insert(schema.courseVersions).values({
      courseId: currentVersion.courseId,
      version: currentVersion.version + 1
    }).returning();
    if (!secondVersion) throw new Error("Ny historisk banversion saknas");
    const historicalControls = await db.select({
      controlId: schema.courseControls.controlId,
      sequence: schema.courseControls.sequence
    }).from(schema.courseControls)
      .where(eq(schema.courseControls.courseVersionId, currentVersion.id));
    await db.insert(schema.courseControls).values(historicalControls.map((control) => ({
      courseVersionId: secondVersion.id,
      controlId: control.controlId,
      sequence: control.sequence
    })));
    await db.insert(schema.resultRevisions).values({
      raceId: latestBo.raceId,
      entryId: latestBo.entryId,
      readoutId: latestBo.readoutId,
      revision: latestBo.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: latestBo.status,
      reason: latestBo.reason,
      evaluation: { ...latestBo.evaluation, courseVersionId: secondVersion.id },
      engineVersion: latestBo.engineVersion,
      snapshotVersion: latestBo.snapshotVersion,
      courseVersionId: secondVersion.id,
      published: true
    });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results.map((result) => result.rankingState)).toEqual([
      "MIXED_COURSE_VERSIONS",
      "MIXED_COURSE_VERSIONS"
    ]);
    expect(publicResponse.results.every((result) =>
      !("position" in result) && !("timeBehindMs" in result))).toBe(true);
    const admin = await exportAdmin(fixture.raceId);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Resultatexporten saknas");
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).not.toContain("<Position>");
    expect(xml).not.toContain("<TimeBehind>");
    expect(xml.match(/<Status>OK<\/Status>/g)).toHaveLength(2);
  });

  it("isolerar capability och race, stoppar revocation och avvisar flerloppsevent", async () => {
    const fixture = await importedRace();
    const other = await importedRace();
    const admin = await exportAdmin(fixture.raceId);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: other.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const overviewLogin = await raceLogin(db, fixture.raceId, "FUNCTIONARY", new Date("2026-08-31T22:01:00.000Z"));
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: overviewLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    await revokeRaceGrants(db, admin.login.accountId, usedAt);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const multi = await importedRace();
    const [multiRace] = await db.select().from(schema.races).where(eq(schema.races.id, multi.raceId));
    if (!multiRace) throw new Error("Flerloppsfixture saknas");
    await db.insert(schema.races).values({
      eventId: multiRace.eventId,
      name: "Etapp 2",
      raceDate: multiRace.raceDate
    });
    const multiAdmin = await exportAdmin(multi.raceId);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: multiAdmin.login.sessionToken,
      raceId: multi.raceId
    }, usedAt)).resolves.toEqual({ status: "conflict" });
  });
});
