import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { parseRaceClock } from "@o-tid/domain";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { changeEntryCardAsAdmin, listEntryCardsAsAdmin } from "../../src/entry-card";
import { listRadioRacesDue, pollRadioRace, radioPollDue, radioRetryDelayMs } from "../../src/radio-ingest";
import { fetchRadioNowAsAdministrator, getRadioSettingsAsAdministrator, saveRadioSettingsAsAdministrator } from "../../src/radio-settings";
import { isRadioLive, readPublicRadio } from "../../src/radio-standings";
import { grantRacePerson, registerTestAccount } from "./accounts";

/**
 * ADR-0172 beslut 5 / PLAN.md steg 20: radiokontroller via ROC/OResults. Hämtning med lastId över flera
 * anrop, idempotent mottagning, krasch mellan sparande och lastId, okända brickor, bricka som byts efter
 * stämplingen och de publika mellantiderna (resultatlistan och speakern).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Radiotestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0172_radio_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0172_radio_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string; ownerProof: { sessionToken: string; csrfCookie: string; csrfHeader: string } };

/**
 * Tävlingen går i dag (svensk tid) så att pollern ser tävlingsdagen; start 18:00. Sessionerna använder
 * verklig tid, hämtningarna anger tiden uttryckligen.
 */
const ZONE = "Europe/Stockholm";
const wall = (ms: number) => new Date(ms).toLocaleString("sv-SE", { timeZone: ZONE, hourCycle: "h23" });
const TODAY = wall(Date.now()).slice(0, 10);
const START = Date.parse(parseRaceClock(TODAY, "18:00", ZONE)!);
const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString();
/** Lokal tid som ROC skickar den: "YYYY-MM-DD HH:MM:SS". */
const local = (seconds: number) => wall(START + seconds * 1_000);
const NOW = () => new Date();
const DAY = 86_400_000;

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
const courseVersionOf = async (classId: string) =>
  (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id;
const storedPunches = async (raceId: string) =>
  (await pool.query<{ count: number }>("select count(*)::int as count from radio_punch where race_id = $1", [raceId])).rows[0]!.count;
const lastPunchId = async (raceId: string) =>
  Number((await pool.query<{ last_punch_id: string }>("select last_punch_id from race_radio_link where race_id = $1", [raceId])).rows[0]!.last_punch_id);

async function race(): Promise<Race> {
  const owner = await registerTestAccount(db, `radio.${randomUUID().slice(0, 8)}`);
  const created = await createEventAsUserAccount(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Radio", raceName: "Torsdag", raceDate: TODAY,
      timeZone: ZONE, raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...owner.proof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName: "Lång",
      className: "H21", startRule: "FIXED", controlCodes: [31, 32, 50, 33] } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId, ownerProof: owner.proof };
}

