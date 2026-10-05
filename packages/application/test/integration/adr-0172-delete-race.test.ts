import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { decideDidNotStartAsAdmin, listDidNotStartCandidatesAsAdmin } from "../../src/did-not-start";
import { decideStartListPublicationAsAdmin, getStartListPublicationPreviewAsAdmin } from "../../src/start-list-publication";
import { eventorConfigurationFromEnvironment } from "../../src/eventor-secret";
import { chooseEventorEventAsAdministrator, saveEventorKeyAsAdministrator, type EventorRuntime } from "../../src/eventor-link";
import { previewCourseFileAsAdministrator, previewEventorSyncAsAdministrator } from "../../src/source-sync";
import { georeferenceRaceMapAsAdministrator, saveParticipantRouteAsAdministrator, saveRaceMapAsAdministrator } from "../../src/race-map";
import { publicResults } from "../../src/results";
import { deleteEventAsOwner } from "../../src/account-self-service";
import { loginUserAccount } from "../../src/user-account";
import { grantRacePerson, registerTestAccount } from "./accounts";

/**
 * ADR-0172 beslut 2: en borttagen tävling tar med sig allt – anmälda, råa avläsningar, resultatrevisioner,
 * beslut, publiceringar, Eventor-koppling och källor, karta och rutter, medadministratörer och delegeringar.
 * Kontrollen räknar rader i varje tabell före och efter: efter borttagningen är allt som tävlingen skapade borta
 * och en annan tävling är orörd.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Borttagningstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0172_delete_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFile(new URL(path, fixtures), "utf8");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0172_delete_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };
const API_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const START = Date.UTC(2026, 9, 8, 16, 0, 0);
const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString();
const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

/** Konton, sessioner och spärrar hör till personerna, inte till tävlingen, och får bli fler. */
const ACCOUNT_TABLES = new Set(["user_account_session", "user_account_session_revocation", "user_account_login_throttle",
  "account_request_throttle", "spatial_ref_sys"]);

async function tableCounts(): Promise<Map<string, number>> {
  const tables = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
  const counts = new Map<string, number>();
  for (const { table_name: table } of tables.rows) {
    const result = await pool.query<{ count: string }>(`select count(*)::text as count from "${table}"`);
    counts.set(table, Number(result.rows[0]!.count));
  }
  return counts;
}

async function race(owner: AccountProof, eventName: string): Promise<{ proof: Proof; eventId: string; classId: string }> {
  const created = await createEventAsUserAccount(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await enterRaceAsUserAccount(db, { ...owner, raceId: created.response.raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseName: "Lång",
      className: "H21", startRule: "PUNCH", controlCodes: [31, 32, 33] } });
  if (course.status !== "created") throw new Error("Banan kunde inte skapas");
  return { proof, eventId: created.response.eventId, classId: course.response.classId };
}

async function entry(proof: Proof, classId: string, givenName: string, cardNumber: string): Promise<string> {
  const courseVersionId = (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId]))
    .rows[0]!.course_version_id;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(proof.raceId), givenName, familyName: "Löpare", organisationName: "OK Borta",
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(proof: Proof, cardNumber: string, punches: [number, number][], finish: number) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(finish),
    punches: punches.map(([code, seconds]) => ({ code, punchedAt: at(seconds) })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(finish + 60), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

function eventorRuntime(): EventorRuntime {
  const fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    const file = path === "/api/organisation/apiKey" ? "eventor/organisation.xml" : path === "/api/events" ? "eventor/events.xml"
      : path === "/api/event/47110" ? "eventor/event.xml" : path === "/api/eventclasses" ? "eventor/classes.xml"
        : path === "/api/entries" ? "eventor/entries-1.xml" : undefined;
    return file ? new Response(await fixture(file), { headers: { "content-type": "text/xml" } }) : new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { configuration: eventorConfigurationFromEnvironment({
    OTID_EVENTOR_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), OTID_EVENTOR_BASE_URL: "http://eventor.test" }), fetch };
}

