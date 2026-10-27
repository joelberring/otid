import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { sportidentReadoutPayloadSchema, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { accountOnRace } from "./accounts";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { publicResults } from "../../src/results";
import { publicRelayResults } from "../../src/relay-results";
import { loadPlacementSubjects, placementFrom } from "../../src/readout-placement";

/**
 * Steg 57: placeringen på avläsningens kvitto, räknad ur resultatlistan (som webben cachar per tävlingsversion) med
 * avläsningens resultat inlagt: placering bland godkända, lika tid, ej godkända och stafett (laget efter sträckan).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 57-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg57_place_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg57_place_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const CODES = [31, 32, 33];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg57.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
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

async function readout(proof: Proof, cardNumber: string, from: string, finish: string, options: { start?: boolean; codes?: number[] } = {}) {
  const fromMs = Date.parse(from), finishMs = Date.parse(finish);
  const codes = options.codes ?? CODES;
  const payload: SportidentReadoutPayload = sportidentReadoutPayloadSchema.parse({ cardNumber, cardType: "SI10", finishPunchedAt: finish,
    ...(options.start ? { startPunchedAt: from } : {}),
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (codes.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true });
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  const ack = ingested.status === "ok" ? ingested.response.acknowledgements[0] : undefined;
  if (ack?.status !== "stored" || !ack.serverResult || !("resultRevisionId" in ack.serverResult)) throw new Error(`Avläsningen togs inte emot: ${JSON.stringify(ack)}`);
  const subject = (await loadPlacementSubjects(db, proof.raceId, [ack.serverResult.resultRevisionId])).get(ack.serverResult.resultRevisionId);
  if (!subject) throw new Error("Resultatet saknas");
  return subject;
}

async function entry(proof: Proof, classId: string, courseVersionId: string, givenName: string, cardNumber: string) {
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`,
    request: { formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH", givenName,
      familyName: "Lind", organisationName: "OK Last", cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
}

const staff = (raceId: string) => publicResults(db, raceId, { staff: true });

describe("steg 57: placering vid avläsningen", () => {
  it("placering bland godkända, lika tid och ingen placering för felstämplad", async () => {
    const proof = await race();
    const { classId, courseVersionId } = await course(proof, "Bana");
    for (const [name, cardNumber] of [["Ada", "7400001"], ["Bo", "7400002"], ["Cia", "7400003"], ["Dan", "7400004"]] as const) {
      await entry(proof, classId, courseVersionId, name, cardNumber);
    }
    const ada = await readout(proof, "7400001", at("17:00"), at("17:30"), { start: true });
    expect(placementFrom({ subject: ada, results: await staff(proof.raceId), recent: [] }))
      .toEqual({ kind: "individual", standing: { position: 1, tied: false, finished: 1 } });
    // Listan räknades före Bos avläsning (som i webbens cache): Bos resultat läggs in.
    const before = await staff(proof.raceId);
    const bo = await readout(proof, "7400002", at("17:01"), at("17:33"), { start: true });
    expect(placementFrom({ subject: bo, results: before, recent: [] })).toEqual({ kind: "individual",
      standing: { position: 2, tied: false, finished: 2, leader: { name: "Ada Lind", behindMs: 120_000 } } });
    expect(placementFrom({ subject: bo, results: await staff(proof.raceId), recent: [] })).toEqual(placementFrom({ subject: bo, results: before, recent: [] }));
    // Lika tid som Ada: delad ledning.
    const cia = await readout(proof, "7400003", at("17:02"), at("17:32"), { start: true });
    expect(placementFrom({ subject: cia, results: await staff(proof.raceId), recent: [] })).toEqual({ kind: "individual",
      standing: { position: 1, tied: true, finished: 3, leader: { name: "Ada Lind", behindMs: 0 } } });
    // Felstämplad: ingen placering, och Bo är fortfarande trea av tre.
    const dan = await readout(proof, "7400004", at("17:03"), at("17:20"), { start: true, codes: [31, 33] });
    expect(dan.status).toBe("MP");
    expect(placementFrom({ subject: dan, results: await staff(proof.raceId), recent: [] })).toBeUndefined();
    expect(placementFrom({ subject: bo, results: await staff(proof.raceId), recent: [] })).toMatchObject({ standing: { position: 3, finished: 3 } });
  });

  it("stafett: lagets placering efter sträckan och sträcktiden mot bästa på sträckan", async () => {
    const proof = await race();
    const { courseId } = await course(proof, "Stafettbana");
    const relay = await relayClass(proof, courseId, "CHANGEOVER", "Stafett");
    await team(proof, relay, "Ask", ["7500101", "7500102"]);
    await team(proof, relay, "Björk", ["7500103", "7500104"]);
    await readout(proof, "7500101", at("17:00"), at("17:40"));
    const bjorkFirst = await readout(proof, "7500103", at("17:00"), at("17:38"));
    expect(placementFrom({ subject: bjorkFirst, relay: await publicRelayResults(db, proof.raceId), recent: [] })).toEqual({ kind: "relay", leg: 1,
      team: { position: 1, tied: false, finished: 2, ahead: { ms: 120_000 } },
      legTime: { position: 1, tied: false, finished: 2, ahead: { ms: 120_000 }, elapsedMs: 38 * 60_000 } });
    // Asks andra sträcka: 30 min (Ask 70 min efter sträcka 2, ensamt i mål efter sträcka 2).
    const askSecond = await readout(proof, "7500102", at("17:40"), at("18:10"));
    expect(placementFrom({ subject: askSecond, relay: await publicRelayResults(db, proof.raceId), recent: [] })).toEqual({ kind: "relay", leg: 2,
      team: { position: 1, tied: false, finished: 1 }, legTime: { position: 1, tied: false, finished: 1, elapsedMs: 30 * 60_000 } });
    // Björks andra sträcka: 35 min; laget 73 min, tvåa efter sträcka 2, 3 min efter Ask, sträcktiden 5 min efter bästa.
    const relayBefore = await publicRelayResults(db, proof.raceId);
    const bjorkSecond = await readout(proof, "7500104", at("17:38"), at("18:13"));
    const expected = { kind: "relay", leg: 2, team: { position: 2, tied: false, finished: 2, leader: { name: "Ask", behindMs: 180_000 } },
      legTime: { position: 2, tied: false, finished: 2, leader: { name: "Ask", behindMs: 300_000 }, elapsedMs: 35 * 60_000 } };
    expect(placementFrom({ subject: bjorkSecond, relay: await publicRelayResults(db, proof.raceId), recent: [] })).toEqual(expected);
    // Ur en lista räknad före avläsningen, med resultatet inlagt: samma placering.
    expect(placementFrom({ subject: bjorkSecond, relay: relayBefore, recent: [] })).toEqual(expected);
  });
});
