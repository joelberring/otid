import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { publicResultDetail } from "../../src/results";
import { readControlMapAsAdmin, readEntryControlMapAsAdmin, readPublicRunnerControlMap } from "../../src/control-map";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { accountOnRace } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 52-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg52_karta_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg52_karta_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `karta.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await accountOnRace(db, { ...accountProof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
  return result.response.report;
}

async function entryIds(raceId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ id: string; given_name: string }>("select id, given_name from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.id]));
}


async function readout(proof: Proof, cardNumber: string, codes: readonly number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T17:00:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-10-08T16:01:00.000Z") + index * 60_000).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T17:01:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}


async function register(proof: Proof, className: string, givenName: string, cardNumber: string) {
  const [row] = (await pool.query<{ id: string; course_version_id: string; start_rule: "FIXED" | "PUNCH" }>(
    "select id, course_version_id, start_rule from class where race_id = $1 and name = $2", [proof.raceId, className])).rows;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: row!.id, expectedCourseVersionId: row!.course_version_id, expectedStartRule: row!.start_rule,
    givenName, familyName: "Karta", organisationName: "OK Kartan", cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
}
const publicIdOf = async (entryId: string) =>
  (await pool.query<{ public_result_id: string }>("select public_result_id from entry where id = $1", [entryId])).rows[0]!.public_result_id;

describe("steg 52: kontrollkartan", () => {
  it("ger arbetsytan lägen och belastning, deltagarkortet stämplingarna och publikt bara löparens bana när banorna är publika", async () => {
    const proof = await race();
    await importFile(proof, "course-file-1.xml");
    await register(proof, "H21", "Ada", "12345");
    await register(proof, "H21", "Bo", "67890");
    const ids = await entryIds(proof.raceId);
    await readout(proof, "12345", [31, 32, 33, 34]);

    const map = await readControlMapAsAdmin(db, proof);
    if (map.status !== "ok") throw new Error(`Kontrollkartan saknas: ${map.status}`);
    expect(map.response).toMatchObject({ frame: "GEO", metersPerUnit: 1, map: null });
    expect(map.response.controls.find(control => control.code === 31)).toMatchObject({ courses: 3, variants: 3, planned: 2, punched: 1,
      outOfOrder: false, position: expect.objectContaining({ x: expect.any(Number) as unknown }) as unknown });
    expect(map.response.controls.find(control => control.code === 32)).toMatchObject({ courses: 1, planned: 2, punched: 1 });
    expect(map.response.controls.find(control => control.code === 36)).toMatchObject({ courses: 1, planned: 0, punched: 0 });
    const bana1 = map.response.courses.find(course => course.name === "Bana 1")!;
    expect(bana1).toMatchObject({ classNames: ["H21"], variants: [{ code: null, controlCodes: [31, 32, 33, 34], entryCount: 2 }], forking: null });
    expect(bana1.start).not.toBeNull();
    expect(bana1.finish).not.toBeNull();

    // Bo har en löpare kvar: banorna är hemliga, så inget publikt läge.
    const bo = await publicIdOf(ids.Bo!);
    const ada = await publicIdOf(ids.Ada!);
    expect(await readPublicRunnerControlMap(db, proof.raceId, ada)).toBeUndefined();
    const adaDetail = await publicResultDetail(db, proof.raceId, ada);
    expect(adaDetail.status === "ok" && adaDetail.response.controlMap).toBeFalsy();
    expect((await readPublicRunnerControlMap(db, proof.raceId, ada, { staff: true }))?.legs[0]?.marks?.every(row => row.mark === "OK")).toBe(true);

    // Bo stämplar 34 före 33 och missar 32: 32 saknas, 34 i fel ordning.
    await readout(proof, "67890", [31, 34, 33]);
    const card = await readEntryControlMapAsAdmin(db, { ...proof, entryId: ids.Bo! });
    if (card.status !== "ok") throw new Error("Deltagarkortets karta saknas");
    expect(card.response.legs).toHaveLength(1);
    expect(card.response.legs[0]).toMatchObject({ leg: null, courseName: "Bana 1", controlCodes: [31, 32, 33, 34], marks: [
      { code: 31, mark: "OK" }, { code: 32, mark: "MISSING", previous: 31, next: 33 }, { code: 33, mark: "OK" },
      { code: 34, mark: "WRONG_ORDER", previous: 33, next: "M" }] });

    // Alla har resultat: banorna är publika. Löparens karta har bara löparens kontroller och ingen belastning.
    const published = await readPublicRunnerControlMap(db, proof.raceId, bo);
    expect(published?.controls.map(control => control.code)).toEqual([31, 32, 33, 34]);
    expect(JSON.stringify(published)).not.toMatch(/planned|punched|Ada|Bana 2/);
    expect(published?.legs[0]?.marks?.find(row => row.code === 32)?.mark).toBe("MISSING");
    const boDetail = await publicResultDetail(db, proof.raceId, bo);
    expect(boDetail.status === "ok" && boDetail.response.controlMap).toBe(true);
    expect(await readPublicRunnerControlMap(db, proof.raceId, "00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("använder kartlägena med kartans skala när WGS 84 saknas, och klarar en bana utan lägen", async () => {
    const proof = await race();
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
      <Event><Name>Papper</Name></Event><RaceCourseData><Map><Scale>10000</Scale></Map>
      <Control type="Start"><Id>S1</Id><MapPosition x="0" y="0" unit="mm"/></Control>
      <Control><Id>41</Id><MapPosition x="30" y="40" unit="mm"/></Control>
      <Control><Id>42</Id></Control>
      <Control type="Finish"><Id>F1</Id><MapPosition x="10" y="0" unit="mm"/></Control>
      <Course><Name>Papperbana</Name><CourseControl type="Start"><Control>S1</Control></CourseControl>
        <CourseControl><Control>41</Control></CourseControl><CourseControl><Control>42</Control></CourseControl>
        <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
      <ClassCourseAssignment><ClassName>Öppen</ClassName><CourseName>Papperbana</CourseName></ClassCourseAssignment>
      </RaceCourseData></CourseData>`);
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: xml });
    expect(imported.status).toBe("stored");
    const map = await readControlMapAsAdmin(db, proof);
    if (map.status !== "ok") throw new Error("Kontrollkartan saknas");
    expect(map.response).toMatchObject({ frame: "PAPER", metersPerUnit: 1 });
    // 1:10 000 och y uppåt i filen: 30 mm öst och 40 mm norr = 300 m höger och 400 m upp.
    expect(map.response.controls.find(control => control.code === 41)?.position).toEqual({ x: 300, y: -400 });
    expect(map.response.controls.find(control => control.code === 42)?.position).toBeNull();
    expect(map.response.courses[0]).toMatchObject({ start: { x: 0, y: -0 }, finish: { x: 100, y: -0 } });
  });
});
