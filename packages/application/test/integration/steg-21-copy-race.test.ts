import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { createRelayClassAsAdministrator, registerRelayTeamAsAdministrator } from "../../src/relay-admin";
import { changeRogainingAsAdministrator } from "../../src/rogaining";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "../../src/readout-station";
import { georeferenceRaceMapAsAdministrator, saveRaceMapAsAdministrator } from "../../src/race-map";
import { saveRadioSettingsAsAdministrator } from "../../src/radio-settings";
import { eventorConfigurationFromEnvironment } from "../../src/eventor-secret";
import { chooseEventorEventAsAdministrator, saveEventorKeyAsAdministrator, type EventorRuntime } from "../../src/eventor-link";
import { copyRaceAsUserAccount } from "../../src/race-copy";
import { publicResults } from "../../src/results";
import { grantRacePerson, registerTestAccount, setRacePublished } from "./accounts";

/**
 * PLAN.md steg 21: "Ny tävling som …". Kopian har samma banor (alla versioner, varianter), kontroller, klasser,
 * sträckor, karta och radiokontroller som nya rader, men inga deltagare, lag, avläsningar, resultat, Eventor-koppling
 * eller publicering. Ändringar i kopian påverkar inte källan och tvärtom. Bara ägare och administratörer får kopiera.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Kopieringstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg21_copy_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFile(new URL(path, fixtures));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg21_copy_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

async function enter(account: AccountProof, raceId: string): Promise<Proof> {
  const entered = await enterRaceAsUserAccount(db, { ...account, raceId });
  if (entered.status !== "entered") throw new Error(`Kom inte in i tävlingen: ${entered.status}`);
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

function eventorRuntime(): EventorRuntime {
  const fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    const file = path === "/api/organisation/apiKey" ? "eventor/organisation.xml" : path === "/api/events" ? "eventor/events.xml"
      : path === "/api/event/47110" ? "eventor/event.xml" : undefined;
    return file ? new Response(await fixture(file).then(bytes => bytes.toString("utf8")), { headers: { "content-type": "text/xml" } }) : new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { configuration: eventorConfigurationFromEnvironment({
    OTID_EVENTOR_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), OTID_EVENTOR_BASE_URL: "http://eventor.test" }), fetch };
}

async function manualCourse(proof: Proof, courseName: string, className: string, controlCodes: number[],
  rogaining?: { timeLimitMinutes: number; penaltyPoints: number }) {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseName, className,
      startRule: "PUNCH", controlCodes, ...(rogaining ? { rogaining } : {}) } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response;
}

async function register(proof: Proof, classId: string, givenName: string, cardNumber: string): Promise<string> {
  const courseVersionId = (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId]))
    .rows[0]!.course_version_id;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(proof.raceId), givenName, familyName: "Löpare", organisationName: "OK Test",
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(proof: Proof, cardNumber: string, codes: number[], day: string) {
  const at = (minute: number) => new Date(Date.parse(`${day}T16:00:00.000Z`) + minute * 60_000).toISOString();
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(30),
    punches: codes.map((code, index) => ({ code, punchedAt: at(index + 1) })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(31), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

/** Källan: gafflade banor från fil, rogaining, stafett, karta, radio, Eventor, deltagare, lag, avläsning och publicering. */
async function sourceRace(owner: AccountProof) {
  const created = await createEventAsUserAccount(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning v41", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const proof = await enter(owner, created.response.raceId);
  for (const file of ["course-data-forked.xml", "entry-list-forked.xml", "course-assignment-forked.xml"]) {
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: await fixture(`iof/${file}`) });
    if (imported.status !== "stored") throw new Error(`Importen misslyckades: ${imported.status}`);
  }
  const rogaining = await manualCourse(proof, "Poängjakt", "Rogaining 60", [71, 72, 73], { timeLimitMinutes: 60, penaltyPoints: 2 });
  const points = randomUUID();
  expect((await changeRogainingAsAdministrator(db, { ...proof, idempotencyKey: `rogaining-change:${points}`, request: { formatVersion: 1,
    requestId: points, expectedSnapshotVersion: await snapshot(proof.raceId), controlPoints: [{ code: 72, points: 40 }], classRules: [],
    confirmResultChanges: true } })).status).toBe("changed");
  const relayCourse = await manualCourse(proof, "Stafettbana", "Inskolning", [31, 32, 33]);
  const relayId = randomUUID();
  const relay = await createRelayClassAsAdministrator(db, { ...proof, idempotencyKey: `relay-class:${relayId}`, request: { formatVersion: 1,
    requestId: relayId, expectedSnapshotVersion: await snapshot(proof.raceId), name: "Stafett", courseId: relayCourse.courseId,
    legs: [{ leg: 1, startMethod: "MASS_START", startTime: "2026-10-08T15:00:00.000Z", variantCode: null },
      { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null }] } });
  if (relay.status !== "saved") throw new Error(`Stafetten kunde inte skapas: ${relay.status}`);
  const teamId = randomUUID();
  expect((await registerRelayTeamAsAdministrator(db, { ...proof, idempotencyKey: `relay-team:${teamId}`, request: { formatVersion: 1,
    requestId: teamId, expectedSnapshotVersion: await snapshot(proof.raceId), classId: relay.response.classId, number: null, name: "OK Lag",
    organisationName: "OK Test", runners: [{ givenName: "Sträcka", familyName: "Ett", organisationName: null, cardNumber: "7501" },
      { givenName: "Sträcka", familyName: "Två", organisationName: null, cardNumber: "7502" }] } })).status).toBe("saved");
  // Inställningar som bara går att nå med andra flöden: maxantal och en klass kopplad till Eventor.
  await pool.query("update class set max_entries = 40 where id = $1", [relayCourse.classId]);
  await pool.query("update class set external_source = 'eventor', external_id = 'eventor-klass-1' where id = $1", [rogaining.classId]);

  const entryId = await register(proof, relayCourse.classId, "Anna", "7401");
  await readout(proof, "7401", [31, 32, 33], "2026-10-08");
  const png = new Uint8Array(await fixture("maps/strackanalys.png"));
  expect(await saveRaceMapAsAdministrator(db, { ...proof, bytes: png, fileName: "karta.png" })).toEqual({ status: "ok" });
  expect(await georeferenceRaceMapAsAdministrator(db, { ...proof, request: { formatVersion: 1, tiePoints: [
    { pixelX: 100, pixelY: 100, latitude: 59.308, longitude: 18.0935 }, { pixelX: 700, pixelY: 100, latitude: 59.308, longitude: 18.1145 },
    { pixelX: 100, pixelY: 500, latitude: 59.3017, longitude: 18.0935 }] } })).toEqual({ status: "ok" });
  expect((await saveRadioSettingsAsAdministrator(db, { ...proof, request: { formatVersion: 1, source: "ROC", unitId: "4711", enabled: true,
    controls: [{ code: 31, label: "Radio 1" }, { code: 50, label: null }] } })).status).toBe("ok");
  const runtime = eventorRuntime();
  expect(await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: "0f1e2d3c4b5a69788796a5b4c3d2e1f0" } }, runtime))
    .toMatchObject({ status: "ok" });
  expect(await chooseEventorEventAsAdministrator(db, { ...proof, request: { formatVersion: 1, eventId: "47110" } }, runtime))
    .toMatchObject({ status: "ok" });
  expect((await setRacePublished(db, owner, proof.raceId)).status).toBe("saved");
  return { proof, eventId: created.response.eventId, entryId, rogainingClassId: rogaining.classId };
}

