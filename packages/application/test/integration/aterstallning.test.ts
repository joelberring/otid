import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RACE_BACKUP_FORMAT_VERSION } from "@o-tid/contracts";
import { setEntryStatus } from "../../src/entry-status";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { publicResults } from "../../src/results";
import { setResultsOfficialAsAdmin, readResultsOfficialAsAdmin } from "../../src/result-official";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { exportRaceAsAdmin, readRaceBackupStatusAsAdmin } from "../../src/race-export";
import { openRaceBackup, previewRaceBackup, restoreRaceBackup } from "../../src/race-restore";
import { RACE_BACKUP_EXCLUDED_TABLES, RACE_BACKUP_TABLES } from "../../src/race-backup-tables";
import { ZipReader, writeZip } from "../../src/race-backup-zip";
import { sha256Hex } from "../../src/serialization";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { publicRelayResults } from "../../src/relay-results";
import { purgeRows } from "../../src/purge";
import { accountOnRace, registerTestAccount } from "./accounts";
import { ingest, NOW, RACE_DATE, run, seedRace } from "./steg-25-fixtures";

/**
 * ADR-0187: arrangörens säkerhetskopia och "Återställ tävling från säkerhetskopia". En tävling med avläsningar (godkänd,
 * felstämplad), ett manuellt beslut, fastställda resultat, karta, notis med foto och personer med behörighet exporteras och
 * återställs som en ny tävling. Resultatlistan, sträcktiderna och IOF-resultatlistan blir desamma, alla id är nya, inga konton
 * eller Eventor-nycklar finns i filen, och filer som är trasiga, ändrade, okända eller av en annan formatversion avvisas.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

const LATER = new Date(NOW.getTime() + 120_000);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** Listan utan id (de är nya i kopian) och utan tidpunkten då listan skapades. */
const withoutIds = (value: unknown) => JSON.stringify(value).replace(UUID, "<id>");
const xmlWithoutIds = (xml: string) => xml.replace(UUID, "<id>").replace(/createTime="[^"]+"/, "").replace(/<Id>[^<]*<\/Id>/g, "<Id/>");

async function racePrepared() {
  const { ids, cards, admin } = await seedRace(db, pool);
  // Ada godkänd, Bo felstämplad (saknar 32), Cia och Dan godkända; Eva startade inte.
  await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 31), run(cards.dan, "11:05:00", 29.5)]);
  const bo = run(cards.bo, "10:30:00", 50);
  await ingest(db, ids.race, [{ ...bo, punches: bo.punches.slice(0, 1) }]);
  const requestId = randomUUID();
  const dns = await setEntryStatus(db, { ...admin, entryId: ids.eva, idempotencyKey: `entry-status:${requestId}`,
    request: { formatVersion: 1, requestId, expectedRevision: 0, decision: { kind: "DID_NOT_START" } } }, NOW);
  expect(dns.status).toBe("decided");
  const officialId = randomUUID();
  const official = await setResultsOfficialAsAdmin(db, { ...admin, idempotencyKey: `results-official:${officialId}`,
    request: { formatVersion: 1, requestId: officialId, action: "OFFICIAL" } }, new Date(NOW.getTime() + 60_000));
  expect(official.status === "saved" && official.response.result.outcome).toBe("OFFICIAL");
  // Karta, notis med foto och en Eventor-koppling med (låtsad) krypterad nyckel.
  const image = Buffer.from("kartbild i test, inte en riktig bild");
  await pool.query(`insert into race_map (race_id, file_name, media_type, image, sha256, byte_length, width, height, tie_points, transform,
    uploaded_at, georeferenced_at) values ($1, 'karta.png', 'image/png', $2, $3, $4, 100, 80, '[]', '{}', now(), now())`,
  [ids.race, image, sha256Hex(image), image.byteLength]);
  await pool.query(`insert into course_setting_note (id, race_id, target, at_x, at_y, text, created_at, created_by, request_id, photo,
    photo_media_type) values ($1, $2, 'POINT', 10, 20, 'Stenen är flyttad', now(), $3, $4, $5, 'image/jpeg')`,
  [randomUUID(), ids.race, admin.accountId, randomUUID(), Buffer.from("foto")]);
  await pool.query(`insert into race_eventor_link (race_id, key_id, iv, tag, ciphertext, organisation_id, organisation_name, updated_at)
    values ($1, 'nyckel-1', 'aXZhaXZhaXZhaXZh', 'dGFndGFndGFndGFndGFndG', 'HEMLIGxCIPHERTEXTxxxxxxxx', '321', 'OK Test', now())`, [ids.race]);
  // En funktionär med konto och en administratör som (på den nya servern) inte har något konto.
  const functionary = await registerTestAccount(db, undefined, NOW);
  const gone = await registerTestAccount(db, undefined, NOW);
  await pool.query(`insert into event_administration_grant (event_id, account_id, role, granted_at) values ($1, $2, 'FUNCTIONARY', now()),
    ($1, $3, 'ADMIN', now())`, [ids.event, functionary.accountId, gone.accountId]);
  return { ids, admin, functionary, gone };
}

