import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { listCoursesForEditAsAdministrator } from "../../src/course-edit";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "../../src/readout-station";
import {
  changeRelayLegRunnerAsAdministrator, createRelayClassAsAdministrator, registerRelayTeamAsAdministrator, setRelayStartTimesAsAdministrator
} from "../../src/relay-admin";
import { getRelayOverviewAsAdministrator, publicRelayResults } from "../../src/relay-results";
import { publicResults } from "../../src/results";
import { exportIofResultListAsAdmin, exportPublicIofResultList } from "../../src/result-list-export";
import { exportCurrentStartListXmlAsAdmin } from "../../src/start-list-publication";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_relay_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_adr0169_relay_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const minutes = (value: number) => value * 60_000;
const CONTROLS = [31, 32, 33, 34];

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `stafett.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbstafett", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof): Promise<string> {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseName: "Stafettbana",
      className: "Inskolning", startRule: "PUNCH", controlCodes: CONTROLS } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response.courseId;
}

async function relayClass(proof: Proof, courseId: string, legs: { startMethod: "MASS_START" | "CHANGEOVER" | "RESTART"; startTime: string | null;
  variantCode?: string }[]) {
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), name: "Stafett", courseId,
    legs: legs.map((leg, index) => ({ leg: index + 1, variantCode: null, ...leg })) };
  const created = await createRelayClassAsAdministrator(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  const replay = await createRelayClassAsAdministrator(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request });
  expect(replay).toMatchObject({ status: "saved", response: { replayed: true, classId: created.response.classId } });
  return created.response.classId;
}

async function team(proof: Proof, classId: string, name: string, cards: string[], number: number | null = null) {
  const requestId = randomUUID();
  const registered = await registerRelayTeamAsAdministrator(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: {
    formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), classId, number, name, organisationName: "OK Test",
    runners: cards.map((cardNumber, index) => ({ givenName: `${name.split(" ").at(-1)}${index + 1}`, familyName: "Löpare",
      organisationName: null, cardNumber })) } });
  if (registered.status !== "saved") throw new Error(`Laget kunde inte anmälas: ${registered.status}`);
  return registered.response;
}

/** En avläsning: kontrollerna jämnt mellan `from` och målet. */
async function readout(proof: Proof, cardNumber: string, finish: string, codes = CONTROLS, from = finish) {
  const finishMs = Date.parse(finish), fromMs = Math.min(Date.parse(from), finishMs - minutes(10));
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (codes.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
  const acknowledgement = ingested.response.acknowledgements[0];
  if (!acknowledgement || acknowledgement.status === "rejected" || !acknowledgement.serverResult) throw new Error("Avläsningen saknar bedömning");
  return acknowledgement.serverResult;
}

async function legs(raceId: string) {
  const rows = (await pool.query<{ number: number; relay_leg: number; fixed_start_time: Date | null; given_name: string; id: string; version: number }>(
    `select t.number, e.relay_leg, e.fixed_start_time, e.given_name, e.id, e.version from entry e join team t on t.id = e.team_id
     where e.race_id = $1 order by t.number, e.relay_leg`, [raceId])).rows;
  return Object.fromEntries(rows.map(row => [`${row.number}.${row.relay_leg}`, { id: row.id, version: row.version, name: row.given_name,
    start: row.fixed_start_time?.toISOString() ?? null }]));
}

const revisions = async (entryId: string) => (await pool.query<{ status: string; reason: string; cause: string }>(
  "select status, reason, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;

describe("ADR-0169 stafett", () => {
  it("klubbstafett: växling, avläsning i fel ordning, felstämplad sträcka, byte av löpare, omstart, lagresultat och export", async () => {
    const proof = await race();
    const courseId = await course(proof);
    const classId = await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", startTime: null }, { startMethod: "RESTART", startTime: at("18:30") }]);
    const one = await team(proof, classId, "OK Test 1", ["8101", "8102", "8103"]);
    const two = await team(proof, classId, "OK Test 2", ["8201", "8202", "8203"]);
    const three = await team(proof, classId, "OK Test 3", ["8301", "8302", "8303"], 12);
    expect([one.number, two.number, three.number]).toEqual([1, 2, 12]);

    // Brickan används redan av en sträcklöpare: laget anmäls inte. Enskild anmälan i stafettklassen nekas.
    await expect(team(proof, classId, "OK Dubbel", ["8101", "8902", "8903"])).rejects.toThrow("conflict");
    const individual = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId, expectedCourseVersionId: (await pool.query<{ course_version_id: string }>(
        "select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id, expectedStartRule: "FIXED",
      expectedSnapshotVersion: await snapshot(proof.raceId), givenName: "Ensam", familyName: "Löpare", organisationName: null,
      cardNumber: null, fixedStartTime: at("17:00") } });
    expect(individual.status).toBe("conflict");

    // Sträcka 1 masstart, sträcka 2 väntar på växlingen, sträcka 3 har omstartstiden tills föregående sträcka gått i mål.
    let starts = await legs(proof.raceId);
    expect([starts["1.1"]!.start, starts["1.2"]!.start, starts["1.3"]!.start]).toEqual([at("17:00"), null, at("18:30")]);

    // Lag 1: växling 17:30 och 18:05, sträcka 3 byter löpare före avläsningen.
    expect(await readout(proof, "8101", at("17:30"))).toMatchObject({ status: "OK" });
    expect((await legs(proof.raceId))["1.2"]!.start).toBe(at("17:30"));
    expect(await readout(proof, "8102", at("18:05"), CONTROLS, at("17:30"))).toMatchObject({ status: "OK" });
    starts = await legs(proof.raceId);
    expect(starts["1.3"]!.start).toBe(at("18:05"));
    const changeId = randomUUID();
    const changed = await changeRelayLegRunnerAsAdministrator(db, { ...proof, idempotencyKey: `relay-leg-runner:${changeId}`, request: {
      formatVersion: 1, requestId: changeId, expectedSnapshotVersion: await snapshot(proof.raceId), teamId: one.teamId, leg: 3,
      expectedEntryVersion: starts["1.3"]!.version, runner: { givenName: "Bytt", familyName: "Löpare", organisationName: "OK Test", cardNumber: "8109" } } });
    expect(changed).toMatchObject({ status: "saved", response: { leg: 3, entryId: starts["1.3"]!.id } });
    expect(await readout(proof, "8103", at("18:40"))).toMatchObject({ status: "UNKNOWN_CARD" });
    expect(await readout(proof, "8109", at("18:40"), CONTROLS, at("18:05"))).toMatchObject({ status: "OK" });

    // Lag 2: sträcka 2 läses av före sträcka 1 (saknar start), räknas om när sträcka 1 läses av. Sträcka 3 felstämplad.
    expect(await readout(proof, "8202", at("18:10"), CONTROLS, at("17:40"))).toMatchObject({ status: "MP", reason: "MISSING_START" });
    expect((await legs(proof.raceId))["2.3"]!.start).toBe(at("18:10"));
    expect(await readout(proof, "8201", at("17:35"))).toMatchObject({ status: "OK" });
    starts = await legs(proof.raceId);
    expect(starts["2.2"]!.start).toBe(at("17:35"));
    expect((await revisions(starts["2.2"]!.id)).map(row => `${row.status}:${row.cause}`)).toEqual(["MP:CARD_READOUT", "OK:EXPLICIT_RECALCULATION"]);
    expect(await readout(proof, "8203", at("18:45"), [31, 32, 34], at("18:10"))).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    // Lag 12: sträcka 2 växlar 18:45, efter omstarten 18:30. Sträcka 3 startade i omstarten.
    expect(await readout(proof, "8301", at("17:40"))).toMatchObject({ status: "OK" });
    expect(await readout(proof, "8302", at("18:45"), CONTROLS, at("17:40"))).toMatchObject({ status: "OK" });
    expect((await legs(proof.raceId))["12.3"]!.start).toBe(at("18:30"));
    expect(await readout(proof, "8303", at("19:00"), CONTROLS, at("18:46"))).toMatchObject({ status: "OK" });

    // Lagresultat: lag 1 (30+35+35) före lag 12 (40+65+30, summan av sträcktiderna), lag 2 felstämplat och orankat.
    let published = await publicRelayResults(db, proof.raceId);
    let relay = published.classes[0]!;
    expect(relay.teams.map(row => [row.number, row.status, row.position, row.elapsedMs])).toEqual([
      [1, "OK", 1, minutes(100)], [12, "OK", 2, minutes(135)], [2, "MP", null, null]]);
    expect(relay.teams[1]!.legs.map(leg => leg.restarted)).toEqual([false, false, true]);
    expect(relay.teams[0]!.legs[2]).toMatchObject({ givenName: "Bytt", status: "OK", elapsedMs: minutes(35) });
    expect(relay.legs.map(leg => leg.results.map(row => [row.teamNumber, row.position, row.status]))).toEqual([
      [[1, 1, "OK"], [2, 2, "OK"], [12, 3, "OK"]],
      [[1, 1, "OK"], [2, 1, "OK"], [12, 3, "OK"]],
      [[12, 1, "OK"], [1, 2, "OK"], [2, null, "MP"]]]);

    // Ändrad omstartstid: lag 12 växlade 18:45 före den nya omstarten 18:50, så sträcka 3 räknas om.
    const timesId = randomUUID();
    const times = await setRelayStartTimesAsAdministrator(db, { ...proof, idempotencyKey: `relay-start-times:${timesId}`, request: {
      formatVersion: 1, requestId: timesId, expectedSnapshotVersion: await snapshot(proof.raceId), classId,
      legs: [{ leg: 3, startTime: at("18:50") }] } });
    expect(times).toMatchObject({ status: "saved", response: { recalculatedCount: 1 } });
    published = await publicRelayResults(db, proof.raceId);
    relay = published.classes[0]!;
    expect(relay.teams.map(row => [row.number, row.elapsedMs])).toEqual([[1, minutes(100)], [12, minutes(120)], [2, null]]);
    expect(relay.teams[1]!.legs[2]!.restarted).toBe(false);

    // Lagvyn: ett nytt lag är ute på sträcka 1; sträcklöparna syns med bricka.
    await team(proof, classId, "OK Test 4", ["8401", "8402", "8403"]);
    const overview = await getRelayOverviewAsAdministrator(db, proof);
    if (overview.status !== "ok") throw new Error("Lagvyn saknas");
    expect(overview.response.classes[0]).toMatchObject({ name: "Stafett", teamCount: 4, legs: [{ startMethod: "MASS_START" },
      { startMethod: "CHANGEOVER" }, { startMethod: "RESTART", startTime: at("18:50") }] });
    expect(overview.response.teams.map(row => [row.number, row.status, row.currentLeg])).toEqual([
      [1, "OK", null], [2, "MP", null], [12, "OK", null], [13, "RUNNING", 1]]);
    expect(overview.response.teams[0]!.legs[2]).toMatchObject({ givenName: "Bytt", cardNumber: "8109" });

    // Avläsningspaketet bär stafetten; deltagarlistan visar lag och sträcka; individuella resultat visar inte sträcklöpare.
    const pkg = await readReadoutPackageAsAdministrator(db, proof);
    if (pkg.status !== "ok") throw new Error("Paketet saknas");
    expect(pkg.response.relay?.teams).toHaveLength(4);
    expect(pkg.response.relay?.legResults.find(row => row.entryId === starts["2.2"]!.id)).toMatchObject({ status: "OK",
      finishTime: at("18:10"), elapsedMs: minutes(35) });
    const roster = await listEntryTransfersAsAdministrator(db, proof);
    if (roster.status !== "ok") throw new Error("Deltagarlistan saknas");
    expect(roster.response.classes.find(row => row.id === classId)?.relayLegCount).toBe(3);
    expect(roster.response.entries.find(row => row.id === starts["1.3"]!.id)?.relay).toMatchObject({ teamNumber: 1, leg: 3 });
    expect((await publicResults(db, proof.raceId)).results.some(row => row.className === "Stafett")).toBe(false);

    // IOF XML ResultList: TeamResult med TeamMemberResult per sträcka och lagets OverallResult (lag 13 är ute på sträcka 2).
    expect(await readout(proof, "8401", at("17:50"))).toMatchObject({ status: "OK" });
    const exported = await exportIofResultListAsAdmin(db, { raceId: proof.raceId, sessionToken: proof.sessionToken });
    if (exported.status !== "ok") throw new Error(`Exporten misslyckades: ${exported.status}`);
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).toContain("<TeamResult>");
    expect(xml).toContain("<BibNumber>12</BibNumber>");
    expect(xml).toContain("<Leg>3</Leg>");
    expect(xml).toContain('<Position type="Leg">1</Position>');
    expect(xml).toMatch(/<OverallResult>\s*<Time>6000<\/Time>\s*<TimeBehind>0<\/TimeBehind>\s*<Position>1<\/Position>\s*<Status>OK<\/Status>/);
    expect(xml).toContain("<Status>MissingPunch</Status>");
    expect(xml).toContain("<Status>Active</Status>");
    expect(xml).not.toContain("<PersonResult>");

    // PLAN.md steg 13: samma resultatlista publikt (utan externa id:n) och startlistan med lagen som TeamStart.
    const publicExport = await exportPublicIofResultList(db, proof.raceId);
    if (publicExport.status !== "ok") throw new Error(`Den publika exporten misslyckades: ${publicExport.status}`);
    const publicXml = new TextDecoder().decode(publicExport.bytes);
    expect(publicXml).toContain("<BibNumber>12</BibNumber>");
    expect(publicXml).not.toMatch(/<Id[ >]/);
    const startList = await exportCurrentStartListXmlAsAdmin(db, proof);
    if (startList.status !== "exported") throw new Error(`Startlistan saknas: ${startList.status}`);
    expect(startList.xml.match(/<TeamStart>/g)).toHaveLength(4);
    expect(startList.xml).toMatch(/<BibNumber>12<\/BibNumber>\s*<TeamMemberStart>/);
    expect(startList.xml).toMatch(/<Leg>1<\/Leg>\s*<StartTime>/);
    expect(startList.xml).toContain("<Leg>3</Leg>");
    expect(startList.xml).toContain("<Family>Löpare</Family>");
  });

  it("gafflad stafett: lagen roteras över varianterna och TeamCourseAssignment ger varianter per sträcka", async () => {
    const proof = await race();
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture("course-data-forked.xml") });
    if (imported.status !== "stored") throw new Error("Banimporten misslyckades");
    const listed = await listCoursesForEditAsAdministrator(db, proof);
    if (listed.status !== "ok") throw new Error("Banorna saknas");
    const long = listed.response.courses.find(row => row.name === "Lång")!;
    const classId = await relayClass(proof, long.courseId, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", startTime: null }]);
    await team(proof, classId, "OK Gaffel 1", ["8701", "8702"], 7);
    await team(proof, classId, "Fjärilarna", ["8801", "8802"]);
    const variants = async () => (await pool.query<{ number: number; relay_leg: number; course_variant_code: string }>(
      `select t.number, e.relay_leg, e.course_variant_code from entry e join team t on t.id = e.team_id where e.race_id = $1
       order by t.number, e.relay_leg`, [proof.raceId])).rows.map(row => `${row.number}.${row.relay_leg}:${row.course_variant_code}`);
    expect(await variants()).toEqual(["7.1:AC", "7.2:AD", "8.1:AD", "8.2:BC"]);

    const assignment = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`,
      xmlBytes: fixture("team-course-assignment-relay.xml") });
    if (assignment.status !== "stored") throw new Error("Tilldelningen misslyckades");
    expect(assignment.response.report).toMatchObject({ kind: "CourseData", imported: { teamAssignments: 2 } });
    expect(await variants()).toEqual(["7.1:BD", "7.2:AC", "8.1:AD", "8.2:BC"]);
  });
});
