import { describe, expect, it } from "vitest";
import { count, desc, eq } from "drizzle-orm";
import { evaluationResultSchema } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import {
  changeEntryClass, contentHash, importIofXml, ingestDeviceBatch, evaluationHash, publicResults,
  recalculateEntry
} from "../../src";
import { db, courseXml, entryXml, importedRace, trustedRaceFixtureOverview, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 001 PostgreSQL", () => {
  it("lagrar samma batch 100 gånger som exakt en råpost", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    for (let attempt = 0; attempt < 100; attempt += 1) await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value }).toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("klassändring och explicit omräkning skapar en ny revision", async () => {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !d21) throw new Error("Fixture saknar Ada eller D21");
    const beforeChange = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, ada.id));
    expect(beforeChange).toHaveLength(1);
    await changeEntryClass(db, raceId, ada.id, d21.id);
    const beforeExplicitRecalculation = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id));
    expect(beforeExplicitRecalculation).toHaveLength(1);
    await recalculateEntry(db, raceId, ada.id);
    const history = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, ada.id));
    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId));
    expect(history.map((revision) => revision.revision).sort()).toEqual([1, 2]);
    expect(audits.some((audit) => audit.action === "CLASS_CHANGED")).toBe(true);
    expect(audits.some((audit) => audit.action === "RESULT_RECALCULATED")).toBe(true);
  });

  it("ogiltig XML lämnar loppet oförändrat", async () => {
    const { raceId } = await importedRace();
    const before = await trustedRaceFixtureOverview(raceId);
    await expect(importIofXml(db, raceId, "<EntryList iofVersion=\"3.0\"><broken>")).rejects.toThrow();
    const after = await trustedRaceFixtureOverview(raceId);
    expect({ classes: after.classes.length, courses: after.courses.length, entries: after.entries.length, imports: after.imports.length })
      .toEqual({ classes: before.classes.length, courses: before.courses.length, entries: before.entries.length, imports: before.imports.length });
  });

  it("samma XML-import skapar inga okontrollerade dubletter", async () => {
    const { raceId } = await importedRace();
    const before = await trustedRaceFixtureOverview(raceId);
    expect((await importIofXml(db, raceId, courseXml)).duplicate).toBe(true);
    expect((await importIofXml(db, raceId, entryXml)).duplicate).toBe(true);
    const after = await trustedRaceFixtureOverview(raceId);
    expect({ classes: after.classes.length, courses: after.courses.length, entries: after.entries.length, imports: after.imports.length })
      .toEqual({ classes: before.classes.length, courses: before.courses.length, entries: before.entries.length, imports: before.imports.length });
  });

  it("publikresultat visar senaste publicerade revision", async () => {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !d21) throw new Error("Fixture saknar Ada eller D21");
    await changeEntryClass(db, raceId, ada.id, d21.id);
    await recalculateEntry(db, raceId, ada.id);
    const [latest] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!latest) throw new Error("Resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId,
      entryId: ada.id,
      readoutId: latest.readoutId,
      revision: 3,
      cause: "CLASS_CHANGE_RECALCULATION",
      status: latest.status,
      reason: latest.reason,
      evaluation: latest.evaluation,
      engineVersion: latest.engineVersion,
      snapshotVersion: latest.snapshotVersion,
      courseVersionId: latest.courseVersionId,
      published: false
    });
    const response = await publicResults(db, raceId);
    const [result] = response.results;
    expect(response.formatVersion).toBe(7);
    expect(result).toMatchObject({ revision: 2, className: "D21", status: "MP" });
    expect(result).not.toHaveProperty("entryId");
    expect(result).not.toHaveProperty("evaluation");
    expect(JSON.stringify(response)).not.toContain(ada.id);
  });
});

