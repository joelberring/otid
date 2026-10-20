import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { decodeCard, decodeRecordedFrames, normalizeCard } from "../../../sportident/src";
import { NATT_KM_CODES, nattKmBlockFrame, nattKmBlocks, nattKmDetection } from "../../../sportident/test/fixtures/siac-natt-km";
import {
  applyReadoutRereadAsAdmin, getAdministratorEffectiveResult, ingestDeviceBatch, previewReadoutRereadAsAdmin, publicResults
} from "../../src";
import { contentHash } from "../../src/serialization";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { db, pool, useRaceDatabase } from "./race-fixtures";

/**
 * Steg 36: läs om avläsningar från rådata. Natt-KM 2026-10-20: avläsningen i webbläsaren lade SIAC-brickans block 1–4 där
 * block 4–7 ska vara och läste brickans inställningar som stämplingar. Råramarna (detektering + block 0–4) finns kvar och
 * ger vid omläsning kvällens 14 stämplingar. Bricknumren är påhittade.
 */
useRaceDatabase();
const { decide, revisions } = statusFlow(db);
const DATE = "2026-10-20";
const READ_AT = "2026-10-20T17:45:00.000Z";
const OFFSET_MS = 1_500;
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const reference = new Date(Date.parse(READ_AT) + OFFSET_MS);
const options = { reference, timeZone: "Europe/Stockholm" };

/** Råramarna så som den gamla avläsningen sparade dem: detektering + de fem första svaren (block 0–4). */
const oldFrames = (card: number) => [nattKmDetection(card), ...[0, 1, 2, 3, 4].map((number) => nattKmBlockFrame(number, card))];

/** Nyttolasten som den gamla webbläsaren byggde: block 0–4 som om de vore 0, 4, 5, 6, 7 (fel stämplingar). */
function oldPayload(card: number, frames = oldFrames(card).map(toHex), simulated = false) {
  const blocks = nattKmBlocks(card);
  const image = new Uint8Array(5 * 128);
  [0, 1, 2, 3, 4].forEach((number, index) => image.set(blocks[number]!, index * 128));
  const wrong = normalizeCard(decodeCard("SIAC", image), options);
  // Fixturens block 1 är bara delvis känt (resten 0xEE); kvar blir de felaktiga stämplingar som avläsningen kunde skicka.
  return payloadFrom({ ...wrong, punches: wrong.punches.filter((punch) => punch.code > 0), untimedPunchCodes: [] }, frames, simulated);
}

/** En korrekt avläsning (samma avkodning som nu). */
const correctPayload = (card: number) =>
  payloadFrom(normalizeCard(decodeRecordedFrames(oldFrames(card)), options), oldFrames(card).map(toHex), false);

function payloadFrom(normalized: ReturnType<typeof normalizeCard>, frames: string[], simulated: boolean) {
  return { cardNumber: normalized.cardNumber, cardType: normalized.cardType,
    ...(normalized.startPunchedAt ? { startPunchedAt: normalized.startPunchedAt } : {}),
    ...(normalized.finishPunchedAt ? { finishPunchedAt: normalized.finishPunchedAt } : {}),
    ...(normalized.checkPunchedAt ? { checkPunchedAt: normalized.checkPunchedAt } : {}),
    ...(normalized.clearPunchedAt ? { clearPunchedAt: normalized.clearPunchedAt } : {}),
    punches: normalized.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...normalized.untimedPunchCodes], frames, stationSerial: 123_456,
    clockSource: "station" as const, clockOffsetMs: OFFSET_MS, simulated };
}

async function send(raceId: string, payloads: ReturnType<typeof payloadFrom>[]) {
  const deviceId = randomUUID();
  const ack = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1,
    lastSequence: payloads.length, events: payloads.map((payload, index) => ({ localSequence: index + 1, stationReceivedAt: READ_AT,
      transport: "sportident" as const, payload, contentHash: contentHash(payload) })) });
  expect(ack.acknowledgements.map((row) => row.status)).toEqual(payloads.map(() => "stored"));
}

const CARDS = { ada: 8_001_234, bo: 8_001_235, cia: 8_001_236, dan: 8_001_237, eva: 8_001_238 };