/** Allt en tävling kan samla på sig. */
async function fillRace(f: { proof: Proof; eventId: string; classId: string }, owner: AccountProof, helperEmail: string, helper: AccountProof) {
  const { proof } = f;
  await entry(proof, f.classId, "Anna", "7201");
  await entry(proof, f.classId, "Bo", "7202");
  await entry(proof, f.classId, "Cia", "7203");
  await readout(proof, "7201", [[31, 450], [32, 900], [33, 1350]], 1800);
  await readout(proof, "7202", [[31, 440], [33, 1360]], 1790);
  await readout(proof, "9999", [[31, 400]], 900); // okänd bricka

  // DNS-beslut (resultatrevision och beslut pekar på varandra med uppskjutna nycklar).
  const candidates = await listDidNotStartCandidatesAsAdmin(db, proof);
  if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
  const cia = candidates.response.entries.find((candidate) => candidate.readiness === "READY");
  if (!cia) throw new Error("Ingen DNS-kandidat");
  const dns = await decideDidNotStartAsAdmin(db, { ...proof, entryId: cia.id, idempotencyKey: `did-not-start:${randomUUID()}`,
    request: { formatVersion: 1, expectedEntryVersion: cia.entryVersion, expectedClassId: cia.classId,
      expectedCourseVersionId: cia.courseVersionId, expectedSnapshotVersion: candidates.response.snapshotVersion,
      expectedLatestResultRevision: null, policyVersion: "did-not-start-v1" } });
  expect(dns.status).toBe("decided");

  // Publicerad startlista.
  const preview = await getStartListPublicationPreviewAsAdmin(db, proof);
  if (preview.status !== "ok" || !preview.response.sourceHash) throw new Error("Startlistan saknas");
  expect((await decideStartListPublicationAsAdmin(db, { ...proof, idempotencyKey: `start-list-publication:${randomUUID()}`,
    request: { formatVersion: 1, action: "PUBLISH", expectedSnapshotVersion: preview.response.snapshotVersion,
      expectedSourceHash: preview.response.sourceHash, expectedRevision: 0 } })).status).toBe("decided");

  // Eventor-nyckel, vald tävling och källor som ögonblicksbilder.
  const runtime = eventorRuntime();
  expect(await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: API_KEY } }, runtime))
    .toMatchObject({ status: "ok", response: { outcome: "CONNECTED" } });
  expect(await chooseEventorEventAsAdministrator(db, { ...proof, request: { formatVersion: 1, eventId: "47110" } }, runtime))
    .toMatchObject({ status: "ok", response: { outcome: "CONNECTED" } });
  expect((await previewEventorSyncAsAdministrator(db, proof, runtime)).status).toBe("ok");
  expect((await previewCourseFileAsAdministrator(db, { ...proof, xml: await fixture("iof/course-file-1.xml"), fileName: "banor.xml" })).status)
    .toBe("ok");

  // Karta med georeferens och en rutt.
  const png = new Uint8Array(await readFile(new URL("maps/strackanalys.png", fixtures)));
  expect(await saveRaceMapAsAdministrator(db, { ...proof, bytes: png, fileName: "karta.png" })).toEqual({ status: "ok" });
  expect(await georeferenceRaceMapAsAdministrator(db, { ...proof, request: { formatVersion: 1, tiePoints: [
    { pixelX: 100, pixelY: 100, latitude: 59.308, longitude: 18.0935 }, { pixelX: 700, pixelY: 100, latitude: 59.308, longitude: 18.1145 },
    { pixelX: 100, pixelY: 500, latitude: 59.3017, longitude: 18.0935 }] } })).toEqual({ status: "ok" });
  const annaId = (await pool.query<{ id: string }>("select id from entry where race_id = $1 and given_name = 'Anna'", [proof.raceId])).rows[0]!.id;
  const gpx = (await fixture("routes/anna.gpx")).replace(/<time>([^<]+)<\/time>/g, (_match, time: string) =>
    `<time>${new Date(Date.parse(time) + START - 300_000 - Date.UTC(2026, 0, 1)).toISOString()}</time>`);
  expect((await saveParticipantRouteAsAdministrator(db, { ...proof, entryId: annaId, bytes: new TextEncoder().encode(gpx),
    fileName: "anna.gpx" })).status).toBe("ok");

  // Medadministratör som har öppnat arbetsytan.
  expect((await grantRacePerson(db, owner, proof.raceId, helperEmail, "ADMIN")).status).toBe("granted");
  expect((await enterRaceAsUserAccount(db, { ...helper, raceId: proof.raceId })).status).toBe("entered");
}

