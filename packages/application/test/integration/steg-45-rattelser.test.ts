import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { ingestDeviceBatch, listUninterpretedReadoutsAsAdmin, listUnknownReadoutResolutionCandidatesAsAdmin, publicResults,
  receiveUninterpretedReadout, rereadUninterpretedReadoutAsAdmin, resolveUnknownReadoutAsAdmin } from "../../src";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { applyRaceCorrectionAsAdmin, listRaceCorrectionsAsAdmin, previewRaceCorrectionAsAdmin } from "../../src/race-corrections";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";
import { CARDS, nightRace, OFFSET_MS, oldFrames, READ_AT, toHex } from "./reread-fixtures";

/** Steg 45: rättelser efter genomlysningen 2026-10-25. */
useRaceDatabase();
const { decide, entryId } = statusFlow(db);

async function roster(admin: Awaited<ReturnType<typeof raceAuth>>) {
  const listed = await listEntryTransfersAsAdmin(db, admin);
  if (listed.status !== "ok") throw new Error(listed.status);
  return listed.response.entries;
}

describe("steg 45: beslut som döljer en ny avläsning", () => {
  it("brutit utan bricka, brickan kopplas sedan: kvittot, deltagarlistan och borttaget beslut", async () => {
    const { raceId } = await importedRace();
    const admin = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    // Brickan var borta: brutit utan avläsning.
    await db.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.entryId, ada));
    expect(await decide(admin, ada, { kind: "DID_NOT_FINISH" })).toMatchObject({ status: "decided" });
    expect((await roster(admin)).find((row) => row.id === ada)?.decisionReview).toBeUndefined();
    // Brickan hittas och läses ut: okänd, och kopplas till Ada under Okända brickor.
    const [ack] = (await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload))).acknowledgements;
    expect(ack).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    const readout = listed.response.readouts[0]!;
    const adaRow = listed.response.entries.find((entry) => entry.id === ada)!;
    const requestId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...admin, idempotencyKey: `unknown-readout-resolution:${requestId}`,
      request: { formatVersion: 1, requestId, target: "EXISTING_ENTRY", readoutId: readout.id, cardNumber: "12345",
        expectedEngineVersion: listed.response.engineVersion, entryId: ada, expectedEntryVersion: adaRow.entryVersion,
        expectedClassId: adaRow.classId, expectedAssignment: adaRow.activeAssignment, expectedLatestResultRevision: adaRow.latestResultRevision } });
    expect(resolved).toMatchObject({ status: "resolved", response: { status: "OK",
      decisionReview: { decision: "DNF", status: "OK", elapsedMs: 2_400_000 } } });
    // Brutit gäller fortfarande, men deltagarlistan ("Beslut att se över" och deltagarkortet) säger vad avläsningen ger.
    const row = (await roster(admin)).find((entry) => entry.id === ada);
    expect(row).toMatchObject({ effectiveResult: { result: { status: "DNF" } },
      decisionReview: { decision: "DNF", status: "OK", elapsedMs: 2_400_000 } });
    expect((await roster(admin)).filter((entry) => entry.decisionReview)).toHaveLength(1);
    // "Ta bort beslutet": avläsningen gäller och beskedet försvinner.
    expect(await decide(admin, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided" });
    expect((await roster(admin)).find((entry) => entry.id === ada)?.decisionReview).toBeUndefined();
    expect((await publicResults(db, raceId)).results.find((result) => result.givenName === "Ada"))
      .toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
  });

  it("samma avläsning igen under en disk ger inget besked", async () => {
    const { raceId } = await importedRace();
    const admin = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    expect(await decide(admin, ada, { kind: "DISQUALIFIED" })).toMatchObject({ status: "decided" });
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    expect((await roster(admin)).find((entry) => entry.id === ada)?.decisionReview).toBeUndefined();
  });
});

describe("steg 45: tidsjustering för alla enheter", () => {
  it("−60 min på alla enheter sparas, räknar om och ger samma löptid och status vid stämplingsstart", async () => {
    const { raceId } = await importedRace();
    const admin = await raceAuth(db, raceId);
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    const correction = { action: "ADD_TIME_ADJUSTMENT" as const, station: "ALL" as const, offsetSeconds: -3600, reason: "Sommartid" };
    const preview = await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction } });
    if (preview.status !== "ok") throw new Error(preview.status);
    expect((await applyRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      expectedPreviewHash: preview.response.previewHash, correction } })).status).toBe("applied");
    const listed = await listRaceCorrectionsAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.response.corrections).toMatchObject([{ kind: "TIME_ADJUSTMENT", station: "ALL", controlCode: null, offsetMs: -3_600_000 }]);
    const ada = (await publicResults(db, raceId)).results.find((result) => result.givenName === "Ada");
    expect(ada).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
    // En kontrollkod hör inte till alla enheter.
    expect((await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1,
      correction: { ...correction, controlCode: 31 } } })).status).toBe("invalid-request");
  });
});