/** Tävlingens innehåll utan id:n, i fast ordning, så att källa och kopia kan jämföras exakt. */
async function structure(raceId: string) {
  const q = async <T extends Record<string, unknown>>(text: string) => (await pool.query<T>(text, [raceId])).rows;
  const [race] = await q(`select r.race_type, e.time_zone from race r join event e on e.id = r.event_id where r.id = $1`);
  return {
    race,
    controls: await q("select code, kind, points from control where race_id = $1 order by code"),
    courses: await q(`select c.name, c.external_source, c.external_id, v.version,
        (select array_agg(k.code order by cc.sequence) from course_control cc join control k on k.id = cc.control_id
          where cc.course_version_id = v.id) as controls,
        (select json_agg(json_build_object('code', cv.code, 'sequence', cv.sequence, 'controls',
          (select array_agg(k.code order by cvc.sequence) from course_variant_control cvc join control k on k.id = cvc.control_id
            where cvc.course_variant_id = cv.id)) order by cv.sequence) from course_variant cv where cv.course_version_id = v.id) as variants
      from course c join course_version v on v.course_id = c.id where c.race_id = $1 order by c.name, v.version`),
    classes: await q(`select cl.name, c.name as course, v.version, cl.start_rule::text, cl.max_entries, cl.rogaining_time_limit_seconds,
        cl.rogaining_penalty_points_per_minute, cl.external_source, cl.external_id
      from class cl join course_version v on v.id = cl.course_version_id join course c on c.id = v.course_id
      where cl.race_id = $1 order by cl.name`),
    relayLegs: await q(`select cl.name, l.leg, l.start_method, l.start_time, l.course_variant_code
      from relay_leg l join class cl on cl.id = l.class_id where l.race_id = $1 order by cl.name, l.leg`),
    map: await q("select file_name, media_type, sha256, byte_length, width, height, tie_points, transform from race_map where race_id = $1"),
    radio: await q("select source, unit_id, enabled, last_punch_id from race_radio_link where race_id = $1"),
    radioControls: await q("select control_code, label from race_radio_control where race_id = $1 order by control_code")
  };
}