/** Natt-KM: bana med kvällens 14 kontroller, fri start; Ada, Bo, Cia, Dan och Eva med var sin SIAC. */
async function nightRace() {
  const ids = { event: randomUUID(), race: randomUUID(), course: randomUUID(), version: randomUUID(), class: randomUUID(),
    ada: randomUUID(), bo: randomUUID(), cia: randomUUID(), dan: randomUUID(), eva: randomUUID() };
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Natt-KM',$2,'Europe/Stockholm')", [ids.event, DATE]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Natt-KM',$3)", [ids.race, ids.event, DATE]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Natt')", [ids.course, ids.race]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [ids.version, ids.course]);
  for (const [index, code] of NATT_KM_CODES.entries()) {
    const control = randomUUID();
    await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,$3)", [control, ids.race, code]);
    await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,$3)", [ids.version, control, index + 1]);
  }
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'H21',$3,'PUNCH')",
    [ids.class, ids.race, ids.version]);
  for (const name of ["ada", "bo", "cia", "dan", "eva"] as const) {
    await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name) VALUES($1,$2,$3,$4,'Test','OK Test')",
      [ids[name], ids.race, ids.class, name[0]!.toUpperCase() + name.slice(1)]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,is_rental) VALUES($1,$2,$3,false)",
      [ids.race, ids[name], String(CARDS[name])]);
  }
  return ids;
}

const readoutsOf = (raceId: string, card: number) => db.select().from(schema.cardReadouts)
  .where(and(eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, String(card))))
  .orderBy(asc(schema.cardReadouts.readAt));
const publicRow = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((row) => row.givenName === givenName);