async function register(f: Race, givenName: string, cardNumber: string, startSeconds: number): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "FIXED",
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Radiosson", organisationName: "OK Radio",
    cardNumber, fixedStartTime: at(startSeconds) } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(f: Race, cardNumber: string, punches: [number, number][], finish: number) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", finishPunchedAt: at(finish),
    punches: punches.map(([code, seconds]) => ({ code, punchedAt: at(seconds) })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(finish + 60), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

/**
 * En falsk ROC: svarar med raderna vars id är större än lastId (som tjänsten), plus `always` i varje svar
 * (dubbletter och trasiga rader). Sparar varje lastId som frågades.
 */
function fakeRoc() {
  const state = { lines: [] as string[], always: [] as string[], status: 200, asked: [] as number[] };
  const fetch: typeof globalThis.fetch = async input => {
    const requested = new URL(input instanceof Request ? input.url : input.toString());
    const lastId = Number(requested.searchParams.get("lastId"));
    state.asked.push(lastId);
    if (state.status !== 200) return new Response("fel", { status: state.status });
    const body = [...state.lines.filter(line => Number(line.split(";")[0]) > lastId), ...state.always].join("\n");
    return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
  };
  return { state, fetch };
}

const settingsRequest = { formatVersion: 1, source: "ORESULTS", unitId: "4711", enabled: true,
  controls: [{ code: 31, label: "Radio 1" }, { code: 50, label: null }] };

describe("ADR-0172 radiokontroller", () => {
  it("bara admin ställer in radion; funktionären når inte inställningarna", async () => {
    const f = await race();
    const before = await getRadioSettingsAsAdministrator(db, f.proof, NOW());
    if (before.status !== "ok") throw new Error("Inställningarna kunde inte läsas");
    expect(before.response).toMatchObject({ link: null, status: null, relay: false, latest: [] });
    expect(before.response.candidates).toEqual([{ code: 31, courses: ["Lång"] }, { code: 32, courses: ["Lång"] },
      { code: 33, courses: ["Lång"] }, { code: 50, courses: ["Lång"] }]);
    expect(await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: { ...settingsRequest, unitId: "../x" } }, NOW()))
      .toEqual({ status: "invalid-request" });
    expect(await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: { ...settingsRequest,
      controls: [{ code: 31, label: null }, { code: 31, label: null }] } }, NOW())).toEqual({ status: "invalid-request" });
    const saved = await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: settingsRequest }, NOW());
    expect(saved).toMatchObject({ status: "ok", response: { link: { source: "ORESULTS", unitId: "4711", enabled: true,
      controls: [{ code: 31, label: "Radio 1" }, { code: 50, label: null }] }, status: { polling: "TODAY", punches: 0, lastAttemptAt: null } } });

    const functionary = await registerTestAccount(db, `radiofunk.${randomUUID().slice(0, 8)}`);
    expect((await grantRacePerson(db, f.ownerProof, f.raceId, functionary.email, "FUNCTIONARY")).status).toBe("granted");
    const entered = await enterRaceAsUserAccount(db, { ...functionary.proof, raceId: f.raceId });
    if (entered.status !== "entered") throw new Error("Funktionären kom inte in");
    const asFunctionary = { raceId: f.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
    expect(await getRadioSettingsAsAdministrator(db, asFunctionary, NOW())).toEqual({ status: "forbidden" });
    expect(await saveRadioSettingsAsAdministrator(db, { ...asFunctionary, request: settingsRequest }, NOW())).toEqual({ status: "forbidden" });
    expect(await fetchRadioNowAsAdministrator(db, asFunctionary, {}, NOW())).toEqual({ status: "forbidden" });
    // Utan CSRF sparas inget.
    const withoutCsrf = await saveRadioSettingsAsAdministrator(db, { ...f.proof, csrfHeader: "fel", request: settingsRequest }, NOW());
    expect(["unauthorized", "forbidden"]).toContain(withoutCsrf.status);
  });

  it("hämtar med lastId, är idempotent och tål krasch mellan sparande och lastId", async () => {
    const f = await race();
    await register(f, "Anna", "7201", 0);
    const roc = fakeRoc();
    const runtime = { fetch: roc.fetch };
    expect(await pollRadioRace(db, f.raceId, runtime, NOW())).toEqual({ status: "not-configured" });
    await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: settingsRequest }, NOW());

    // Första hämtningen: tre stämplingar (id:n som inte ökar), en okänd bricka och en trasig rad.
    roc.state.lines = [`3;31;7201;${local(450)}`, `1;31;9999;${local(300)}`, `2;99;7201;${local(200)}`];
    roc.state.always = ["trasig rad"];
    expect(await pollRadioRace(db, f.raceId, runtime, NOW())).toEqual({ status: "fetched", newPunches: 3 });
    expect(await lastPunchId(f.raceId)).toBe(3);
    // Andra hämtningen frågar med lastId 3 och får en ny stämpling plus en dubblett (samma stämpling, nytt id).
    roc.state.lines.push(`4;50;7201;${local(1200)}`, `5;31;7201;${local(450)}`);
    expect(await pollRadioRace(db, f.raceId, runtime, NOW())).toEqual({ status: "fetched", newPunches: 1 });
    expect(roc.state.asked).toEqual([0, 3]);
    expect(await lastPunchId(f.raceId)).toBe(5);
    expect(await storedPunches(f.raceId)).toBe(4);

    // Samma svar igen (t.ex. lastId nollställt efter krasch efter sparandet): inga dubbletter.
    await pool.query("update race_radio_link set last_punch_id = 0 where race_id = $1", [f.raceId]);
    expect(await pollRadioRace(db, f.raceId, runtime, NOW())).toEqual({ status: "fetched", newPunches: 0 });
    expect(await storedPunches(f.raceId)).toBe(4);
    expect(await lastPunchId(f.raceId)).toBe(5);

    // Krasch innan lastId sparats: transaktionen rullas tillbaka, inget sparas och lastId står kvar.
    roc.state.lines.push(`6;50;9998;${local(1300)}`);
    await pool.query(`create function radio_test_crash() returns trigger language plpgsql as $$
      begin raise exception 'krasch'; end; $$`);
    await pool.query("create trigger radio_test_crash before update on race_radio_link for each row execute function radio_test_crash()");
    await expect(pollRadioRace(db, f.raceId, runtime, NOW())).rejects.toThrow();
    await pool.query("drop trigger radio_test_crash on race_radio_link");
    await pool.query("drop function radio_test_crash()");
    expect(await storedPunches(f.raceId)).toBe(4);
    expect(await lastPunchId(f.raceId)).toBe(5);
    // Nästa hämtning frågar med samma lastId och får stämplingen en gång.
    expect(await pollRadioRace(db, f.raceId, runtime, NOW())).toEqual({ status: "fetched", newPunches: 1 });
    expect(roc.state.asked.at(-1)).toBe(5);
    expect(await storedPunches(f.raceId)).toBe(5);
    expect(await lastPunchId(f.raceId)).toBe(6);

    // Råa rader sparas oförändrade och kan inte ändras.
    const raw = await pool.query<{ raw_line: string }>("select raw_line from radio_punch where race_id = $1 and punch_id = 3", [f.raceId]);
    expect(raw.rows[0]!.raw_line).toBe(`3;31;7201;${local(450)}`);
    await expect(pool.query("update radio_punch set card_number = '1' where race_id = $1", [f.raceId])).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from radio_punch where race_id = $1", [f.raceId])).rejects.toThrow(/append-only/);

    const settings = await getRadioSettingsAsAdministrator(db, f.proof, NOW());
    if (settings.status !== "ok") throw new Error("Inställningarna kunde inte läsas");
    expect(settings.response.status).toMatchObject({ punches: 5, matchedPunches: 3, unknownCards: 2, otherControls: 1,
      malformedLines: 4, lastError: null, lastPunchId: 6 });
    expect(settings.response.latest[0]).toMatchObject({ controlCode: 50, cardNumber: "9998", runner: null });
    expect(settings.response.latest.find(row => row.cardNumber === "7201")).toMatchObject({ runner: "Anna Radiosson", className: "H21" });

    // Byte av enhet börjar om från lastId 0.
    await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: { ...settingsRequest, unitId: "4712" } }, NOW());
    expect(await lastPunchId(f.raceId)).toBe(0);
  });

  it("visar fel i klartext och väntar längre efter fel", async () => {
    const f = await race();
    const roc = fakeRoc();
    await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: settingsRequest }, NOW());
    expect(await listRadioRacesDue(db, NOW())).toContain(f.raceId);
    // Bara på tävlingsdagen i tävlingens tidszon.
    expect(await listRadioRacesDue(db, new Date(START + DAY))).not.toContain(f.raceId);
    expect(await listRadioRacesDue(db, new Date(START - DAY))).not.toContain(f.raceId);
    roc.state.status = 502;
    const failed = await fetchRadioNowAsAdministrator(db, f.proof, { fetch: roc.fetch });
    expect(failed).toMatchObject({ status: "ok", response: { outcome: "UPSTREAM_UNAVAILABLE", newPunches: 0,
      settings: { status: { lastError: "UPSTREAM_UNAVAILABLE", consecutiveFailures: 1 } } } });
    const t0 = new Date();
    expect(await pollRadioRace(db, f.raceId, { fetch: roc.fetch }, t0)).toEqual({ status: "failed", error: "UPSTREAM_UNAVAILABLE" });
    // Två fel i rad: nästa försök efter 40 s (10 → 20 → 40 → 60 s).
    expect(radioRetryDelayMs(0)).toBe(10_000);
    expect(radioRetryDelayMs(1)).toBe(20_000);
    expect(radioRetryDelayMs(2)).toBe(40_000);
    expect(radioRetryDelayMs(5)).toBe(60_000);
    expect(radioPollDue({ lastAttemptAt: t0, consecutiveFailures: 2 }, new Date(t0.getTime() + 20_000))).toBe(false);
    expect(await listRadioRacesDue(db, new Date(t0.getTime() + 20_000))).not.toContain(f.raceId);
    expect(await listRadioRacesDue(db, new Date(t0.getTime() + 41_000))).toContain(f.raceId);
    // Lyckad hämtning nollställer felet.
    roc.state.status = 200;
    const fixed = await fetchRadioNowAsAdministrator(db, f.proof, { fetch: roc.fetch });
    expect(fixed).toMatchObject({ status: "ok", response: { outcome: "FETCHED", settings: { status: { lastError: null, consecutiveFailures: 0 } } } });
    // Avstängd: hämtas inte automatiskt och syns inte publikt.
    await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: { ...settingsRequest, enabled: false } }, NOW());
    expect(await listRadioRacesDue(db, new Date(Date.now() + 120_000))).not.toContain(f.raceId);
    expect((await readPublicRadio(db, f.raceId)).enabled).toBe(false);
    expect(await isRadioLive(db, f.raceId)).toBe(false);
  });

  it("ger mellantider och placering vid radiokontrollen, matchar brickan vid läsning", async () => {
    const f = await race();
    const anna = await register(f, "Anna", "7201", 0);
    await register(f, "Bo", "7202", 0);
    const cia = await register(f, "Cia", "7203", 120);
    await register(f, "Dan", "7204", 0);
    const roc = fakeRoc();
    await saveRadioSettingsAsAdministrator(db, { ...f.proof, request: settingsRequest }, NOW());
    expect(await isRadioLive(db, f.raceId)).toBe(true);
    // Anna 7:30, Bo 7:20, Dan 7:21, Cia 6:00 (startade 18:02). Dan felstämplar senare. 7299 är en okänd bricka än så länge.
    roc.state.lines = [`1;31;7201;${local(450)}`, `2;31;7202;${local(440)}`, `3;31;7203;${local(480)}`,
      `4;31;7204;${local(441)}`, `5;31;7299;${local(500)}`, `6;50;7202;${local(1100)}`];
    expect(await pollRadioRace(db, f.raceId, { fetch: roc.fetch }, NOW())).toEqual({ status: "fetched", newPunches: 6 });

    let radio = await readPublicRadio(db, f.raceId);
    expect(radio.enabled).toBe(true);
    const h21 = () => radio.classes.find(row => row.className === "H21")!;
    const at31 = () => h21().controls.find(row => row.controlCode === 31)!.passages.map(row => [row.givenName, row.elapsedMs, row.place]);
    expect(at31()).toEqual([["Cia", 360_000, 1], ["Bo", 440_000, 2], ["Dan", 441_000, 3], ["Anna", 450_000, 4]]);
    expect(h21().controls.map(row => [row.controlCode, row.label])).toEqual([[31, "Radio 1"], [50, null]]);
    // På väg in: Bo längst fram (vid 50), sedan de övriga vid 31 i placeringsordning.
    expect(h21().onTheWay.map(row => [row.givenName, row.controlCode, row.place])).toEqual([["Bo", 50, 1], ["Cia", 31, 1],
      ["Dan", 31, 3], ["Anna", 31, 4]]);
    expect(radio.latest.map(row => [row.givenName, row.controlCode])).toEqual([["Bo", 50], ["Cia", 31], ["Anna", 31], ["Dan", 31], ["Bo", 31]]);
    // Inga bricknummer publikt.
    expect(JSON.stringify(radio)).not.toMatch(/72\d\d/);

    // Anna läses av (godkänd, avläsningens tid vid 31 är 7:28) och Dan felstämplar: Annas tid kommer från avläsningen.
    await readout(f, "7201", [[31, 448], [32, 800], [50, 1150], [33, 1500]], 1800);
    await readout(f, "7204", [[31, 440], [50, 1160], [33, 1490]], 1790);
    radio = await readPublicRadio(db, f.raceId);
    expect(at31()).toEqual([["Cia", 360_000, 1], ["Bo", 440_000, 2], ["Anna", 448_000, 3], ["Dan", 440_000, null]]);
    expect(h21().onTheWay.map(row => row.givenName)).toEqual(["Bo", "Cia"]);
    expect(h21().controls.find(row => row.controlCode === 50)!.passages.map(row => [row.givenName, row.place, row.finished]))
      .toEqual([["Bo", 1, false], ["Anna", 2, true], ["Dan", null, true]]);

    // Cia hade fel bricka: 7299 var hennes. Efter bytet hör 7299:s stämpling till Cia och 7203:s till ingen.
    const listed = await listEntryCardsAsAdmin(db, f.proof);
    if (listed.status !== "ok") throw new Error("Bricklistan saknas");
    const row = listed.response.entries.find(entry => entry.id === cia)!;
    const changed = await changeEntryCardAsAdmin(db, { ...f.proof, entryId: cia, idempotencyKey: `entry-card-change:${randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: row.version, expectedClassId: row.classId,
        expectedSnapshotVersion: listed.response.snapshotVersion, expectedAssignment: row.activeAssignment, cardNumber: "7299" } });
    expect(changed.status).toBe("changed");
    radio = await readPublicRadio(db, f.raceId);
    // Cias tid kommer nu från 7299:s stämpling (18:08:20, start 18:02).
    expect(at31()).toEqual([["Cia", 380_000, 1], ["Bo", 440_000, 2], ["Anna", 448_000, 3], ["Dan", 440_000, null]]);
    const settings = await getRadioSettingsAsAdministrator(db, f.proof, NOW());
    expect(settings.status === "ok" && settings.response.status).toMatchObject({ unknownCards: 1, matchedPunches: 5 });
    expect(radio.latest.find(passage => passage.givenName === "Anna")).toMatchObject({ finished: true, place: 3 });
    expect(anna).toMatch(/^[0-9a-f-]{36}$/);
  });
});