const count = async (table: string, raceId: string) =>
  Number((await pool.query<{ count: string }>(`select count(*)::text as count from "${table}" where race_id = $1`, [raceId])).rows[0]!.count);

async function ids(raceId: string): Promise<Set<string>> {
  const rows = await pool.query<{ id: string }>(`
    select id from control where race_id = $1 union all select id from course where race_id = $1
    union all select v.id from course_version v join course c on c.id = v.course_id where c.race_id = $1
    union all select cc.id from course_control cc join course_version v on v.id = cc.course_version_id join course c on c.id = v.course_id
      where c.race_id = $1
    union all select cv.id from course_variant cv join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
      where c.race_id = $1
    union all select id from class where race_id = $1`, [raceId]);
  return new Set(rows.rows.map(row => row.id));
}

async function people(eventId: string) {
  return (await pool.query<{ email: string; role: string }>(`select a.email, g.role::text from event_administration_grant g
    join user_account a on a.id = g.account_id where g.event_id = $1 order by g.role, a.email`, [eventId])).rows;
}

const PERSON_TABLES = ["entry", "card_assignment", "team", "card_readout", "raw_device_message", "result_revision", "participant_route",
  "radio_punch", "race_eventor_link", "source_snapshot", "start_list_publication", "result_finalization", "start_draw_request"];