describe("TASK 004 konkurrenssäker multi-station-ingest", () => {
  it.each([2, 10])("serialiserar %i samtidiga stationer till obrutna revisioner", async (stationCount) => {
    const { raceId } = await importedRace();
    const responses = await Promise.all(Array.from({ length: stationCount }, async () =>
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload))
    ));

    expect(responses.flatMap((response) => response.acknowledgements.map((ack) => ack.status)))
      .toEqual(Array.from({ length: stationCount }, () => "stored"));
    const storedAcks = responses.flatMap((response) => {
      const acknowledgement = response.acknowledgements[0];
      return acknowledgement?.status === "stored" ? [acknowledgement] : [];
    });
    expect(new Set(storedAcks.map((ack) => ack.rawMessageId)).size).toBe(stationCount);
    expect(storedAcks.map((ack) => ack.contentHash))
      .toEqual(Array.from({ length: stationCount }, () => contentHash(okPayload)));
    const storedResults = storedAcks.flatMap((ack) => {
      const result = ack.serverResult;
      return result && result.status !== "UNKNOWN_CARD" ? [result] : [];
    });
    expect(storedResults.map((result) => result.revision).sort((left, right) => left - right))
      .toEqual(Array.from({ length: stationCount }, (_, index) => index + 1));
    expect(storedResults).toHaveLength(stationCount);
    const rawRows = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutRows = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionRows = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawRows.length, readouts: readoutRows.length, revisions: revisionRows.length })
      .toEqual({ raw: stationCount, readouts: stationCount, revisions: stationCount });
    expect(revisionRows.map((row) => row.revision).sort((left, right) => left - right))
      .toEqual(Array.from({ length: stationCount }, (_, index) => index + 1));
  });

  it("gör 100 samtidiga omsändningar till en stored och 99 duplicate", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const retry = batch(deviceId, okPayload);
    const responses = await Promise.all(Array.from({ length: 100 }, async () =>
      ingestDeviceBatch(db, raceId, retry)
    ));
    const statuses = responses.map((response) => response.acknowledgements[0]?.status);
    expect(statuses.filter((status) => status === "stored")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(99);
    const acknowledgements = responses.flatMap((response) => {
      const acknowledgement = response.acknowledgements[0];
      return acknowledgement && acknowledgement.status !== "rejected" ? [acknowledgement] : [];
    });
    expect(new Set(acknowledgements.map((ack) => ack.rawMessageId)).size).toBe(1);
    const persistedResults = acknowledgements.flatMap((ack) => {
      const result = ack.serverResult;
      return result && result.status !== "UNKNOWN_CARD" ? [result] : [];
    });
    expect(new Set(persistedResults.map((result) => result.resultRevisionId)).size).toBe(1);
    expect(new Set(persistedResults.map((result) => result.revision)).size).toBe(1);
    expect(persistedResults).toHaveLength(100);

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value })
      .toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("fortsätter efter hashfel och kvitterar giltig, ogiltig, giltig i ordning", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const first = batch(deviceId, okPayload, { localSequence: 1 }).events[0]!;
    const secondPayload = { ...okPayload, finishPunchedAt: "2026-08-30T10:41:00Z" };
    const second = batch(deviceId, secondPayload, { localSequence: 2 }).events[0]!;
    const thirdPayload = { ...okPayload, finishPunchedAt: "2026-08-30T10:42:00Z" };
    const third = batch(deviceId, thirdPayload, { localSequence: 3 }).events[0]!;
    const response = await ingestDeviceBatch(db, raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 3,
      events: [first, { ...second, contentHash: "0".repeat(64) }, third]
    });

    expect(response.acknowledgements.map((ack) => [ack.localSequence, ack.status]))
      .toEqual([[1, "stored"], [2, "rejected"], [3, "stored"]]);
    expect(response.acknowledgements[1]).toMatchObject({ reason: "CONTENT_HASH_MISMATCH" });
    expect(response.highestContiguousSequence).toBe(1);
    const rawRows = await db.select({ sequence: schema.rawDeviceMessages.localSequence })
      .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    expect(rawRows.map((row) => row.sequence).sort()).toEqual([1, 3]);
  });

  it("accepterar stale paket och beräknar med aktuell server-snapshot", async () => {
    const { raceId, overview } = await importedRace();
    const currentPackageVersion = overview.race.snapshotVersion;
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload, {
      packageVersion: currentPackageVersion - 1
    }));

    expect(response).toMatchObject({
      currentPackageVersion,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      acknowledgements: [{ status: "stored", serverResult: { snapshotVersion: currentPackageVersion } }]
    });
  });

  it("accepterar ahead paket utan att rekommendera nedgradering", async () => {
    const { raceId, overview } = await importedRace();
    const currentPackageVersion = overview.race.snapshotVersion;
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload, {
      packageVersion: currentPackageVersion + 1
    }));
    expect(response).toMatchObject({
      currentPackageVersion,
      packageVersionStatus: "ahead",
      packageUpdateRequired: false,
      acknowledgements: [{ status: "stored" }]
    });
  });

  it("avvisar sekvens/hash-konflikt utan att mutera den första avläsningen", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const first = await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const conflictingPayload = { ...okPayload, cardNumber: "99999" };
    const conflict = await ingestDeviceBatch(db, raceId, batch(deviceId, conflictingPayload));
    expect(first.acknowledgements[0]).toMatchObject({ status: "stored" });
    expect(conflict.acknowledgements[0]).toMatchObject({
      status: "rejected",
      reason: "SEQUENCE_HASH_CONFLICT"
    });

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value })
      .toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("avvisar samma sekvens/hash med ändrad immutable kontext", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const conflict = await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload, {
      sessionId: crypto.randomUUID()
    }));
    expect(conflict.acknowledgements[0]).toMatchObject({
      status: "rejected",
      reason: "SEQUENCE_CONTEXT_CONFLICT"
    });
    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    expect(rawCount?.value).toBe(1);
  });

  it("ger ingest en hel snapshot före eller efter en samtidig klassändring", async () => {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const h21 = overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada, H21 eller D21");

    await Promise.all([
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload)),
      changeEntryClass(db, raceId, ada.id, d21.id)
    ]);
    const [revision] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id));
    if (!revision) throw new Error("Resultatrevision saknas");
    const beforeOrAfter = revision.snapshotVersion === overview.race.snapshotVersion
      ? h21.id
      : revision.snapshotVersion === overview.race.snapshotVersion + 1 ? d21.id : undefined;
    expect(beforeOrAfter).toBeDefined();
    expect(revision.evaluation.classId).toBe(beforeOrAfter);
  });
});

