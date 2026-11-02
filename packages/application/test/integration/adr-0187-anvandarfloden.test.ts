import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { commitStartDrawAsAdmin } from "../../src/start-draw";
import { saveRaceSettingsAsAdmin } from "../../src/race-settings";
import { previewRaceDateMoveAsAdmin } from "../../src/race-date-move";
import { importIofXml } from "../../src/import-iof";
import { accountOnRace } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0187-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0187_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0187_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };
const RACE_DATE = "2027-10-07";
/** 10:00 i Stockholm (sommartid) tävlingsdagen. */
const FIRST_START = "2027-10-07T08:00:00.000Z";

async function account(): Promise<AccountProof> {
  const created = await registerUserAccount(db, { formatVersion: 1, email: `flode.${randomUUID().slice(0, 8)}@test.o-tid.se`,
    displayName: "Arrangör", password: "hemligt-lösen" });
  if (created.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  return { sessionToken: created.sessionToken, csrfCookie: created.csrfToken, csrfHeader: created.csrfToken };
}

async function race(proof: AccountProof, body: Record<string, unknown> = {}): Promise<Proof> {
  const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbtävling", raceName: "Torsdag", raceDate: RACE_DATE,
      timeZone: "Europe/Stockholm", ...body }) });
  if (created.status !== "created") throw new Error(created.status);
  const entered = await accountOnRace(db, { ...proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function courseClass(proof: Proof, className: string, controlCodes: number[]) {
  const requestId = randomUUID();
  const result = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: `Bana ${className}`, className, startRule: "PUNCH", controlCodes } });
  if (result.status !== "created") throw new Error(result.status);
  const row = (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [result.response.classId])).rows[0]!;
  return { classId: result.response.classId!, courseVersionId: row.course_version_id };
}

async function entry(proof: Proof, target: { classId: string; courseVersionId: string }, givenName: string, cardNumber: string) {
  const startRule = (await pool.query<{ start_rule: "FIXED" | "PUNCH" }>("select start_rule from class where id = $1", [target.classId])).rows[0]!.start_rule;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: target.classId, expectedCourseVersionId: target.courseVersionId, expectedStartRule: startRule,
    givenName, familyName: "Testsson", organisationName: "OK Påhitt", cardNumber, fixedStartTime: null } }, new Date());
  if (registered.status !== "registered") throw new Error(registered.status);
}

async function draw(proof: Proof, classIds: string[]) {
  const requestId = randomUUID();
  const result = await commitStartDrawAsAdmin(db, { ...proof, idempotencyKey: `start-draw:${requestId}`, request: { formatVersion: 1, requestId,
    seed: 4711, firstStartTime: FIRST_START, clubSeparation: false, confirmChanges: true,
    classes: classIds.map(classId => ({ classId, method: "MINUTE", intervalMinutes: 2, vacancies: { kind: "COUNT", value: 1 } })) } });
  if (result.status !== "drawn") throw new Error(result.status);
}

function settings(proof: Proof, raceDate: string, extra: Record<string, unknown> = {}) {
  const requestId = randomUUID();
  return saveRaceSettingsAsAdmin(db, { ...proof, idempotencyKey: `race-settings:${requestId}`, request: { formatVersion: 1, requestId,
    eventName: "Klubbtävling", raceName: "Torsdag", raceDate, raceType: "STANDARD", ...extra } });
}

const clocks = async (raceId: string) => (await pool.query<{ t: string }>(
  "select to_char(fixed_start_time at time zone 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') as t from entry where race_id = $1 order by fixed_start_time", [raceId]))
  .rows.map(row => row.t);

