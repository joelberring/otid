import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { decodeCard, decodeRecordedFrames, normalizeCard } from "../../../sportident/src";
import { NATT_KM_CODES, nattKmBlockFrame, nattKmBlocks, nattKmDetection } from "../../../sportident/test/fixtures/siac-natt-km";
import { ingestDeviceBatch } from "../../src";
import { contentHash } from "../../src/serialization";
import { db, pool } from "./race-fixtures";

/**
 * Natt-KM-underlaget för omläsning från rådata (steg 36, delas med steg 38): avläsningen i webbläsaren lade SIAC-brickans
 * block 1–4 där block 4–7 ska vara. Råramarna (detektering + block 0–4) finns kvar och ger vid omläsning kvällens 14
 * stämplingar. Bricknumren är påhittade.
 */
export const DATE = "2026-10-20";
export const READ_AT = "2026-10-20T17:45:00.000Z";
export const OFFSET_MS = 1_500;
export const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const reference = new Date(Date.parse(READ_AT) + OFFSET_MS);
export const options = { reference, timeZone: "Europe/Stockholm" };

/** Råramarna så som den gamla avläsningen sparade dem: detektering + de fem första svaren (block 0–4). */
export const oldFrames = (card: number) => [nattKmDetection(card), ...[0, 1, 2, 3, 4].map((number) => nattKmBlockFrame(number, card))];

/** Nyttolasten som den gamla webbläsaren byggde: block 0–4 som om de vore 0, 4, 5, 6, 7 (fel stämplingar). */
export function oldPayload(card: number, frames = oldFrames(card).map(toHex), simulated = false) {
  const blocks = nattKmBlocks(card);
  const image = new Uint8Array(5 * 128);
  [0, 1, 2, 3, 4].forEach((number, index) => image.set(blocks[number]!, index * 128));
  const wrong = normalizeCard(decodeCard("SIAC", image), options);
  // Fixturens block 1 är bara delvis känt (resten 0xEE); kvar blir de felaktiga stämplingar som avläsningen kunde skicka.
  return payloadFrom({ ...wrong, punches: wrong.punches.filter((punch) => punch.code > 0), untimedPunchCodes: [] }, frames, simulated);
}

/** En korrekt avläsning (samma avkodning som nu). */
export const correctPayload = (card: number) =>
  payloadFrom(normalizeCard(decodeRecordedFrames(oldFrames(card)), options), oldFrames(card).map(toHex), false);

export function payloadFrom(normalized: ReturnType<typeof normalizeCard>, frames: string[], simulated: boolean) {
  return { cardNumber: normalized.cardNumber, cardType: normalized.cardType,
    ...(normalized.startPunchedAt ? { startPunchedAt: normalized.startPunchedAt } : {}),
    ...(normalized.finishPunchedAt ? { finishPunchedAt: normalized.finishPunchedAt } : {}),
    ...(normalized.checkPunchedAt ? { checkPunchedAt: normalized.checkPunchedAt } : {}),
    ...(normalized.clearPunchedAt ? { clearPunchedAt: normalized.clearPunchedAt } : {}),
    punches: normalized.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...normalized.untimedPunchCodes], frames, stationSerial: 123_456,
    clockSource: "station" as const, clockOffsetMs: OFFSET_MS, simulated };
}

export async function send(raceId: string, payloads: ReturnType<typeof payloadFrom>[]) {
  const deviceId = randomUUID();
  const ack = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1,
    lastSequence: payloads.length, events: payloads.map((payload, index) => ({ localSequence: index + 1, stationReceivedAt: READ_AT,
      transport: "sportident" as const, payload, contentHash: contentHash(payload) })) });
  expect(ack.acknowledgements.map((row) => row.status)).toEqual(payloads.map(() => "stored"));
}

export const CARDS = { ada: 8_001_234, bo: 8_001_235, cia: 8_001_236, dan: 8_001_237, eva: 8_001_238 };

/** Natt-KM: bana med kvällens 14 kontroller, fri start; Ada, Bo, Cia, Dan och Eva med var sin SIAC. */
export async function nightRace(className = "H21") {
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
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,$3,$4,'PUNCH')",
    [ids.class, ids.race, className, ids.version]);
  for (const name of ["ada", "bo", "cia", "dan", "eva"] as const) {
    await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name) VALUES($1,$2,$3,$4,'Test','OK Test')",
      [ids[name], ids.race, ids.class, name[0]!.toUpperCase() + name.slice(1)]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,is_rental) VALUES($1,$2,$3,false)",
      [ids.race, ids[name], String(CARDS[name])]);
  }
  return ids;
}


/** En löpare till i natt-KM:s klass med egen bricka; ger deltagarens id. */
export async function addNightRunner(ids: { race: string; class: string }, givenName: string, cardNumber: number) {
  const id = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name) VALUES($1,$2,$3,$4,'Test','OK Test')",
    [id, ids.race, ids.class, givenName]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,is_rental) VALUES($1,$2,$3,false)",
    [ids.race, id, String(cardNumber)]);
  return id;
}
