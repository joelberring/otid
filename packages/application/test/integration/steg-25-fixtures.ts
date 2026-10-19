import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { createDatabase, Database } from "@o-tid/database";
import { contentHash } from "../../src/serialization";
import { ingestDeviceBatch } from "../../src/ingest";
import { raceLogin } from "./accounts";

/**
 * PLAN.md steg 25: ett litet lopp för integrationstesterna. Banan Lång har kontrollerna 31 och 32. Klassen H21 har
 * minutstart, Öppen fri start. Ada (H21, lottad 10:00), Bo (H21, efteranmäld utan lottad tid), Cia, Dan och Eva (Öppen).
 */
export const RACE_DATE = "2026-09-19";
export const NOW = new Date(`${RACE_DATE}T15:00:00Z`);

type Pool = ReturnType<typeof createDatabase>["pool"];

export async function seedRace(db: Database, pool: Pool) {
  const ids = { event: randomUUID(), race: randomUUID(), course: randomUUID(), version: randomUUID(), fixed: randomUUID(), free: randomUUID(),
    ada: randomUUID(), bo: randomUUID(), cia: randomUUID(), dan: randomUUID(), eva: randomUUID() };
  const card = (n: number) => String(7_100_000 + Math.floor(Math.random() * 800_000) * 10 + n);
  const cards = { ada: card(1), bo: card(2), cia: card(3), dan: card(4) };
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Steg 25',$2,'Europe/Stockholm')", [ids.event, RACE_DATE]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Steg 25',$3)", [ids.race, ids.event, RACE_DATE]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Lång')", [ids.course, ids.race]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [ids.version, ids.course]);
  for (const [sequence, code] of [[1, 31], [2, 32]] as const) {
    const control = randomUUID();
    await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,$3)", [control, ids.race, code]);
    await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,$3)", [ids.version, control, sequence]);
  }
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'H21',$3,'FIXED'),($4,$2,'Öppen',$3,'PUNCH')",
    [ids.fixed, ids.race, ids.version, ids.free]);
  const entry = (id: string, classId: string, given: string, family: string, start: string | null, eventor?: { person: string; org: string }) =>
    pool.query(`INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name,fixed_start_time,external_source,external_id,
      eventor_person_id,eventor_organisation_id) VALUES($1,$2,$3,$4,$5,'OK Test',$6,$7,$8,$9,$10)`,
    [id, ids.race, classId, given, family, start, eventor ? "eventor" : null, eventor ? `e-${given}` : null, eventor?.person ?? null,
      eventor?.org ?? null]);
  await entry(ids.ada, ids.fixed, "Ada", "Ek", `${RACE_DATE}T10:02:00Z`, { person: "610001", org: "9321" });
  await entry(ids.bo, ids.fixed, "Bo", "Ek", null);
  await entry(ids.cia, ids.free, "Cia", "Ek", null);
  await entry(ids.dan, ids.free, "Dan", "Ek", null);
  await entry(ids.eva, ids.free, "Eva", "Ek", null);
  for (const [entryId, number] of [[ids.ada, cards.ada], [ids.bo, cards.bo], [ids.cia, cards.cia], [ids.dan, cards.dan]] as const) {
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,is_rental) VALUES($1,$2,$3,$4)", [ids.race, entryId, number,
      entryId === ids.cia]);
  }
  const admin = await auth(db, ids.race, "ADMIN");
  return { ids, cards, admin };
}

export async function auth(db: Database, raceId: string, role: "ADMIN" | "FUNCTIONARY") {
  const login = await raceLogin(db, raceId, role, NOW);
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, accountId: login.accountId };
}

/** En avläsning som tar sig runt banan på `minutes` minuter från `start` (UTC-klockslag). */
export function run(cardNumber: string, start: string, minutes: number) {
  const startMs = Date.parse(`${RACE_DATE}T${start}Z`);
  const at = (offsetMinutes: number) => new Date(startMs + offsetMinutes * 60_000).toISOString();
  return { cardNumber, startPunchedAt: at(0), finishPunchedAt: at(minutes),
    punches: [{ code: 31, punchedAt: at(minutes / 3) }, { code: 32, punchedAt: at((2 * minutes) / 3) }] };
}

let sequence = 0;
/** Tar emot avläsningarna i en batch från en ny enhet; ger kvittona. */
export async function ingest(db: Database, raceId: string, payloads: readonly ReturnType<typeof run>[]) {
  const deviceId = randomUUID();
  sequence += 1;
  const result = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: payloads.length, events: payloads.map((payload, index) => ({ localSequence: index + 1,
      stationReceivedAt: new Date(Date.parse(payload.finishPunchedAt) + 60_000 + sequence).toISOString(),
      transport: "simulator" as const, payload, contentHash: contentHash(payload) })) });
  expect(result.acknowledgements.every((row) => row.status === "stored")).toBe(true);
  return result.acknowledgements;
}