describe("ADR-0187: säkerhetskopia och återställning", () => {
  it("återställer som en ny tävling med nya id och exakt samma resultat och sträcktider", async () => {
    const { ids, admin, functionary, gone } = await racePrepared();
    const exported = await exportRaceAsAdmin(db, admin, LATER);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(exported.fileName).toMatch(/^otid-sakerhetskopia-steg-25-2026-09-19-\d{8}-\d{4}\.zip$/);
    expect(exported.manifest).toMatchObject({ formatVersion: RACE_BACKUP_FORMAT_VERSION, containsPersonalData: true,
      counts: { classes: 2, entries: 5, cardReadouts: 4, files: 2, people: 3 } });
    expect((await readRaceBackupStatusAsAdmin(db, admin, LATER))).toEqual({ status: "ok", lastDownloadedAt: LATER.toISOString() });

    // I filen: personuppgifter om deltagarna, men inga konton, sessioner eller Eventor-nycklar.
    const zip = new ZipReader(exported.bytes, { maxEntries: 100, maxEntryBytes: () => 10_000_000, maxTotalBytes: 50_000_000, name: /./ });
    const text = [...zip.entries.keys()].map(name => new TextDecoder().decode(zip.extract(name))).join("\n");
    expect(text).toContain("Ada");
    for (const secret of [admin.accountId, functionary.accountId, admin.sessionToken, "HEMLIGxCIPHERTEXT", "nyckel-1", "aXZhaXZhaXZhaXZh", "salt_hex", "verifier"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain(functionary.email);

    // Förhandsvisningen sparar inget och säger vad den nya tävlingen får.
    const restorer = await registerTestAccount(db, undefined, NOW);
    const before = (await pool.query<{ n: number }>("select count(*)::int as n from race")).rows[0]!.n;
    const preview = await previewRaceBackup(db, { ...restorer.proof, bytes: exported.bytes }, LATER);
    if (preview.status !== "ok") throw new Error(JSON.stringify(preview));
    expect(preview.preview).toMatchObject({ backupFormatVersion: 2, race: { eventName: "Steg 25", raceDate: RACE_DATE },
      counts: { classes: 2, entries: 5, cardReadouts: 4 }, eventorLinked: true, map: true, staleResults: 0 });
    expect(preview.preview.people.find(person => person.email === functionary.email)).toEqual({ email: functionary.email,
      role: "FUNCTIONARY", hasAccount: true });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from race")).rows[0]!.n).toBe(before);

    // Kontot för en av administratörerna finns inte (som på en ny server).
    await pool.query("update user_account set blocked_at = now() where id = $1", [gone.accountId]);
    const requestId = randomUUID();
    const restored = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId, people: "link" } }, LATER);
    if (restored.status !== "restored") throw new Error(JSON.stringify(restored));
    const copy = restored.response.raceId;
    expect(copy).not.toBe(ids.race);
    expect(restored.response).toMatchObject({ linkedPeople: 2, missingPeople: [gone.email] });

    // Nya id genomgående, opublicerad och egen kort adress; Eventor utan nyckel och radion avstängd.
    const ids0 = await pool.query<{ id: string }>(`select id from entry where race_id = $1 union all select id from card_readout where race_id = $1
      union all select id from result_revision where race_id = $1 union all select id from raw_device_message where race_id = $1`, [ids.race]);
    const ids1 = await pool.query<{ id: string }>(`select id from entry where race_id = $1 union all select id from card_readout where race_id = $1
      union all select id from result_revision where race_id = $1 union all select id from raw_device_message where race_id = $1`, [copy]);
    expect(ids1.rows).toHaveLength(ids0.rows.length);
    expect(ids1.rows.filter(row => ids0.rows.some(old => old.id === row.id))).toEqual([]);
    const races = await pool.query<{ short_code: string; published_at: Date | null }>("select id, short_code, published_at, event_id from race where id = any($1::uuid[]) order by id = $2",
      [[ids.race, copy], copy]);
    expect(races.rows[0]!.short_code).not.toBe(races.rows[1]!.short_code);
    expect(races.rows[1]!.published_at).toBeNull();
    expect((await pool.query("select key_id, ciphertext, organisation_name from race_eventor_link where race_id = $1", [copy])).rows)
      .toEqual([{ key_id: null, ciphertext: null, organisation_name: "OK Test" }]);
    const raw0 = await pool.query("select raw_payload, content_hash, local_sequence from raw_device_message where race_id = $1 order by content_hash", [ids.race]);
    const raw1 = await pool.query("select raw_payload, content_hash, local_sequence from raw_device_message where race_id = $1 order by content_hash", [copy]);
    expect(raw1.rows).toEqual(raw0.rows);
    // ADR-0189: kartbilden ligger i innehållslagret efter återställningen.
    expect((await pool.query<{ image: Buffer }>("select otid_map_content_bytes(content_sha256) as image from race_map where race_id = $1 and image is null",
      [copy])).rows[0]!.image.toString())
      .toBe("kartbild i test, inte en riktig bild");
    expect((await pool.query<{ photo: Buffer }>("select photo from course_setting_note where race_id = $1", [copy])).rows[0]!.photo.toString()).toBe("foto");

    // Samma resultatlista, sträcktider och IOF-resultatlista.
    const list0 = await publicResults(db, ids.race);
    const list1 = await publicResults(db, copy);
    expect(list1.results.length).toBe(5);
    expect(list1.results.flatMap(result => "splits" in result ? result.splits : []).length).toBeGreaterThan(0);
    expect(withoutIds({ ...list1, raceId: undefined })).toBe(withoutIds({ ...list0, raceId: undefined }));
    const owner1 = { raceId: copy, ...restorer.proof };
    const iof0 = await exportIofResultListAsAdmin(db, admin, LATER);
    const iof1 = await exportIofResultListAsAdmin(db, owner1, LATER);
    if (iof0.status !== "ok" || iof1.status !== "ok") throw new Error("IOF-listan saknas");
    expect(xmlWithoutIds(new TextDecoder().decode(iof1.bytes))).toBe(xmlWithoutIds(new TextDecoder().decode(iof0.bytes)));
    const official1 = await readResultsOfficialAsAdmin(db, owner1, LATER);
    const official0 = await readResultsOfficialAsAdmin(db, admin, LATER);
    expect(official1.status === "ok" && withoutIds(official1.response.official)).toBe(official0.status === "ok" && withoutIds(official0.response.official));

    // Personerna: ägare är den som återställde, funktionären har kontot här, den spärrade fick ingen behörighet.
    const people = await pool.query<{ account_id: string; role: string }>(`select account_id, role from event_administration_grant g
      join race r on r.event_id = g.event_id where r.id = $1 order by role`, [copy]);
    expect(people.rows).toEqual([{ account_id: restorer.accountId, role: "OWNER" }, { account_id: admin.accountId, role: "ADMIN" },
      { account_id: functionary.accountId, role: "FUNCTIONARY" }]);
    expect((await pool.query("select action from audit_event where race_id = $1 and action = 'RACE_RESTORED_FROM_BACKUP'", [copy])).rowCount).toBe(1);

    // Samma begäran igen ger samma tävling; samma id med en annan fil eller ett annat val avvisas.
    const replay = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId, people: "link" } }, LATER);
    expect(replay.status === "restored" && replay.response).toMatchObject({ replayed: true, raceId: copy });
    expect((await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId, people: "skip" } }, LATER)).status)
      .toBe("conflict");

    // En gång till på samma server (utan personerna): ytterligare en ny tävling, ingen krock med den första.
    const second = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId: randomUUID(), people: "skip" } }, LATER);
    if (second.status !== "restored") throw new Error(JSON.stringify(second));
    expect(second.response.raceId).not.toBe(copy);
    expect(withoutIds({ ...(await publicResults(db, second.response.raceId)), raceId: undefined })).toBe(withoutIds({ ...list0, raceId: undefined }));
    expect((await pool.query<{ n: number }>(`select count(*)::int as n from event_administration_grant g join race r on r.event_id = g.event_id
      where r.id = $1`, [second.response.raceId])).rows[0]!.n).toBe(1);

    // Kopian av kopian: exporten av den återställda tävlingen läses in igen.
    const again = await exportRaceAsAdmin(db, owner1, LATER);
    expect(again.status).toBe("ok");
  });

  it("ett resultat som väntade på omräkning när kopian togs är inaktuellt också efter återställningen; övriga är aktuella", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 31)]);
    // Adas lottade starttid ändras utan omräkning (som en ändring direkt i databasen): hennes resultat är inaktuellt.
    await pool.query("update entry set fixed_start_time = $2 where id = $1", [ids.ada, `${RACE_DATE}T10:04:00Z`]);
    const current = async (raceId: string, entryId: string, proof: { sessionToken: string; csrfCookie?: string; csrfHeader?: string }) => {
      const result = await getAdministratorEffectiveResult(db, { ...proof, raceId, entryId }, NOW);
      if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error(`Inget resultat: ${result.status}`);
      return result.response.resultCurrent;
    };
    expect(await current(ids.race, ids.ada, admin)).toBe(false);
    expect(await current(ids.race, ids.cia, admin)).toBe(true);
    const exported = await exportRaceAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(exported.manifest.staleResults).toBe(1);
    expect(exported.manifest.staleResultRevisions).toHaveLength(1);

    const restorer = await registerTestAccount(db, undefined, NOW);
    const restored = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId: randomUUID(), people: "skip" } }, NOW);
    if (restored.status !== "restored") throw new Error(JSON.stringify(restored));
    const copy = restored.response.raceId;
    const entry = async (given: string) => (await pool.query<{ id: string }>("select id from entry where race_id = $1 and given_name = $2",
      [copy, given])).rows[0]!.id;
    expect(await current(copy, await entry("Ada"), restorer.proof)).toBe(false);
    expect(await current(copy, await entry("Cia"), restorer.proof)).toBe(true);
    expect(withoutIds({ ...(await publicResults(db, copy)), raceId: undefined })).toBe(withoutIds({ ...(await publicResults(db, ids.race)), raceId: undefined }));
    // Utlösaren (migration 0042): utan återställningens inställning ersätts en medförd hash av den uträknade, och med den behålls
    // bara en hash som skiljer sig (ett resultat kan göras inaktuellt men aldrig aktuellt). Provat i en transaktion som rullas tillbaka.
    const cia = await entry("Cia");
    const client = await pool.connect();
    try {
      const insert = (hash: string) => client.query<{ kept: boolean }>(`insert into result_revision (id, race_id, entry_id, readout_id,
          revision, cause, status, reason, evaluation, engine_version, snapshot_version, course_version_id, published, basis_hash)
        select gen_random_uuid(), race_id, entry_id, readout_id, revision + 100, cause, status, reason, evaluation, engine_version,
          snapshot_version, course_version_id, false, $2 from result_revision where race_id = $1 and entry_id = $3 limit 1
        returning basis_hash = $2 as kept`, [copy, hash, cia]);
      await client.query("begin");
      expect((await insert("f".repeat(64))).rows[0]!.kept).toBe(false);
      await client.query("select set_config('otid.restore', 'on', true)");
      expect((await insert("e".repeat(64))).rows[0]!.kept).toBe(true);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("avläsningsdatorns kö för den gamla tävlingen skickad till den återställda: avvisas på samma server, dubblett utan ändrat resultat på en ny", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const snapshot = async (raceId: string) =>
      (await pool.query<{ v: number }>("select snapshot_version as v from race where id = $1", [raceId])).rows[0]!.v;
    // En avläsning från avläsningsdatorn (enhet, session, paketversion och löpnummer som i kön i IndexedDB).
    // Fälten i kontraktets ordning: servern räknar hashen över den tolkade nyttolasten.
    const ada = run(cards.ada, "10:02:00", 40);
    const finishPunchedAt = ada.finishPunchedAt;
    const payload: SportidentReadoutPayload = { cardNumber: ada.cardNumber, cardType: "SI9", startPunchedAt: ada.startPunchedAt,
      finishPunchedAt, punches: ada.punches, untimedPunchCodes: [], frames: ["02ef0100"], simulated: false };
    const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(ids.race), firstSequence: 1,
      lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: new Date(Date.parse(finishPunchedAt) + 60_000).toISOString(),
        transport: "sportident", payload, contentHash: contentHash(payload) }] };
    const first = await ingestReadoutsAsAdmin(db, { ...admin, batch }, NOW);
    expect(first.status === "ok" && first.response.acknowledgements[0]!.status).toBe("stored");

    const exported = await exportRaceAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    const restorer = await registerTestAccount(db, undefined, NOW);
    const restored = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId: randomUUID(), people: "skip" } }, NOW);
    if (restored.status !== "restored") throw new Error(JSON.stringify(restored));
    const copy = { raceId: restored.response.raceId, ...restorer.proof };
    const before = withoutIds({ ...(await publicResults(db, copy.raceId)), raceId: undefined });
    const readouts = async () => (await pool.query<{ n: number }>("select count(*)::int as n from card_readout where race_id = $1", [copy.raceId])).rows[0]!.n;
    expect(await readouts()).toBe(1);

    // Samma server: enhetens id finns kvar i den gamla tävlingen, så avläsningen avvisas med ett uttryckligt besked (inget sparas).
    const same = await ingestReadoutsAsAdmin(db, { ...copy, batch }, NOW);
    expect(same.status === "ok" && same.response.acknowledgements[0]).toMatchObject({ status: "rejected", reason: "SEQUENCE_CONTEXT_CONFLICT" });
    expect(await readouts()).toBe(1);

    // En ny server (den gamla tävlingen finns inte där): avläsningen tas emot som en ny avläsning av samma bricka. Det blir en
    // dubblett i avläsningarna och en ny resultatrevision, men tiden, sträcktiderna och placeringen är desamma.
    await db.transaction(tx => purgeRows(tx, "event", [ids.event]));
    const other = await ingestReadoutsAsAdmin(db, { ...copy, batch }, NOW);
    expect(other.status === "ok" && other.response.acknowledgements[0]!.status).toBe("stored");
    expect(await readouts()).toBe(2);
    const revisionless = (text: string) => text.replace(/"revision":\d+/g, "\"revision\":0");
    expect(revisionless(withoutIds({ ...(await publicResults(db, copy.raceId)), raceId: undefined }))).toBe(revisionless(before));
  });

  it("stafett (teamsprint där sträcklöparna delar bricka): samma lag, sträckor och resultat efter återställningen", async () => {
    const account = await registerTestAccount(db);
    const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Teamsprinten", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
    if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
    const proof = { raceId: created.response.raceId, ...account.proof };
    const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
    const courseId = randomUUID();
    const course = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${courseId}`,
      request: { formatVersion: 1, requestId: courseId, courseName: "Sprint", className: "Träning", startRule: "PUNCH", controlCodes: [31, 32] } });
    if (course.status !== "created") throw new Error(course.status);
    const classRequest = randomUUID();
    const relay = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classRequest}`, request: { formatVersion: 1,
      requestId: classRequest, name: "Teamsprint", courseId: course.response.courseId, readoutMode: "EACH_LEG",
      legs: [{ leg: 1, startMethod: "MASS_START", startTime: at("17:00"), variantCode: null }, { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null },
        { leg: 3, startMethod: "CHANGEOVER", startTime: null, variantCode: null }, { leg: 4, startMethod: "CHANGEOVER", startTime: null, variantCode: null }] } });
    if (relay.status !== "saved") throw new Error(relay.status);
    for (const [name, cardA, cardB] of [["Ek", "9101", "9102"], ["Al", "9201", "9202"]] as const) {
      const requestId = randomUUID();
      const runner = (given: string, leg: number, cardNumber: string | null, sameAsLeg?: number) =>
        ({ givenName: given, familyName: name, organisationName: null, leg, cardNumber, ...(sameAsLeg ? { sameAsLeg } : {}) });
      const team = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: { formatVersion: 1,
        requestId, classId: relay.response.classId, number: null, name, organisationName: "OK Test",
        runners: [runner("A", 1, cardA), runner("B", 2, cardB), runner("A", 3, null, 1), runner("B", 4, null, 2)] } });
      if (team.status !== "saved") throw new Error(team.status);
    }
    const punches = (from: string, to: string) => [31, 32].map((code, index) =>
      ({ code, punchedAt: new Date(Date.parse(at(from)) + (index + 1) * (Date.parse(at(to)) - Date.parse(at(from))) / 3).toISOString() }));
    const read = async (cardNumber: string, finish: string, list: { code: number; punchedAt: string }[]) => {
      const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: at(finish), punches: list, untimedPunchCodes: [],
        frames: ["02ef8300"], stationSerial: 999001, simulated: true };
      const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
      const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
        events: [{ localSequence: 1, stationReceivedAt: new Date(Date.parse(at(finish)) + 30_000).toISOString(), transport: "sportident",
          payload, contentHash: contentHash(payload) }] };
      expect((await ingestReadoutsAsAdmin(db, { ...proof, batch })).status).toBe("ok");
    };
    const a1 = punches("17:00", "17:10"), b2 = punches("17:10", "17:20"), a3 = punches("17:20", "17:30"), b4 = punches("17:30", "17:40");
    await read("9101", "17:10", a1); await read("9102", "17:20", b2); await read("9101", "17:30", [...a1, ...a3]); await read("9102", "17:40", [...b2, ...b4]);
    await read("9201", "17:11", a1); await read("9202", "17:22", b2); await read("9201", "17:31", [...a1, a3[0]!]);

    const exported = await exportRaceAsAdmin(db, proof);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(exported.manifest.counts).toMatchObject({ teams: 2, entries: 8 });
    const restorer = await registerTestAccount(db);
    const restored = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId: randomUUID(), people: "link" } });
    if (restored.status !== "restored") throw new Error(JSON.stringify(restored));
    const copy = restored.response.raceId;
    // Sträcka 3 springer med brickan på sträcka 1 (pekaren inom tabellen följer med till de nya id:na).
    const shared = await pool.query<{ n: number }>(`select count(*)::int as n from entry e join entry s on s.id = e.relay_card_entry_id
      where e.race_id = $1 and s.race_id = $1`, [copy]);
    expect(shared.rows[0]!.n).toBe(4);
    const relay0 = await publicRelayResults(db, proof.raceId);
    const relay1 = await publicRelayResults(db, copy);
    expect(JSON.stringify(relay1).length).toBeGreaterThan(200);
    expect(withoutIds({ ...relay1, raceId: undefined })).toBe(withoutIds({ ...relay0, raceId: undefined }));
  });

  it("avvisar fel formatversion, ändrade och okända filer och den gamla exporten med begripliga besked", async () => {
    const { admin } = await racePrepared();
    const exported = await exportRaceAsAdmin(db, admin, LATER);
    if (exported.status !== "ok") throw new Error(exported.status);
    const zip = new ZipReader(exported.bytes, { maxEntries: 100, maxEntryBytes: () => 10_000_000, maxTotalBytes: 50_000_000, name: /./ });
    const entries = [...zip.entries.keys()].map(name => ({ name, data: zip.extract(name)! }));
    const rewrite = (change: (name: string, data: Uint8Array) => Uint8Array | undefined, extra: { name: string; data: Uint8Array }[] = []) =>
      writeZip([...entries.flatMap(entry => { const data = change(entry.name, entry.data); return data ? [{ name: entry.name, data }] : []; }), ...extra]);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.name === "manifest.json")!.data)) as Record<string, unknown>;
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const error = (bytes: Uint8Array) => { const opened = openRaceBackup(bytes); return "status" in opened ? opened.problem : "ok"; };

    expect(error(exported.bytes)).toBe("ok");
    expect(error(rewrite((name, data) => name === "manifest.json" ? json({ ...manifest, formatVersion: 3 }) : data)))
      .toEqual({ formatVersion: 1, error: "UNKNOWN_FORMAT_VERSION", detail: "3" });
    expect(error(json({ format: "otid-race-export", formatVersion: 1, race: {} }))).toMatchObject({ error: "OLD_EXPORT" });
    expect(error(new TextEncoder().encode("inte en zip"))).toMatchObject({ error: "NOT_A_BACKUP" });
    expect(error(rewrite((name, data) => name === "manifest.json" ? json({ ...manifest, format: "något-annat" }) : data)))
      .toMatchObject({ error: "NOT_A_BACKUP" });
    expect(error(rewrite((name, data) => name === "personer.json" ? json([]) : data))).toMatchObject({ error: "CHECKSUM_MISMATCH" });
    expect(error(rewrite((_, data) => data, [{ name: "filer/" + "0".repeat(64), data: json("x") }]))).toMatchObject({ error: "UNKNOWN_CONTENT" });
    expect(error(rewrite((_, data) => data, [{ name: "../utanfor.txt", data: json("x") }]))).toMatchObject({ error: "BROKEN_ARCHIVE" });
    // En byte ändrad i en komprimerad fil: CRC eller uppackningen fångar den.
    const broken = new Uint8Array(exported.bytes); broken[200] = broken[200]! ^ 0xff;
    expect(["BROKEN_ARCHIVE", "CHECKSUM_MISMATCH", "INVALID_CONTENT", "NOT_A_BACKUP"]).toContain((error(broken) as { error: string }).error);

    // Okänd kolumn (en nyare version av O-Tid) och fel typ: avvisas av återställningen innan något sparas.
    const withTable = (table: string, rows: (rows: Record<string, unknown>[]) => unknown) => {
      const path = `data/${table}.json`;
      const original = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.name === path)!.data)) as Record<string, unknown>[];
      const data = json(rows(original));
      const changed = rows(original) as unknown[];
      const tables = (manifest.tables as { name: string; sha256: string; bytes: number }[]).map(entry => entry.name === table
        ? { ...entry, rows: changed.length, sha256: sha256Hex(data), bytes: data.byteLength } : entry);
      return rewrite((name, bytes) => name === path ? data : name === "manifest.json" ? json({ ...manifest, tables }) : bytes);
    };
    const restorer = await registerTestAccount(db, undefined, NOW);
    const restore = (bytes: Uint8Array) => restoreRaceBackup(db, { ...restorer.proof, bytes, options: { requestId: randomUUID(), people: "skip" } }, LATER);
    expect(await restore(withTable("entry", rows => rows.map(row => ({ ...row, ny_kolumn: 1 })))))
      .toEqual({ status: "invalid", problem: { formatVersion: 1, error: "UNKNOWN_CONTENT", detail: "entry.ny_kolumn" } });
    expect(await restore(withTable("card_readout", rows => rows.map(row => ({ ...row, read_at: 17 })))))
      .toEqual({ status: "invalid", problem: { formatVersion: 1, error: "INVALID_CONTENT", detail: "card_readout.read_at" } });
    expect(await restore(withTable("race_eventor_link", rows => rows.map(row => ({ ...row, ciphertext: "x" })))))
      .toMatchObject({ status: "invalid", problem: { error: "INVALID_CONTENT" } });
    // Databasen säger nej (två rader med samma bricka aktiv): inget sparas.
    const before = (await pool.query<{ n: number }>("select count(*)::int as n from race")).rows[0]!.n;
    const card = await restore(withTable("card_assignment", rows => [...rows, { ...rows[0], id: randomUUID() }]));
    expect(card).toMatchObject({ status: "invalid", problem: { error: "DATA_REJECTED" } });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from race")).rows[0]!.n).toBe(before);

    // Bara inloggade.
    expect((await previewRaceBackup(db, { sessionToken: null, bytes: exported.bytes }, LATER)).status).toBe("unauthorized");
    expect((await restoreRaceBackup(db, { sessionToken: "fel", bytes: exported.bytes,
      options: { requestId: randomUUID(), people: "skip" } }, LATER)).status).toBe("unauthorized");
  });

  it("varje tabell med race_id är med eller uttryckligen utanför, i en ordning som följer de främmande nycklarna", async () => {
    const withRace = await pool.query<{ table_name: string }>(`select table_name from information_schema.columns
      where table_schema = current_schema() and column_name = 'race_id' order by 1`);
    const included = RACE_BACKUP_TABLES.map(table => table.name);
    for (const { table_name: table } of withRace.rows) {
      expect(included.includes(table) || RACE_BACKUP_EXCLUDED_TABLES.includes(table), table).toBe(true);
    }
    const keys = await pool.query<{ child: string; parent: string }>(`select child.relname as child, parent.relname as parent
      from pg_constraint c join pg_class child on child.oid = c.conrelid join pg_class parent on parent.oid = c.confrelid
      where c.contype = 'f' and not c.condeferrable and child.relname <> parent.relname`);
    for (const { child, parent } of keys.rows) {
      if (!included.includes(child) || !included.includes(parent)) continue;
      // class -> start_draw_class: klassens lottning sätts efter lottningen (start_draw_id töms först).
      if (child === "class" && parent === "start_draw_class") continue;
      expect(included.indexOf(parent), `${child} -> ${parent}`).toBeLessThan(included.indexOf(child));
    }
  });
});
