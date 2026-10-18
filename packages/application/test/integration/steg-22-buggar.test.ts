import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { createManualClassAsAdministrator } from "../../src/manual-class";
import { editClassAsAdministrator } from "../../src/class-edit";
import { createRelayClassAsAdministrator } from "../../src/relay-admin";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { listAdministratorForestWatch } from "../../src/start-checkin-roster";
import { registerTestAccount } from "./accounts";

/**
 * PLAN.md steg 22: dubbla klass- och bannamn avvisas i varje skrivväg (och av databasen), avläsningen bär klockan
 * bakom tiderna, resultatet får motorversionen, banfilen avvisar en bana med samma namn som en manuell bana och
 * skogsrapporten bär tävlingsdagen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg22_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg22_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

async function newRace(raceDate = "2026-10-08"): Promise<Proof> {
  const owner = (await registerTestAccount(db)).proof;
  const created = await createEventAsUserAccount(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: `Träning ${randomUUID().slice(0, 6)}`, raceName: "Torsdag", raceDate,
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await enterRaceAsUserAccount(db, { ...owner, raceId: created.response.raceId });
  if (entered.status !== "entered") throw new Error(`Kom inte in i tävlingen: ${entered.status}`);
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function courseClass(proof: Proof, courseName: string, className: string, controlCodes = [31, 32, 33]) {
  const requestId = randomUUID();
  return createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseName, className,
      startRule: "PUNCH", controlCodes } });
}

async function classOnCourse(proof: Proof, courseVersionId: string, className: string) {
  const requestId = randomUUID();
  return createManualClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseVersionId, className, startRule: "PUNCH" } });
}

describe("steg 22: dubbla namn", () => {
  it("avvisar dubbla klass- och bannamn oavsett skiftläge i alla skrivvägar och i databasen", async () => {
    const proof = await newRace();
    const first = await courseClass(proof, "Lång", "H21");
    expect(first.status).toBe("created");
    if (first.status !== "created") return;
    expect((await courseClass(proof, "lång", "D21")).status).toBe("duplicate-name");
    expect((await courseClass(proof, "Kort", "h21")).status).toBe("duplicate-name");
    expect((await classOnCourse(proof, first.response.courseVersionId, "H21")).status).toBe("duplicate-name");
    const second = await classOnCourse(proof, first.response.courseVersionId, "D21");
    expect(second.status).toBe("created");
    if (second.status !== "created") return;
    // Byte av namn till ett som finns.
    const requestId = randomUUID();
    const edited = await editClassAsAdministrator(db, { ...proof, idempotencyKey: `class-edit:${requestId}`, request: {
      formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), classId: second.response.classId,
      className: "H21", courseId: first.response.courseId, startRule: "PUNCH", confirmResultChanges: false } });
    expect(edited.status).toBe("duplicate-name");
    // Stafettklass med samma namn.
    const relayId = randomUUID();
    const relay = await createRelayClassAsAdministrator(db, { ...proof, idempotencyKey: `relay-class:${relayId}`, request: {
      formatVersion: 1, requestId: relayId, expectedSnapshotVersion: await snapshot(proof.raceId), courseId: first.response.courseId,
      name: "d21", legs: [{ leg: 1, startMethod: "MASS_START", startTime: "2026-10-08T16:00:00.000Z", variantCode: null },
        { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null }] } });
    expect(relay.status).toBe("duplicate-name");
    // Databasen är sista spärren.
    await expect(pool.query("insert into class (race_id, name, course_version_id) values ($1, 'H21', $2)",
      [proof.raceId, first.response.courseVersionId])).rejects.toThrow(/class_race_name_uidx/);
    await expect(pool.query("insert into course (race_id, name) values ($1, 'LÅNG')", [proof.raceId])).rejects.toThrow(/course_race_name_uidx/);
  });

  it("avvisar en banfil vars bana heter som en manuell bana, med banans namn i felet", async () => {
    const proof = await newRace();
    const xml = await readFile(new URL("iof/course-data.xml", fixtures), "utf8");
    const match = /<Name>([^<]+)<\/Name>/.exec(xml.slice(xml.indexOf("<Course>")));
    if (!match) throw new Error("Banfilen saknar bana");
    expect((await courseClass(proof, match[1]!, "Egen")).status).toBe("created");
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: Buffer.from(xml) });
    expect(imported).toEqual({ status: "invalid-iof-xml", issues: [`Banan "${match[1]}" finns redan i tävlingen`] });
  });
});

describe("steg 22: avläsningens klocka och motorversion", () => {
  it("sparar klockkälla och avvikelse på avläsningen och motorversionen på resultatet", async () => {
    const proof = await newRace();
    const created = await courseClass(proof, "Lång", "H21");
    if (created.status !== "created") throw new Error(created.status);
    const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: created.response.classId, expectedCourseVersionId: created.response.courseVersionId, expectedStartRule: "PUNCH",
      expectedSnapshotVersion: await snapshot(proof.raceId), givenName: "Anna", familyName: "Löpare", organisationName: "OK Test",
      cardNumber: "8123456", fixedStartTime: null } });
    if (registered.status !== "registered") throw new Error(registered.status);
    const at = (minute: number) => new Date(Date.parse("2026-10-08T16:00:00.000Z") + minute * 60_000).toISOString();
    // Dubbelstämpling vid 31 och en extra stämpling av 33 före rätt följd: godkänd med motor 0.3.0.
    const codes = [31, 31, 33, 32, 33];
    const payload: SportidentReadoutPayload = { cardNumber: "8123456", cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(30),
      punches: codes.map((code, index) => ({ code, punchedAt: at(index + 1) })), untimedPunchCodes: [], frames: ["02ef8300"],
      stationSerial: 999001, clockSource: "station", clockOffsetMs: -840_000, simulated: false };
    const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
      firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: at(31), transport: "sportident", payload, contentHash: contentHash(payload) }] };
    const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
    expect(ingested.status).toBe("ok");
    const [readout] = (await pool.query<{ clock_source: string | null; clock_offset_ms: number | null }>(
      "select clock_source, clock_offset_ms from card_readout where race_id = $1", [proof.raceId])).rows;
    expect(readout).toEqual({ clock_source: "station", clock_offset_ms: -840_000 });
    const [result] = (await pool.query<{ status: string; engine_version: string; evaluation: { extraPunches: number[] } }>(
      "select status::text, engine_version, evaluation from result_revision where entry_id = $1", [registered.response.entryId])).rows;
    expect(result).toMatchObject({ status: "OK", engine_version: RESULT_ENGINE_VERSION, evaluation: { extraPunches: [31, 33] } });
    expect(RESULT_ENGINE_VERSION).toBe("0.3.0");
    // Skogsrapporten bär tävlingsdagen så att kvar i skogen kan räknas från den.
    const forest = await listAdministratorForestWatch(db, proof);
    expect(forest.status === "ok" && forest.response.raceDate).toBe("2026-10-08");
  });
});