describe("TASK 005C beständigt serverutfall", () => {
  it.each([
    ["känd", okPayload, "OK"],
    ["okänd", { ...okPayload, cardNumber: "saknas-i-startlistan" }, "UNKNOWN_CARD"]
  ] as const)("återger samma raw-id, bedömning och hash efter tappat svar för %s bricka", async (
    _label,
    payload,
    expectedStatus
  ) => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const request = batch(deviceId, payload);

    const stored = await ingestDeviceBatch(db, raceId, request);
    // Det första svaret betraktas som tappat. Samma frysta request skickas igen.
    const duplicate = await ingestDeviceBatch(db, raceId, request);
    const storedAck = stored.acknowledgements[0];
    const duplicateAck = duplicate.acknowledgements[0];
    if (!storedAck || storedAck.status !== "stored" || !storedAck.serverResult ||
        !duplicateAck || duplicateAck.status !== "duplicate" || !duplicateAck.serverResult) {
      throw new Error("Fixture gav inte fullständiga positiva kvittenser");
    }

    expect(storedAck.serverResult.status).toBe(expectedStatus);
    expect(duplicateAck.rawMessageId).toBe(storedAck.rawMessageId);
    expect(duplicateAck.serverResult).toEqual(storedAck.serverResult);
    expect(duplicateAck.serverResult.evaluationHash).toBe(storedAck.serverResult.evaluationHash);

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
    const outcomes = await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, storedAck.rawMessageId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, outcomes: outcomes.length })
      .toEqual({ raw: 1, readout: 1, outcomes: 1 });
    expect(outcomes[0]?.evaluationHash).toBe(storedAck.serverResult.evaluationHash);
    expect(outcomes[0]?.serverResult).toEqual(storedAck.serverResult);

    if (expectedStatus === "UNKNOWN_CARD") {
      expect(storedAck.serverResult.evaluationHash).toBe(evaluationHash({
        status: "UNKNOWN_CARD",
        reason: "UNKNOWN_CARD",
        missingControls: [],
        extraPunches: [],
        splits: []
      }));
      const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
        .innerJoin(schema.cardReadouts, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
        .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
      expect(revisionCount?.value).toBe(0);
    } else {
      const [revision] = await db.select({ evaluation: schema.resultRevisions.evaluation })
        .from(schema.resultRevisions)
        .innerJoin(schema.cardReadouts, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
        .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
      expect(revision).toBeDefined();
      expect(storedAck.serverResult.evaluationHash)
        .toBe(evaluationHash(evaluationResultSchema.parse(revision!.evaluation)));
    }
  });

  it("återläser en känd äldre post från resultatrevision när ingestutfall saknas", async () => {
    const { raceId } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const [sourceRevision] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    if (!sourceRevision) throw new Error("Fixture saknar en resultatrevision");

    const deviceId = crypto.randomUUID();
    const request = batch(deviceId, okPayload);
    const event = request.events[0]!;
    const [raw] = await db.insert(schema.rawDeviceMessages).values({
      raceId,
      deviceId,
      sessionId: request.sessionId,
      localSequence: event.localSequence,
      packageVersion: request.packageVersion,
      stationReceivedAt: new Date(event.stationReceivedAt),
      transport: event.transport,
      rawPayload: event.payload,
      contentHash: event.contentHash
    }).returning();
    if (!raw) throw new Error("Fixture kunde inte skapa en äldre råpost");
    const [readout] = await db.insert(schema.cardReadouts).values({
      raceId,
      rawMessageId: raw.id,
      cardNumber: event.payload.cardNumber,
      startPunchedAt: new Date(event.payload.startPunchedAt),
      finishPunchedAt: new Date(event.payload.finishPunchedAt),
      punches: event.payload.punches,
      readAt: new Date(event.stationReceivedAt)
    }).returning();
    if (!readout) throw new Error("Fixture kunde inte skapa en äldre readout");
    const [legacyRevision] = await db.insert(schema.resultRevisions).values({
      raceId,
      entryId: sourceRevision.entryId,
      readoutId: readout.id,
      revision: sourceRevision.revision + 1,
      cause: "CARD_READOUT",
      status: sourceRevision.status,
      reason: sourceRevision.reason,
      evaluation: sourceRevision.evaluation,
      engineVersion: sourceRevision.engineVersion,
      snapshotVersion: sourceRevision.snapshotVersion,
      courseVersionId: sourceRevision.courseVersionId,
      published: true
    }).returning();
    if (!legacyRevision) throw new Error("Fixture kunde inte skapa en äldre resultatrevision");

    const retry = await ingestDeviceBatch(db, raceId, request);
    const acknowledgement = retry.acknowledgements[0];
    expect(acknowledgement).toMatchObject({
      status: "duplicate",
      rawMessageId: raw.id,
      serverResult: {
        resultRevisionId: legacyRevision.id,
        revision: legacyRevision.revision,
        evaluationHash: evaluationHash(evaluationResultSchema.parse(legacyRevision.evaluation))
      }
    });
    expect(await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, raw.id))).toHaveLength(0);
  });

  it("förbjuder update och delete av ingestutfallet", async () => {
    const { raceId } = await importedRace();
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const acknowledgement = response.acknowledgements[0];
    if (!acknowledgement || acknowledgement.status !== "stored") throw new Error("Fixture saknar stored-kvittens");

    await expect(db.update(schema.deviceIngestOutcomes)
      .set({ evaluationHash: "f".repeat(64) })
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId)))
      .rejects.toThrow();
    await expect(db.delete(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId)))
      .rejects.toThrow();
    const rows = await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.evaluationHash).not.toBe("f".repeat(64));
  });
});