describe("ADR-0187: lottningens första start och datumflytt", () => {
  it("lottningen sätter tävlingens första start (samma värde som Inställningar visar)", async () => {
    const proof = await race(await account());
    const h21 = await courseClass(proof, "H21", [31, 32]);
    await entry(proof, h21, "Alva", "8100001");
    await draw(proof, [h21.classId]);
    expect((await pool.query("select first_start_time from race where id = $1", [proof.raceId])).rows[0]).toEqual({ first_start_time: "10:00" });
  });

  it("flyttar starttiderna och lottningen till det nya datumet med samma klockslag, med journal", async () => {
    const proof = await race(await account());
    const h21 = await courseClass(proof, "H21", [31, 32]);
    const d21 = await courseClass(proof, "D21", [41, 42]);
    for (const [index, name] of ["Alva", "Bo", "Cia"].entries()) await entry(proof, h21, name, `810010${index}`);
    for (const [index, name] of ["Dan", "Eja"].entries()) await entry(proof, d21, name, `810020${index}`);
    await draw(proof, [h21.classId, d21.classId]);
    const before = await clocks(proof.raceId);
    expect(before.every(time => time.startsWith("2027-10-07 10:"))).toBe(true);

    // Vintertid det nya datumet: klockslagen står kvar, förskjutningen mot UTC ändras.
    const preview = await previewRaceDateMoveAsAdmin(db, { ...proof, request: { formatVersion: 1, raceDate: "2027-11-04" } });
    expect(preview).toMatchObject({ status: "ok", response: { fromDate: RACE_DATE, toDate: "2027-11-04", startTimeCount: 5, drawClassCount: 2,
      relayLegCount: 0, blocked: [], startListPublished: false, firstBefore: FIRST_START, firstAfter: "2027-11-04T09:00:00.000Z" } });
    // Utan bekräftelse ändras inget datum.
    expect(await settings(proof, "2027-11-04")).toEqual({ status: "conflict" });
    expect(await clocks(proof.raceId)).toEqual(before);

    expect(await settings(proof, "2027-11-04", { moveStartTimes: true })).toMatchObject({ status: "saved" });
    expect(await clocks(proof.raceId)).toEqual(before.map(time => time.replace("2027-10-07", "2027-11-04")));
    const slots = await pool.query<{ ok: boolean }>(`select bool_and(to_char(s.start_time at time zone 'Europe/Stockholm', 'YYYY-MM-DD') = '2027-11-04') as ok
      from start_draw_slot s join class c on c.start_draw_id = s.draw_id and c.id = s.class_id where c.race_id = $1`, [proof.raceId]);
    expect(slots.rows[0]).toEqual({ ok: true });
    const firsts = await pool.query<{ first_start_time: Date }>(`select d.first_start_time from start_draw_class d join class c on c.start_draw_id = d.draw_id and c.id = d.class_id
      where c.race_id = $1`, [proof.raceId]);
    expect(firsts.rows.map(row => row.first_start_time.toISOString())).toEqual(["2027-11-04T09:00:00.000Z", "2027-11-04T09:00:00.000Z"]);
    const journal = await pool.query<{ action: string; n: number }>(`select action, count(*)::int as n from audit_event where race_id = $1
      and action in ('RACE_DATE_MOVED_WITH_START_TIMES', 'ENTRY_START_TIME_MOVED_WITH_RACE_DATE') group by action order by action`, [proof.raceId]);
    expect(journal.rows).toEqual([{ action: "ENTRY_START_TIME_MOVED_WITH_RACE_DATE", n: 5 }, { action: "RACE_DATE_MOVED_WITH_START_TIMES", n: 1 }]);
    expect((await pool.query("select race_date::text from race where id = $1", [proof.raceId])).rows[0]).toEqual({ race_date: "2027-11-04" });
  });

  it("stoppar flytten när någon har läst ut", async () => {
    const proof = await race(await account());
    const h21 = await courseClass(proof, "H21", [31, 32]);
    await entry(proof, h21, "Alva", "8100301");
    await draw(proof, [h21.classId]);
    const payload: SportidentReadoutPayload = { cardNumber: "8100301", cardType: "SI10", startPunchedAt: "2027-10-07T08:00:00.000Z",
      finishPunchedAt: "2027-10-07T08:30:00.000Z", punches: [{ code: 31, punchedAt: "2027-10-07T08:10:00.000Z" }, { code: 32, punchedAt: "2027-10-07T08:20:00.000Z" }],
      untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
    const version = (await pool.query<{ v: number }>("select snapshot_version as v from race where id = $1", [proof.raceId])).rows[0]!.v;
    const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2027-10-07T08:31:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
    expect((await ingestReadoutsAsAdmin(db, { ...proof, batch })).status).toBe("ok");
    const preview = await previewRaceDateMoveAsAdmin(db, { ...proof, request: { formatVersion: 1, raceDate: "2027-10-14" } });
    expect(preview).toMatchObject({ status: "ok", response: { blocked: ["READOUTS", "RESULTS"] } });
    expect(await settings(proof, "2027-10-14", { moveStartTimes: true })).toEqual({ status: "conflict" });
    expect((await pool.query("select race_date::text from race where id = $1", [proof.raceId])).rows[0]).toEqual({ race_date: RACE_DATE });
  });

  it("utan starttider ändras datumet direkt, som förut", async () => {
    const proof = await race(await account());
    await courseClass(proof, "H21", [31, 32]);
    expect(await settings(proof, "2027-10-14")).toMatchObject({ status: "saved" });
  });

});

describe("ADR-0187 beslut 4: startsätt för importerade klasser", () => {
  const courseData = `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-10-01T08:00:00Z" creator="O-Tid test">
  <Event><Name>Påhittad</Name></Event><RaceCourseData>
  <Control type="Start"><Id>S</Id></Control><Control><Id>31</Id></Control><Control type="Finish"><Id>M</Id></Control>
  <Course><Id>bana-1</Id><Name>Bana 1</Name><CourseControl type="Start"><Control>S</Control></CourseControl>
    <CourseControl type="Control"><Control>31</Control></CourseControl><CourseControl type="Finish"><Control>M</Control></CourseControl></Course>
  <ClassCourseAssignment><ClassId>k1</ClassId><ClassName>H21</ClassName><CourseName>Bana 1</CourseName></ClassCourseAssignment>
  </RaceCourseData></CourseData>`;
  const startRule = async (raceId: string) => (await pool.query<{ start_rule: string }>("select start_rule from class where race_id = $1", [raceId]))
    .rows.map(row => row.start_rule);

  it("ger lottad start i en vanlig Tävling och fri start i en träning", async () => {
    const competition = await race(await account());
    await importIofXml(db, competition.raceId, courseData);
    expect(await startRule(competition.raceId)).toEqual(["FIXED"]);
    const training = await race(await account(), { raceType: "TRAINING" });
    await importIofXml(db, training.raceId, courseData);
    expect(await startRule(training.raceId)).toEqual(["PUNCH"]);
  });
});