describe("steg 45: avläsningar vars tider inte gick att tolka", () => {
  const request = (card: number, frames: string[], requestId = randomUUID()) => ({ formatVersion: 1, requestId,
    deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 1, stationReceivedAt: READ_AT,
    payload: { cardNumber: String(card), frames, error: "Bricktiden kan inte placeras inom en vecka före avläsningen",
      stationSerial: 123_456, clockSource: "station" as const, clockOffsetMs: OFFSET_MS, simulated: false } });

  it("sparar råramarna utan avläsning, listar dem och läser om dem till en vanlig avläsning", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race), functionary = await raceAuth(db, ids.race, "FUNCTIONARY");
    const sent = request(CARDS.ada, oldFrames(CARDS.ada).map(toHex));
    const stored = await receiveUninterpretedReadout(db, { ...functionary, request: sent });
    expect(stored).toMatchObject({ status: "ok", response: { status: "stored", requestId: sent.requestId } });
    expect(await receiveUninterpretedReadout(db, { ...functionary, request: sent })).toMatchObject({ status: "ok",
      response: { status: "duplicate" } });
    expect((await receiveUninterpretedReadout(db, { ...functionary, request: { ...sent, payload: { ...sent.payload, error: "Annat" } } })).status)
      .toBe("conflict");
    const rawId = stored.status === "ok" ? stored.response.rawMessageId : "";
    const [raw] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, rawId));
    expect(raw).toMatchObject({ transport: "sportident-uninterpreted", parserStatus: "uninterpreted", raceId: ids.race });
    expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, ids.race))).toEqual([]);

    expect((await listUninterpretedReadoutsAsAdmin(db, functionary)).status).toBe("forbidden");
    const listed = await listUninterpretedReadoutsAsAdmin(db, admin);
    expect(listed).toMatchObject({ status: "ok", response: { readouts: [{ rawMessageId: rawId, cardNumber: String(CARDS.ada),
      stationReceivedAt: READ_AT, reread: null }] } });

    const reread = { formatVersion: 1, requestId: randomUUID(), rawMessageId: rawId, reference: { kind: "DEVICE" } };
    expect((await rereadUninterpretedReadoutAsAdmin(db, { ...functionary, request: reread })).status).toBe("forbidden");
    const read = await rereadUninterpretedReadoutAsAdmin(db, { ...admin, request: reread });
    expect(read).toMatchObject({ status: "ok", response: { result: "READ", replayed: false, status: "OK", punchCount: 14 } });
    expect((await publicResults(db, ids.race)).results.find((row) => row.givenName === "Ada")).toMatchObject({ status: "OK" });
    // Originalet står kvar oförändrat; samma begäran igen ger samma kvitto, en ny begäran konflikt.
    const [after] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, rawId));
    expect(after).toEqual(raw);
    expect(await rereadUninterpretedReadoutAsAdmin(db, { ...admin, request: reread })).toMatchObject({ status: "ok",
      response: { result: "READ", replayed: true } });
    expect((await rereadUninterpretedReadoutAsAdmin(db, { ...admin, request: { ...reread, requestId: randomUUID() } })).status).toBe("conflict");
    expect(await listUninterpretedReadoutsAsAdmin(db, admin)).toMatchObject({ status: "ok", response: { readouts: [{ rawMessageId: rawId,
      reread: { status: "OK" } }] } });
  });

  it("en angiven tid läser om, och ramar som inte går ihop sparar inget", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    const good = await receiveUninterpretedReadout(db, { ...admin, request: request(CARDS.bo, oldFrames(CARDS.bo).map(toHex)) });
    const given = { formatVersion: 1, requestId: randomUUID(), rawMessageId: good.status === "ok" ? good.response.rawMessageId : "",
      reference: { kind: "GIVEN", readAt: "2026-10-20T17:50:00.000Z" } };
    expect(await rereadUninterpretedReadoutAsAdmin(db, { ...admin, request: given })).toMatchObject({ status: "ok",
      response: { result: "READ", status: "OK" } });
    const [readout] = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, ids.race));
    expect(readout?.readAt.toISOString()).toBe("2026-10-20T17:50:00.000Z");
    // Bricknumret stämmer inte med råramarna: inget sparas.
    const wrong = await receiveUninterpretedReadout(db, { ...admin, request: request(CARDS.cia, oldFrames(CARDS.dan).map(toHex)) });
    const before = (await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, ids.race))).length;
    expect(await rereadUninterpretedReadoutAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      rawMessageId: wrong.status === "ok" ? wrong.response.rawMessageId : "", reference: { kind: "DEVICE" } } }))
      .toMatchObject({ status: "ok", response: { result: "UNREADABLE", reason: "FRAMES" } });
    expect((await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, ids.race))).length).toBe(before);
  });
});

describe("steg 45: disk och utom tävlan ovanpå en manuell tid", () => {
  it("diskar en löpare med manuell tid, och borttagen disk återställer den manuella tiden", async () => {
    const { raceId } = await importedRace();
    const admin = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    expect(await decide(admin, ada, { kind: "MANUAL_TIME", finishTime: "2026-08-30T12:45:00+02:00", status: "OK",
      note: "Målklockan" })).toMatchObject({ status: "decided" });
    const adaResult = async () => (await publicResults(db, raceId)).results.find((result) => result.givenName === "Ada");
    expect(await adaResult()).toMatchObject({ status: "OK", elapsedMs: 45 * 60_000 });
    expect(await decide(admin, ada, { kind: "DISQUALIFIED", reason: "Genade" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_DISQUALIFICATION" } });
    expect(await adaResult()).toMatchObject({ status: "DSQ" });
    expect(await decide(admin, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided" });
    expect(await adaResult()).toMatchObject({ status: "OK", elapsedMs: 45 * 60_000 });
    expect(await decide(admin, ada, { kind: "OUT_OF_COMPETITION" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_OUT_OF_COMPETITION" } });
    expect(await adaResult()).toMatchObject({ status: "OOC", elapsedMs: 45 * 60_000 });
  });
});