describe("ADR-0172 ta bort tävling", () => {
  it("tar bort tävlingen med all data och lämnar konton och andra tävlingar orörda", async () => {
    const owner = await registerTestAccount(db, `agare.${randomUUID().slice(0, 8)}`);
    const helper = await registerTestAccount(db, `hjalp.${randomUUID().slice(0, 8)}`);
    const kept = await race(owner.proof, "Kvarvarande");
    await entry(kept.proof, kept.classId, "Kvar", "7301");
    await readout(kept.proof, "7301", [[31, 400], [32, 800], [33, 1200]], 1500);
    const keptResults = await publicResults(db, kept.proof.raceId);
    const before = await tableCounts();

    const doomed = await race(owner.proof, "Borttagen träning");
    await fillRace(doomed, owner.proof, helper.email, helper.proof);
    const filled = await tableCounts();
    const touched = [...filled].filter(([table, count]) => count > (before.get(table) ?? 0) && !ACCOUNT_TABLES.has(table)).map(([table]) => table);
    for (const table of ["raw_device_message", "card_readout", "result_revision", "did_not_start_decision", "start_list_publication",
      "race_eventor_link", "source_snapshot", "race_map", "participant_route", "event_administration_grant", "user_account_race_delegation",
      "audit_event", "entry", "course_version"]) expect(touched, table).toContain(table);

    // Bara ägaren, och bara med tävlingens namn.
    expect((await deleteEventAsOwner(db, { ...helper.proof, raceId: doomed.proof.raceId },
      { formatVersion: 1, confirmation: "Borttagen träning" })).status).toBe("not-found");
    expect((await deleteEventAsOwner(db, { ...owner.proof, raceId: doomed.proof.raceId },
      { formatVersion: 1, confirmation: "Kvarvarande" })).status).toBe("confirmation-mismatch");
    expect(await deleteEventAsOwner(db, { ...owner.proof, raceId: doomed.proof.raceId },
      { formatVersion: 1, confirmation: "Borttagen träning" })).toEqual({ status: "deleted", eventId: doomed.eventId });

    const after = await tableCounts();
    for (const [table, count] of after) {
      if (ACCOUNT_TABLES.has(table)) continue;
      expect(count, `${table} har rader kvar från den borttagna tävlingen`).toBe(before.get(table));
    }
    const columns = await pool.query<{ table_name: string; column_name: string }>(`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'uuid' and (column_name like '%race_id' or column_name like '%event_id')`);
    expect(columns.rows.length).toBeGreaterThan(50);
    for (const { table_name: table, column_name: column } of columns.rows) {
      const left = await pool.query(`select 1 from "${table}" where "${column}" in ($1, $2) limit 1`, [doomed.proof.raceId, doomed.eventId]);
      expect(left.rowCount, `${table}.${column}`).toBe(0);
    }

    // Den andra tävlingen och kontona finns kvar.
    expect(await publicResults(db, kept.proof.raceId)).toEqual(keptResults);
    expect((await loginUserAccount(db, { formatVersion: 1, email: helper.email, password: helper.password })).status).toBe("authenticated");
    expect((await enterRaceAsUserAccount(db, { ...owner.proof, raceId: kept.proof.raceId })).status).toBe("entered");
    expect((await enterRaceAsUserAccount(db, { ...owner.proof, raceId: doomed.proof.raceId })).status).toBe("not-found");
  });
});