describe("PLAN.md steg 21 kopiera tävling", () => {
  it("kopierar banor, klasser och inställningar som nya rader utan deltagare och resultat, och kopian är fristående", async () => {
    const owner = await registerTestAccount(db, `agare.${randomUUID().slice(0, 8)}`);
    const helper = await registerTestAccount(db, `admin.${randomUUID().slice(0, 8)}`);
    const functionary = await registerTestAccount(db, `funk.${randomUUID().slice(0, 8)}`);
    const outsider = await registerTestAccount(db, `utom.${randomUUID().slice(0, 8)}`);
    const source = await sourceRace(owner.proof);
    expect((await grantRacePerson(db, owner.proof, source.proof.raceId, helper.email, "ADMIN")).status).toBe("granted");
    expect((await grantRacePerson(db, owner.proof, source.proof.raceId, functionary.email, "FUNCTIONARY")).status).toBe("granted");
    for (const table of ["entry", "team", "card_readout", "result_revision", "race_eventor_link", "race_map", "relay_leg", "race_radio_control"]) {
      expect(await count(table, source.proof.raceId), table).toBeGreaterThan(0);
    }
    const sourceBefore = await structure(source.proof.raceId);
    const sourceResults = await publicResults(db, source.proof.raceId);

    const request = { formatVersion: 1, requestId: randomUUID(), eventName: "Klubbträning v44", raceName: "Torsdag kväll",
      raceDate: "2026-10-29", includePeople: true };
    // Behörighet: funktionären och en utomstående får inte kopiera; fel begäran avvisas.
    expect(await copyRaceAsUserAccount(db, { ...functionary.proof, raceId: source.proof.raceId, request })).toEqual({ status: "forbidden" });
    expect(await copyRaceAsUserAccount(db, { ...outsider.proof, raceId: source.proof.raceId, request })).toEqual({ status: "not-found" });
    expect(await copyRaceAsUserAccount(db, { ...owner.proof, csrfHeader: "fel", raceId: source.proof.raceId, request }))
      .toEqual({ status: "forbidden" });
    expect(await copyRaceAsUserAccount(db, { ...owner.proof, raceId: source.proof.raceId, request: { ...request, raceDate: "29/10" } }))
      .toEqual({ status: "invalid-request" });

    const copied = await copyRaceAsUserAccount(db, { ...owner.proof, raceId: source.proof.raceId, request });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    const copy = copied.response;
    expect(copy).toMatchObject({ replayed: false, sourceRaceId: source.proof.raceId,
      copied: { courses: 4, classes: 5, relayLegs: 2, radioControls: 2, map: true, people: 2, eventorNotCopied: true } });
    expect(copy.copied.controls).toBe(sourceBefore.controls.length);
    // Samma request-id ger samma kopia; ett annat innehåll med samma id är en konflikt.
    expect(await copyRaceAsUserAccount(db, { ...owner.proof, raceId: source.proof.raceId, request }))
      .toEqual({ status: "copied", response: { ...copy, replayed: true } });
    expect(await copyRaceAsUserAccount(db, { ...owner.proof, raceId: source.proof.raceId, request: { ...request, raceName: "Annat" } }))
      .toEqual({ status: "conflict" });

    // Innehållet är detsamma, utom det som avsiktligt skiljer sig.
    const copyStructure = await structure(copy.raceId);
    expect(copyStructure).toEqual({ ...sourceBefore,
      classes: sourceBefore.classes.map(row => row.external_source === "eventor" ? { ...row, external_source: null, external_id: null } : row),
      // Masstarten 17:00 följer med till det nya datumet, även efter sommartidens slut (16:00 UTC).
      relayLegs: sourceBefore.relayLegs.map(row => row.start_time ? { ...row, start_time: new Date("2026-10-29T16:00:00.000Z") } : row),
      radio: sourceBefore.radio.map(row => ({ ...row, enabled: false, last_punch_id: "0" })) });
    expect(sourceBefore.courses.some(row => Array.isArray(row.variants) && row.variants.length === 4)).toBe(true);
    expect(sourceBefore.controls.find(row => row.code === 72)?.points).toBe(40);

    // Nya rader: inga id:n delas mellan källa och kopia.
    const sourceIds = await ids(source.proof.raceId), copyIds = await ids(copy.raceId);
    expect(copyIds.size).toBe(sourceIds.size);
    expect([...copyIds].filter(id => sourceIds.has(id))).toEqual([]);

    // Inget personrelaterat: inga deltagare, lag, avläsningar, resultat, rutter, radiostämplingar eller Eventor.
    for (const table of PERSON_TABLES) expect(await count(table, copy.raceId), table).toBe(0);
    const [race] = (await pool.query<{ name: string; race_date: string; published_at: Date | null; short_code: string; snapshot_version: number;
      event_name: string; starts_on: string }>(`select r.name, r.race_date::text, r.published_at, r.short_code, r.snapshot_version,
        e.name as event_name, e.starts_on::text from race r join event e on e.id = r.event_id where r.id = $1`, [copy.raceId])).rows;
    const [sourceRow] = (await pool.query<{ short_code: string }>("select short_code from race where id = $1", [source.proof.raceId])).rows;
    expect(race).toMatchObject({ name: "Torsdag kväll", race_date: "2026-10-29", published_at: null, snapshot_version: 1,
      event_name: "Klubbträning v44", starts_on: "2026-10-29" });
    expect(race!.short_code).not.toBe(sourceRow!.short_code);

    // Personer: den som kopierade är ägare, källans administratör och funktionär följer med i sina roller.
    expect(await people(copy.eventId)).toEqual([{ email: owner.email, role: "OWNER" }, { email: helper.email, role: "ADMIN" },
      { email: functionary.email, role: "FUNCTIONARY" }].sort((a, b) => ["OWNER", "ADMIN", "FUNCTIONARY"].indexOf(a.role) -
      ["OWNER", "ADMIN", "FUNCTIONARY"].indexOf(b.role)));

    // Kopian fungerar: avläsningspaketet har en ny kort adress och en anmäld läses av mot kopians bana.
    const copyProof = await enter(owner.proof, copy.raceId);
    const pkg = await readReadoutPackageAsAdministrator(db, copyProof);
    if (pkg.status !== "ok") throw new Error("Paketet saknas");
    expect(pkg.response.publicLinks).toEqual({ shortCode: race!.short_code, published: false, participants: [] });
    const inskolning = (await pool.query<{ id: string }>("select id from class where race_id = $1 and name = 'Inskolning'", [copy.raceId])).rows[0]!.id;
    const entryId = await register(copyProof, inskolning, "Bo", "7401");
    await readout(copyProof, "7401", [31, 32, 33], "2026-10-29");
    expect((await pool.query<{ status: string }>("select status::text from result_revision where entry_id = $1", [entryId])).rows)
      .toEqual([{ status: "OK" }]);

    // Fristående: ändrade poäng och en ny bana i kopian ändrar inte källan, ändrad radio i källan ändrar inte kopian.
    const pointsId = randomUUID();
    expect((await changeRogainingAsAdministrator(db, { ...copyProof, idempotencyKey: `rogaining-change:${pointsId}`, request: {
      formatVersion: 1, requestId: pointsId, expectedSnapshotVersion: await snapshot(copy.raceId), controlPoints: [{ code: 72, points: 90 }],
      classRules: [], confirmResultChanges: true } })).status).toBe("changed");
    await manualCourse(copyProof, "Ny bana", "Ny klass", [31, 99]);
    const sourceProof = await enter(owner.proof, source.proof.raceId);
    expect((await saveRadioSettingsAsAdministrator(db, { ...sourceProof, request: { formatVersion: 1, source: "ROC", unitId: "4711",
      enabled: true, controls: [{ code: 31, label: "Ändrad" }] } })).status).toBe("ok");
    expect(await structure(source.proof.raceId)).toEqual({ ...sourceBefore,
      radioControls: [{ control_code: 31, label: "Ändrad" }] });
    expect(await publicResults(db, source.proof.raceId)).toEqual(sourceResults);
    const copyAfter = await structure(copy.raceId);
    expect(copyAfter.radioControls).toEqual(sourceBefore.radioControls);
    expect(copyAfter.controls.find(row => row.code === 72)?.points).toBe(90);
    expect(copyAfter.classes.map(row => row.name)).toContain("Ny klass");
  });

  it("en administratör kopierar utan personer och blir ensam ägare", async () => {
    const owner = await registerTestAccount(db, `agare.${randomUUID().slice(0, 8)}`);
    const helper = await registerTestAccount(db, `admin.${randomUUID().slice(0, 8)}`);
    const created = await createEventAsUserAccount(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Liten träning", raceName: "Lopp", raceDate: "2026-10-08",
        timeZone: "Europe/Stockholm", raceType: "TRAINING" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    await manualCourse(await enter(owner.proof, created.response.raceId), "Kort", "D21", [31, 32]);
    expect((await grantRacePerson(db, owner.proof, created.response.raceId, helper.email, "ADMIN")).status).toBe("granted");
    const copied = await copyRaceAsUserAccount(db, { ...helper.proof, raceId: created.response.raceId, request: { formatVersion: 1,
      requestId: randomUUID(), eventName: "Liten träning", raceName: "Lopp", raceDate: "2026-10-15", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    expect(copied.response.copied).toEqual({ courses: 1, classes: 1, controls: 2, relayLegs: 0, radioControls: 0, map: false, people: 0,
      eventorNotCopied: false });
    expect(await people(copied.response.eventId)).toEqual([{ email: helper.email, role: "OWNER" }]);
    const [race] = (await pool.query<{ race_type: string }>("select race_type from race where id = $1", [copied.response.raceId])).rows;
    expect(race).toEqual({ race_type: "TRAINING" });
    // Källans ägare når inte kopian.
    expect((await enterRaceAsUserAccount(db, { ...owner.proof, raceId: copied.response.raceId })).status).toBe("not-found");
  });
});