async function preview(auth: Awaited<ReturnType<typeof raceAuth>>, entryId?: string) {
  const result = await previewReadoutRereadAsAdmin(db, { ...auth, request: { formatVersion: 1, ...(entryId ? { entryId } : {}) } });
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

describe("steg 36: läs om avläsningar från rådata", () => {
  it("natt-KM: Ada får kvällens 14 stämplingar, godkänd 53:23; Bo (rätt avläst) och övningsstationen listas inte", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [oldPayload(CARDS.ada), correctPayload(CARDS.bo), oldPayload(CARDS.cia, undefined, true)]);
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "MP" });
    expect(await publicRow(ids.race, "Bo")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
    const [original] = await readoutsOf(ids.race, CARDS.ada);
    const [originalRaw] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, original!.rawMessageId));

    const listed = await preview(admin);
    expect(listed.checkedCount).toBe(2);
    expect(listed.unreadable).toEqual([]);
    expect(listed.items).toHaveLength(1);
    const [item] = listed.items;
    expect(item).toMatchObject({ entryId: ids.ada, readoutId: original!.id, cardNumber: String(CARDS.ada), displayName: "Ada Test",
      className: "H21", before: { punchCount: original!.punches.length, status: "MP" },
      after: { punchCount: 14, status: "OK", elapsedMs: 3_203_000 }, manualDecision: null });
    // Samma för en deltagare (deltagarkortet).
    expect((await preview(admin, ids.ada)).items).toEqual([item]);
    expect((await preview(admin, ids.bo)).items).toEqual([]);

    const requestId = randomUUID();
    const commit = (request: unknown) => applyReadoutRereadAsAdmin(db, { ...admin, request });
    const saved = await commit({ formatVersion: 1, requestId, items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] });
    expect(saved).toMatchObject({ status: "applied", response: { replayed: false, saved: [{ entryId: ids.ada, replacedReadoutId: original!.id }] } });
    if (saved.status !== "applied") throw new Error(saved.status);

    // En ny avläsning med kvällens stämplingar, start 18:47:56 och mål 19:41:19 svensk tid.
    const readouts = await readoutsOf(ids.race, CARDS.ada);
    expect(readouts).toHaveLength(2);
    const reread = readouts[1]!;
    expect(reread.id).toBe(saved.response.saved[0]!.readoutId);
    expect(reread.punches.map((punch) => punch.code)).toEqual(NATT_KM_CODES);
    expect(reread.startPunchedAt?.toISOString()).toBe("2026-10-20T16:47:56.000Z");
    expect(reread.finishPunchedAt?.toISOString()).toBe("2026-10-20T17:41:19.000Z");
    expect(reread.readAt.getTime()).toBe(original!.readAt.getTime() + 1);
    // Originalet och dess råmeddelande är oförändrade; det nya råmeddelandet pekar på originalet.
    expect(readouts[0]).toEqual(original);
    expect((await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, originalRaw!.id)))[0]).toEqual(originalRaw);
    const [rawReread] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, reread.rawMessageId));
    expect(rawReread).toMatchObject({ transport: "sportident-reread", deviceId: originalRaw!.id, localSequence: 1,
      stationReceivedAt: originalRaw!.stationReceivedAt,
      rawPayload: { rereadOf: { rawMessageId: originalRaw!.id, replacesReadoutId: original!.id }, simulated: false } });

    const adaRevisions = await revisions(ids.ada);
    expect(adaRevisions.map((row) => [row.cause, row.status])).toEqual([["CARD_READOUT", "MP"], ["READOUT_REREAD", "OK"]]);
    expect(adaRevisions[1]).toMatchObject({ readoutId: reread.id, actorAccountId: admin.actorId, evaluation: { elapsedMs: 3_203_000 } });
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
    const effective = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada });
    expect(effective).toMatchObject({ status: "ok", response: { history: [{ cause: "READOUT_REREAD", status: "OK" }, { cause: "CARD_READOUT" }],
      cardPunches: { readAt: reread.readAt.toISOString() } } });
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId));
    expect(audit).toEqual([expect.objectContaining({ action: "READOUT_REREAD_BY_ADMIN", entityType: "card_readout", entityId: reread.id,
      actorId: admin.actorId })]);

    // Idempotens: samma begäran ger samma kvitto; en ny omläsning hittar inget och ger inga nya avläsningar.
    expect(await commit({ formatVersion: 1, requestId, items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] })).toMatchObject({ status: "applied", response: { replayed: true, saved: saved.response.saved } });
    expect((await preview(admin)).items).toEqual([]);
    expect(await commit({ formatVersion: 1, requestId: randomUUID(), items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] })).toEqual({ status: "conflict" });
    expect(await readoutsOf(ids.race, CARDS.ada)).toHaveLength(2);
    expect(await revisions(ids.ada)).toHaveLength(2);
  });

  it("råramar som inte går att avkoda listas som 'går inte att läsa om' och ger inga stämplingar", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    const corrupt = oldFrames(CARDS.dan).map(toHex);
    corrupt[5] = corrupt[5]!.slice(0, 40) + (corrupt[5]![40] === "0" ? "1" : "0") + corrupt[5]!.slice(41);
    const missing = oldFrames(CARDS.eva).slice(0, 5).map(toHex);
    await send(ids.race, [oldPayload(CARDS.dan, corrupt), oldPayload(CARDS.eva, missing)]);
    const listed = await preview(admin);
    expect(listed.items).toEqual([]);
    expect(listed.unreadable.map((row) => [row.displayName, row.reason])).toEqual([["Dan Test", "FRAMES"], ["Eva Test", "FRAMES"]]);
    expect(listed.unreadable[0]!.detail).toMatch(/kontrollsumma/);
    expect(listed.unreadable[1]!.detail).toMatch(/Ofullständig/);
    expect(await readoutsOf(ids.race, CARDS.dan)).toHaveLength(1);
  });

  it("ett manuellt beslut ligger kvar över omläsningen och visas i förhandsbeskedet", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [oldPayload(CARDS.ada)]);
    expect(await decide(admin, ids.ada, { kind: "MANUAL_TIME", finishTime: "2026-10-20T19:45:00+02:00", status: "OK",
      note: "Fel stämplingar från avläsningen" })).toMatchObject({ status: "decided" });
    const [item] = (await preview(admin)).items;
    expect(item).toMatchObject({ entryId: ids.ada, manualDecision: "MANUAL_TIME", after: { status: "OK", punchCount: 14 } });
    const saved = await applyReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      items: [{ readoutId: item!.readoutId, entryId: item!.entryId, itemHash: item!.itemHash }] } });
    expect(saved.status).toBe("applied");
    expect((await revisions(ids.ada)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_TIME", "READOUT_REREAD"]);
    expect(await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "MANUAL_TIME" } });
    // "Ta bort manuell tid": omläsningen gäller.
    expect(await decide(admin, ids.ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided" });
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
  });

  it("bara administratören: funktionären och den utan session får inget, och inget sparas", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    const functionary = await raceAuth(db, ids.race, "FUNCTIONARY");
    await send(ids.race, [oldPayload(CARDS.ada)]);
    const [item] = (await preview(admin)).items;
    const request = { formatVersion: 1, requestId: randomUUID(), items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] };
    expect(await previewReadoutRereadAsAdmin(db, { ...functionary, request: { formatVersion: 1 } })).toEqual({ status: "forbidden" });
    expect(await applyReadoutRereadAsAdmin(db, { ...functionary, request })).toEqual({ status: "forbidden" });
    expect(await applyReadoutRereadAsAdmin(db, { raceId: ids.race, sessionToken: null, request })).toEqual({ status: "unauthorized" });
    expect(await applyReadoutRereadAsAdmin(db, { ...admin, request: { ...request, items: [{ ...request.items[0]!, itemHash: "0".repeat(64) }] } }))
      .toEqual({ status: "conflict" });
    expect(await applyReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1 } })).toEqual({ status: "invalid-request" });
    expect(await readoutsOf(ids.race, CARDS.ada)).toHaveLength(1);
  });
});
