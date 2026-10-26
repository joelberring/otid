import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { accountOnRace } from "./accounts";
import { loadRaceSnapshot } from "../../src/snapshot";
import { evaluateCardReadout } from "@o-tid/domain";
import { registerEntryAsAdmin } from "../../src/entry-registration";

/**
 * Steg 54 (ADR-0177): avläsningen läser bara löparens eller lagets del av tävlingen. Bedömningen med den avgränsade
 * ögonblicksbilden ska vara exakt densamma som med hela tävlingens.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 54-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg54_scope_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg54_scope_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const CODES = [31, 32, 33];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg54.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Lastdagen", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof, name: string) {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: name, className: `Klass ${name}`, startRule: "PUNCH", controlCodes: CODES } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  // Steg 55: klassen är valfri; här skapas den alltid.
  const { classId } = created.response;
  if (classId === null) throw new Error("Klassen skapades inte");
  return { ...created.response, classId };
}

async function relayClass(proof: Proof, courseId: string, second: "CHANGEOVER" | "FLYING_RESTART", name: string) {
  const requestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1, requestId,
    name, courseId, legs: [
      { leg: 1, startMethod: "MASS_START", startTime: at("17:00"), variantCode: null },
      { leg: 2, startMethod: second, startTime: null, variantCode: null, ...(second === "FLYING_RESTART" ? { restartAfterMinutes: 30 } : {}) }] } });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  return created.response.classId;
}

async function team(proof: Proof, classId: string, name: string, cards: string[]) {
  const requestId = randomUUID();
  const registered = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: {
    formatVersion: 1, requestId, classId, number: null, name, organisationName: "OK Last",
    runners: cards.map((cardNumber, index) => ({ givenName: `${name}${index + 1}`, familyName: "Löpare", organisationName: null, cardNumber })) } });
  if (registered.status !== "saved") throw new Error(`Laget kunde inte anmälas: ${registered.status}`);
  return registered.response.teamId;
}

async function readout(proof: Proof, cardNumber: string, from: string, finish: string) {
  const fromMs = Date.parse(from), finishMs = Date.parse(finish);
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: CODES.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (CODES.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok" || ingested.response.acknowledgements[0]?.status !== "stored") throw new Error("Avläsningen togs inte emot");
}

async function entry(proof: Proof, classId: string, courseVersionId: string, givenName: string, cardNumber: string) {
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`,
    request: { formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH", givenName,
      familyName: "Lind", organisationName: "OK Last", cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
}

const card = (cardNumber: string, from: string, finish: string) => ({ cardNumber, startPunchedAt: from, finishPunchedAt: finish,
  punches: CODES.map((code, index) => ({ code, punchedAt: new Date(Date.parse(from) + (index + 1) * 60_000).toISOString() })) });

describe("steg 54: avläsningen läser bara löparens del", () => {
  it("bedömningen med den avgränsade ögonblicksbilden är densamma som med hela tävlingen", async () => {
    const proof = await race();
    const { classId, courseVersionId, courseId } = await course(proof, "Bana");
    for (let index = 0; index < 6; index += 1) await entry(proof, classId, courseVersionId, `Löpare${index}`, String(7_200_001 + index));
    const changeover = await relayClass(proof, courseId, "CHANGEOVER", "Växling");
    await team(proof, changeover, "Ask", ["7200101", "7200102"]);
    await team(proof, changeover, "Björk", ["7200103", "7200104"]);
    // Sträcka 1 i laget Ask är avläst: sträcka 2 har fått sin växling som start.
    await readout(proof, "7200101", at("17:00"), at("17:40"));

    const full = await loadRaceSnapshot(db, proof.raceId);
    expect(full.entries).toHaveLength(10);
    for (const cardNumber of ["7200001", "7200006", "7200102", "7200103", "9999999"]) {
      const scoped = await loadRaceSnapshot(db, proof.raceId, { cardNumber });
      const readoutAt = card(cardNumber, at("17:40"), at("18:20"));
      expect(evaluateCardReadout(readoutAt, scoped)).toEqual(evaluateCardReadout(readoutAt, full));
      // Alla klasser och banor, men bara löparen (eller laget).
      expect(scoped.classes).toEqual(full.classes);
      expect(scoped.courses).toEqual(full.courses);
      expect(scoped.race).toEqual(full.race);
      expect(scoped.entries.length).toBe(cardNumber === "9999999" ? 0 : cardNumber.startsWith("72001") ? 2 : 1);
      expect(scoped.entries.every((row) => full.entries.some((other) => JSON.stringify(other) === JSON.stringify(row)))).toBe(true);
    }
    // Sträcklöparen har kvar sin start ur växlingen i den avgränsade bilden.
    const legs = (await pool.query<{ id: string; team_id: string }>(
      "select e.id, e.team_id from entry e join card_assignment c on c.entry_id = e.id where c.card_number = any($1) order by e.relay_leg",
      [["7200101", "7200102"]])).rows;
    const second = (await loadRaceSnapshot(db, proof.raceId, { cardNumber: "7200102" })).entries.find((row) => row.id === legs[1]!.id);
    expect(second?.fixedStartTime).toBe(at("17:40"));
    // Med deltagare (stafettens omräkning): hela laget kommer med.
    const ids = (await loadRaceSnapshot(db, proof.raceId, { entryIds: [legs[1]!.id] })).entries.map((row) => row.id).sort();
    expect(ids).toEqual(legs.map((row) => row.id).sort());
  });

  it("avläsningar för olika lag i samma klass väntar inte på varandra; samma lag gör det (utan flygande omstart)", async () => {
    const proof = await race();
    const { courseId } = await course(proof, "Stafettbana");
    const changeover = await relayClass(proof, courseId, "CHANGEOVER", "Växling");
    const ask = await team(proof, changeover, "Ask", ["7300101", "7300102"]);
    await team(proof, changeover, "Björk", ["7300103", "7300104"]);
    // En annan avläsning för laget Ask pågår (håller lagets lås i en öppen transaktion).
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [`relay-class:${changeover}`]);
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`relay-team:${ask}`]);
      const timeout = (ms: number) => new Promise<"väntar">((resolve) => setTimeout(() => resolve("väntar"), ms));
      // Laget Björk läses ut direkt.
      expect(await Promise.race([readout(proof, "7300103", at("17:00"), at("17:41")).then(() => "klar" as const), timeout(5_000)])).toBe("klar");
      // Laget Ask väntar tills den andra avläsningen är klar.
      const same = readout(proof, "7300101", at("17:00"), at("17:40")).then(() => "klar" as const);
      expect(await Promise.race([same, timeout(800)])).toBe("väntar");
      await holder.query("commit");
      expect(await same).toBe("klar");
    } finally {
      holder.release();
    }
  });
});
