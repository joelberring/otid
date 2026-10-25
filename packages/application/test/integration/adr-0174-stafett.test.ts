import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin, setRelayStartTimesAsAdmin } from "../../src/relay-admin";
import {
  changeRelayLegVariantAsAdmin, editRelayClassAsAdmin, editRelayTeamAsAdmin, removeRelayTeamAsAdmin, setRelayTeamDidNotStartAsAdmin
} from "../../src/relay-admin-edit";
import { getRelayOverviewAsAdmin, publicRelayResults } from "../../src/relay-results";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { exportCurrentStartListXmlAsAdmin } from "../../src/start-list-publication";
import { listSpeakerBoardAsAdmin } from "../../src/speaker-board";
import { readPublicLive } from "../../src/public-live";
import { accountOnRace } from "./accounts";

/**
 * Steg 47 (ADR-0174): bana per sträcka, ändrad stafettklass med omräkning, lag (ändra, ta bort, stryk, ej start),
 * omstart (flyttad, flera, flygande), IOF-import med AllowedOnLeg och en linjestafett med 25 sträckor.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 47-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg47_relay_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg47_relay_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Method = "MASS_START" | "CHANGEOVER" | "RESTART" | "FLYING_RESTART";
type Leg = { startMethod: Method; startTime?: string | null; courseId?: string | null; variantCode?: string | null; restartAfterMinutes?: number | null };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const minutes = (value: number) => value * 60_000;
const LONG = [31, 32, 33, 34];
const SHORT = [41, 42];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg47.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stafettdagen", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof, name: string, controlCodes: number[]): Promise<string> {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: name, className: `Klass ${name}`, startRule: "PUNCH", controlCodes } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response.courseId;
}

const legSettings = (legs: Leg[]) => legs.map((leg, index) => ({ leg: index + 1, startTime: null, variantCode: null, courseId: null,
  restartAfterMinutes: null, ...leg }));

async function relayClass(proof: Proof, courseId: string, legs: Leg[], name = "Stafett") {
  const requestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`,
    request: { formatVersion: 1, requestId, name, courseId, legs: legSettings(legs) } });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  return created.response.classId;
}

async function team(proof: Proof, classId: string, name: string, cards: (string | null)[]) {
  const requestId = randomUUID();
  const registered = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: {
    formatVersion: 1, requestId, classId, number: null, name, organisationName: "OK Test",
    runners: cards.map((cardNumber, index) => ({ givenName: `${name.split(" ").at(-1)}${index + 1}`, familyName: "Löpare",
      organisationName: null, cardNumber })) } });
  if (registered.status !== "saved") throw new Error(`Laget kunde inte anmälas: ${registered.status}`);
  return registered.response;
}

async function readout(proof: Proof, cardNumber: string, finish: string, codes: number[], from: string) {
  const finishMs = Date.parse(finish), fromMs = Date.parse(from);
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (codes.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
  const acknowledgement = ingested.response.acknowledgements[0];
  if (!acknowledgement || acknowledgement.status === "rejected" || !acknowledgement.serverResult) throw new Error("Avläsningen saknar bedömning");
  return acknowledgement.serverResult;
}

async function legs(raceId: string) {
  const rows = (await pool.query<{ number: number; relay_leg: number; fixed_start_time: Date | null; id: string; version: number; code: string | null }>(
    `select t.number, e.relay_leg, e.fixed_start_time, e.id, e.version, e.course_variant_code as code from entry e join team t on t.id = e.team_id
     where e.race_id = $1 and e.struck_at is null order by t.number, e.relay_leg`, [raceId])).rows;
  return Object.fromEntries(rows.map(row => [`${row.number}.${row.relay_leg}`, { id: row.id, version: row.version, code: row.code,
    start: row.fixed_start_time?.toISOString() ?? null }]));
}

const statuses = async (entryId: string) => (await pool.query<{ status: string; cause: string }>(
  "select status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows.map(row => `${row.status}:${row.cause}`);

async function overview(proof: Proof) {
  const result = await getRelayOverviewAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

function editRequest(classId: string, legs: Leg[], confirmResultChanges = false, name = "Stafett") {
  const requestId = randomUUID();
  return { idempotencyKey: `relay-class-edit:${requestId}`, request: { formatVersion: 1, requestId, classId, name, legs: legSettings(legs),
    restartRanking: "AFTER_NORMAL", forking: "EVEN", confirmResultChanges } };
}

describe("steg 47 stafett", () => {
  it("bana per sträcka: lång på 1 och 3, kort på 2; avläsning, startlista, export och ändrad sträcka med omräkning", async () => {
    const proof = await race();
    const long = await course(proof, "Lång", LONG);
    const short = await course(proof, "Kort", SHORT);
    const classId = await relayClass(proof, long, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", courseId: short }, { startMethod: "CHANGEOVER" }]);
    const one = await team(proof, classId, "OK Bana 1", ["9101", "9102", "9103"]);
    expect(await readout(proof, "9101", at("17:40"), LONG, at("17:00"))).toMatchObject({ status: "OK" });
    // Sträcka 2 bedöms mot den korta banan.
    expect(await readout(proof, "9102", at("18:00"), SHORT, at("17:40"))).toMatchObject({ status: "OK" });
    expect(await readout(proof, "9103", at("18:45"), LONG, at("18:00"))).toMatchObject({ status: "OK" });
    const view = await overview(proof);
    expect(view.classes[0]!.legCourses.map(row => row.courseName)).toEqual(["Lång", "Kort", "Lång"]);
    expect(view.teams[0]).toMatchObject({ status: "OK", elapsedMs: minutes(105) });
    const publicView = await publicRelayResults(db, proof.raceId);
    expect(publicView.classes[0]!.teams[0]!.legs.map(leg => leg.courseName)).toEqual([null, "Kort", null]);

    const startList = await exportCurrentStartListXmlAsAdmin(db, proof);
    if (startList.status !== "exported") throw new Error(startList.status);
    expect(startList.xml).toMatch(/<Leg>2<\/Leg>\s*<StartTime>[^<]+<\/StartTime>\s*<Course>\s*<Name>Kort<\/Name>/);
    const exported = await exportIofResultListAsAdmin(db, { raceId: proof.raceId, sessionToken: proof.sessionToken });
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(new TextDecoder().decode(exported.bytes)).toContain("<Name>Kort</Name>");

    // Ändra sträcka 2 till den långa banan: löparen blir felstämplad. Först ett besked, sedan bekräftelse och omräkning.
    const legsLong: Leg[] = [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER", courseId: long },
      { startMethod: "CHANGEOVER" }];
    const preview = await editRelayClassAsAdmin(db, { ...proof, ...editRequest(classId, legsLong) });
    expect(preview).toMatchObject({ status: "confirmation-required", preview: { requiresConfirmation: true,
      changes: [{ leg: 2, teamNumber: one.number, before: "OK", after: "MP" }] } });
    const leg2 = (await legs(proof.raceId))[`${one.number}.2`]!;
    expect(await statuses(leg2.id)).toEqual(["OK:CARD_READOUT"]);
    const saved = await editRelayClassAsAdmin(db, { ...proof, ...editRequest(classId, legsLong, true, "Stafett lång") });
    expect(saved).toMatchObject({ status: "saved", response: { recalculatedCount: 1 } });
    expect(await statuses(leg2.id)).toEqual(["OK:CARD_READOUT", "MP:EXPLICIT_RECALCULATION"]);
    const after = await overview(proof);
    expect(after.classes[0]).toMatchObject({ name: "Stafett lång" });
    expect(after.teams[0]).toMatchObject({ status: "MP" });
    const audit = await pool.query("select action from audit_event where race_id = $1 and action = 'RELAY_CLASS_EDIT_SAVED_BY_ADMIN'", [proof.raceId]);
    expect(audit.rowCount).toBe(1);
  });

  it("ändrat antal sträckor: lägg till sist, ta bort sist, inte en sträcka med resultat", async () => {
    const proof = await race();
    const long = await course(proof, "Lång", LONG);
    const classId = await relayClass(proof, long, [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" }]);
    const one = await team(proof, classId, "OK Antal 1", ["9201", "9202"]);
    const three: Leg[] = [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" }, { startMethod: "RESTART", startTime: at("19:00") }];
    expect(await editRelayClassAsAdmin(db, { ...proof, ...editRequest(classId, three) })).toMatchObject({ status: "saved",
      response: { preview: { addedLegs: [3] } } });
    let rows = await legs(proof.raceId);
    expect(rows[`${one.number}.3`]).toMatchObject({ start: at("19:00") });
    // Ta bort sträcka 3 (vakant, inget resultat): kräver bekräftelse eftersom löparna tas bort.
    const two: Leg[] = three.slice(0, 2);
    expect(await editRelayClassAsAdmin(db, { ...proof, ...editRequest(classId, two) })).toMatchObject({ status: "confirmation-required",
      preview: { removedLegs: [3] } });
    expect(await editRelayClassAsAdmin(db, { ...proof, ...editRequest(classId, two, true) })).toMatchObject({ status: "saved" });
    rows = await legs(proof.raceId);
    expect(rows[`${one.number}.3`]).toBeUndefined();
    // En sträcka med resultat går inte att ta bort.
    const other = await relayClass(proof, long, three, "Stafett 3");
    await team(proof, other, "OK Antal 2", ["9211", "9212", "9213"]);
    await readout(proof, "9213", at("19:40"), LONG, at("19:00"));
    expect(await editRelayClassAsAdmin(db, { ...proof, ...editRequest(other, two, true, "Stafett 3") })).toMatchObject({ status: "leg-has-result" });
  });

  it("lag: ändra, ta bort utan resultat, stryk med resultat och hela laget ej start", async () => {
    const proof = await race();
    const long = await course(proof, "Lång", LONG);
    const classId = await relayClass(proof, long, [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" }]);
    const one = await team(proof, classId, "OK Lag 1", ["9301", "9302"]);
    const two = await team(proof, classId, "OK Lag 2", ["9311", "9312"]);
    const three = await team(proof, classId, "OK Lag 3", ["9321", "9322"]);
    const requestId = randomUUID();
    const edited = await editRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team-edit:${requestId}`, request: { formatVersion: 1,
      requestId, teamId: one.teamId, number: 101, name: "OK Nytt namn", organisationName: "Nya OK" } });
    expect(edited.status).toBe("saved");
    const taken = randomUUID();
    expect(await editRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team-edit:${taken}`, request: { formatVersion: 1,
      requestId: taken, teamId: two.teamId, number: 101, name: "OK Lag 2", organisationName: null } })).toMatchObject({ status: "conflict" });
    let view = await overview(proof);
    expect(view.teams.find(row => row.id === one.teamId)).toMatchObject({ number: 101, name: "OK Nytt namn", organisationName: "Nya OK" });

    // Lag 2 har ett resultat: "ta bort" ger beskedet att det har resultat; "stryk" döljer laget och släpper brickorna.
    await readout(proof, "9311", at("17:40"), LONG, at("17:00"));
    const remove = (teamId: string, mode: "DELETE" | "STRIKE") => {
      const id = randomUUID();
      return removeRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team-removal:${id}`, request: { formatVersion: 1, requestId: id, teamId, mode } });
    };
    expect(await remove(two.teamId, "DELETE")).toMatchObject({ status: "saved", response: { outcome: "HAS_RESULT" } });
    expect(await remove(two.teamId, "STRIKE")).toMatchObject({ status: "saved", response: { outcome: "STRUCK" } });
    expect(await remove(three.teamId, "DELETE")).toMatchObject({ status: "saved", response: { outcome: "DELETED" } });
    view = await overview(proof);
    expect(view.teams.map(row => row.name)).toEqual(["OK Nytt namn"]);
    expect((await publicRelayResults(db, proof.raceId)).classes[0]!.teams).toHaveLength(1);
    expect((await pool.query("select 1 from result_revision r join entry e on e.id = r.entry_id where e.team_id = $1", [two.teamId])).rowCount).toBe(1);
    expect((await pool.query("select 1 from team where id = $1", [three.teamId])).rowCount).toBe(0);
    expect((await pool.query<{ action: string }>("select action from audit_event where race_id = $1 and action in ('RELAY_TEAM_DELETED_BY_ADMIN', 'RELAY_TEAM_STRUCK_BY_ADMIN')", [proof.raceId])).rows
      .map(row => row.action).sort()).toEqual(["RELAY_TEAM_DELETED_BY_ADMIN", "RELAY_TEAM_STRUCK_BY_ADMIN"]);
    // Brickan från det strukna laget kan användas av ett nytt lag.
    await team(proof, classId, "OK Lag 4", ["9311", "9332"]);

    const dns = randomUUID();
    expect(await setRelayTeamDidNotStartAsAdmin(db, { ...proof, idempotencyKey: `relay-team-dns:${dns}`, request: { formatVersion: 1,
      requestId: dns, teamId: one.teamId } })).toMatchObject({ status: "saved", response: { didNotStartCount: 2 } });
    view = await overview(proof);
    expect(view.teams.find(row => row.id === one.teamId)).toMatchObject({ status: "DNS" });
  });

  it("omstart: flyttad omstartstid räknas om, flera omstarter, sen växling och lag i omstart placeras efter", async () => {
    const proof = await race();
    const long = await course(proof, "Lång", LONG);
    const classId = await relayClass(proof, long, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "RESTART", startTime: at("18:00") }, { startMethod: "RESTART", startTime: at("19:00") }]);
    const fast = await team(proof, classId, "OK Fort", ["9401", "9402", "9403"]);
    const slow = await team(proof, classId, "OK Sakta", ["9411", "9412", "9413"]);
    await readout(proof, "9401", at("17:40"), LONG, at("17:00"));
    await readout(proof, "9402", at("18:30"), LONG, at("17:40"));
    await readout(proof, "9403", at("19:20"), LONG, at("18:30"));
    // Laget Sakta växlar 18:10, efter omstarten 18:00: sträcka 2 räknas från omstarten och sträcka 1 står kvar.
    await readout(proof, "9411", at("18:10"), LONG, at("17:00"));
    await readout(proof, "9412", at("18:50"), LONG, at("18:00"));
    let rows = await legs(proof.raceId);
    expect(rows[`${slow.number}.2`]!.start).toBe(at("18:00"));
    await readout(proof, "9413", at("19:45"), LONG, at("19:00"));
    let view = await overview(proof);
    const slowView = () => view.teams.find(row => row.id === slow.teamId)!;
    expect(slowView()).toMatchObject({ status: "OK", restarted: true, position: 2 });
    expect(slowView().legs.map(leg => leg.restarted)).toEqual([false, true, false]);
    expect(view.classes[0]!.restarts.map(row => row.time)).toEqual([at("18:00"), at("19:00")]);

    // Omstarten sköts upp 15 minuter på tävlingsdagen: Sakta växlade före den nya tiden och räknas om från växlingen.
    const requestId = randomUUID();
    const moved = await setRelayStartTimesAsAdmin(db, { ...proof, idempotencyKey: `relay-start-times:${requestId}`, request: {
      formatVersion: 1, requestId, classId, legs: [{ leg: 2, startTime: at("18:15") }] } });
    expect(moved).toMatchObject({ status: "saved", response: { recalculatedCount: 1 } });
    rows = await legs(proof.raceId);
    expect(rows[`${slow.number}.2`]!.start).toBe(at("18:10"));
    view = await overview(proof);
    expect(slowView().legs.map(leg => leg.restarted)).toEqual([false, false, false]);
    expect(view.teams.find(row => row.id === fast.teamId)).toMatchObject({ status: "OK" });

    // Speaker och export visar omstarten.
    const speaker = await listSpeakerBoardAsAdmin(db, proof);
    if (speaker.status !== "ok") throw new Error(speaker.status);
    expect(speaker.response.rows.some(row => row.relay?.teamNumber === slow.number)).toBe(true);
    const live = await readPublicLive(db, proof.raceId);
    expect(live.finishes.some(row => row.relay?.leg === 3)).toBe(true);
  });

  it("flygande omstart: ledarens växling plus gränsen, ändras när ledarens tid rättas, blandat med växling och fast omstart", async () => {
    const proof = await race();
    const long = await course(proof, "Lång", LONG);
    const classId = await relayClass(proof, long, [{ startMethod: "MASS_START", startTime: at("09:00") },
      { startMethod: "FLYING_RESTART", restartAfterMinutes: 60 }, { startMethod: "CHANGEOVER" }, { startMethod: "RESTART", startTime: at("13:00") }]);
    const leader = await team(proof, classId, "OK Ledare", ["9501", "9502", "9503", "9504"]);
    const late = await team(proof, classId, "OK Efter", ["9511", "9512", "9513", "9514"]);
    const missing = await team(proof, classId, "OK Borta", ["9521", "9522", "9523", "9524"]);
    let rows = await legs(proof.raceId);
    expect(rows[`${late.number}.2`]!.start).toBeNull();
    await readout(proof, "9501", at("10:00"), LONG, at("09:00"));
    rows = await legs(proof.raceId);
    expect(rows[`${late.number}.2`]!.start).toBe(at("11:00"));
    expect(rows[`${missing.number}.2`]!.start).toBe(at("11:00"));
    await readout(proof, "9511", at("11:20"), LONG, at("09:00"));
    expect((await legs(proof.raceId))[`${late.number}.2`]!.start).toBe(at("11:00"));
    const view = await overview(proof);
    expect(view.classes[0]!.restarts[0]).toMatchObject({ leg: 2, time: at("11:00"), leaderChangeover: at("10:00"), leaderTeamNumber: leader.number });
    // Laget som inte växlat syns i lagvyn som ett lag på sträcka 1 (inte växlat).
    expect(view.teams.find(row => row.id === missing.teamId)!.legs[0]!.finishTime).toBeNull();
  });

  it("IOF-import: AllowedOnLeg ger sträckornas banor och TeamCourseAssignment pekar på sträckans bana", async () => {
    const proof = await race();
    const placeholder = await course(proof, "Tillfällig", [31]);
    const classId = await relayClass(proof, placeholder, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER" }, { startMethod: "CHANGEOVER" }], "D21 stafett");
    await team(proof, classId, "OK Fil 1", ["9601", "9602", "9603"]);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
  <Event><Name>Stafett</Name></Event>
  <RaceCourseData>
    <Control type="Start"><Id>S1</Id></Control><Control><Id>31</Id></Control><Control><Id>32</Id></Control><Control><Id>41</Id></Control>
    <Control><Id>42</Id></Control><Control><Id>43</Id></Control><Control type="Finish"><Id>F1</Id></Control>
    <Course><Id>L</Id><Name>Lång</Name><CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl><Control>31</Control></CourseControl><CourseControl><Control>32</Control></CourseControl>
      <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
    <Course><Id>K1</Id><Name>Kort-A</Name><CourseFamily>Kort</CourseFamily><CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl><Control>41</Control></CourseControl><CourseControl><Control>42</Control></CourseControl>
      <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
    <Course><Id>K2</Id><Name>Kort-B</Name><CourseFamily>Kort</CourseFamily><CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl><Control>41</Control></CourseControl><CourseControl><Control>43</Control></CourseControl>
      <CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>
    <ClassCourseAssignment><ClassName>D21 stafett</ClassName><AllowedOnLeg>1</AllowedOnLeg><AllowedOnLeg>3</AllowedOnLeg><CourseName>Lång</CourseName></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21 stafett</ClassName><AllowedOnLeg>2</AllowedOnLeg><CourseFamily>Kort</CourseFamily></ClassCourseAssignment>
    <TeamCourseAssignment><BibNumber>1</BibNumber>
      <TeamMemberCourseAssignment><Leg>2</Leg><CourseName>Kort-B</CourseName><CourseFamily>Kort</CourseFamily></TeamMemberCourseAssignment>
    </TeamCourseAssignment>
  </RaceCourseData>
</CourseData>`;
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: new TextEncoder().encode(xml) });
    if (imported.status !== "stored") throw new Error(`Importen misslyckades: ${imported.status}`);
    expect(imported.response.report.warnings.filter(warning => warning.includes("Sträcka"))).toEqual([]);
    const view = await overview(proof);
    expect(view.classes[0]!.legCourses.map(row => row.courseName)).toEqual(["Lång", "Kort", "Lång"]);
    expect(view.teams[0]!.legs[1]!.variantCode).toBe("B");
    expect(await readout(proof, "9602", at("18:00"), [41, 43], at("17:40"))).toMatchObject({ status: "MP", reason: "MISSING_START" });
    await readout(proof, "9601", at("17:40"), [31, 32], at("17:00"));
    expect((await overview(proof)).teams[0]!.legs[1]).toMatchObject({ status: "OK" });

    // Byt variant på sträcka 2 i lagkortet: avläsningen blir felstämplad; först beskedet, sedan bekräftelse.
    const leg2 = (await overview(proof)).teams[0]!.legs[1]!;
    const change = (confirm: boolean) => {
      const id = randomUUID();
      return changeRelayLegVariantAsAdmin(db, { ...proof, idempotencyKey: `relay-leg-variant:${id}`, request: { formatVersion: 1, requestId: id,
        teamId: view.teams[0]!.id, leg: 2, expectedEntryVersion: leg2.entryVersion, variantCode: "A", confirmResultChanges: confirm } });
    };
    expect(await change(false)).toMatchObject({ status: "confirmation-required", preview: { changes: [{ before: "OK", after: "MP" }] } });
    expect(await change(true)).toMatchObject({ status: "saved", response: { recalculatedCount: 1 } });
    expect((await overview(proof)).teams[0]!.legs[1]).toMatchObject({ variantCode: "A", status: "MP" });
  });

  it("linjestafett med 25 sträckor × 300 lag: svarstider för omräkning och publik resultatlista", async () => {
    const proof = await race();
    const long = await course(proof, "Linje", [31, 32]);
    const legsSetting: Leg[] = Array.from({ length: 25 }, (_, index) => index === 0 ? { startMethod: "MASS_START", startTime: at("06:00") }
      : index % 6 === 0 ? { startMethod: "FLYING_RESTART", restartAfterMinutes: 60 }
        : index === 20 ? { startMethod: "RESTART", startTime: at("20:00") } : { startMethod: "CHANGEOVER" });
    const classId = await relayClass(proof, long, legsSetting, "25-manna");
    const TEAMS = 300;
    // Lagen skrivs direkt i databasen (300 anmälningar via tjänsten tar för lång tid i testet).
    const raceId = proof.raceId;
    await pool.query(`insert into team (race_id, class_id, number, name) select $1, $2, n, 'Lag ' || n from generate_series(1, ${TEAMS}) n`,
      [raceId, classId]);
    await pool.query(`insert into entry (race_id, class_id, team_id, relay_leg, given_name, family_name, version)
      select $1, $2, t.id, leg, 'Löpare', t.number || '-' || leg, 1 from team t cross join generate_series(1, 25) leg where t.class_id = $2`, [raceId, classId]);
    await pool.query(`insert into card_assignment (race_id, entry_id, card_number)
      select $1, e.id, (7000000 + t.number * 100 + e.relay_leg)::text from entry e join team t on t.id = e.team_id where e.class_id = $2`, [raceId, classId]);
    // Starttiderna räknas fram en gång (masstarten).
    const startsRequest = randomUUID();
    let began = Date.now();
    const recompute = await setRelayStartTimesAsAdmin(db, { ...proof, idempotencyKey: `relay-start-times:${startsRequest}`, request: {
      formatVersion: 1, requestId: startsRequest, classId, legs: [{ leg: 1, startTime: at("06:00") }] } });
    const firstSync = Date.now() - began;
    expect(recompute.status).toBe("saved");
    // Tio lag läser ut sträcka 1 (flygande omstart på sträcka 7 räknas från ledaren).
    began = Date.now();
    for (let teamNumber = 1; teamNumber <= 10; teamNumber += 1) {
      await readout(proof, String(7000000 + teamNumber * 100 + 1), new Date(Date.parse(at("06:30")) + teamNumber * 60_000).toISOString(), [31, 32], at("06:00"));
    }
    const perReadout = (Date.now() - began) / 10;
    // Omstarten på sträcka 21 flyttas: ingen har läst ut sträcka 20, så inget räknas om men alla starter räknas.
    const moveRequest = randomUUID();
    began = Date.now();
    await setRelayStartTimesAsAdmin(db, { ...proof, idempotencyKey: `relay-start-times:${moveRequest}`, request: {
      formatVersion: 1, requestId: moveRequest, classId, legs: [{ leg: 21, startTime: at("20:15") }] } });
    const restartMove = Date.now() - began;
    began = Date.now();
    const publicView = await publicRelayResults(db, raceId);
    const publicList = Date.now() - began;
    expect(publicView.classes[0]!.teams).toHaveLength(TEAMS);
    expect(publicView.classes[0]!.legCount).toBe(25);
    console.info(`25 sträckor × ${TEAMS} lag: första starter ${firstSync} ms, avläsning ${Math.round(perReadout)} ms, ` +
      `flyttad omstart ${restartMove} ms, publik resultatlista ${publicList} ms`);
    expect(publicList).toBeLessThan(20_000);
  }, 300_000);
});
